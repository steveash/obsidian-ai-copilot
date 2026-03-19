import type { VaultAdapter } from "./vault-adapter";
import type {
  PatchPlan,
  MultiFilePatchPlan,
  PatchPlanEditV2,
  PatchPlanPreview,
  ConflictInfo,
} from "./patch-plan";

// ── types ────────────────────────────────────────────────────────────

export type EnrichmentState =
  | "unenriched"
  | "analyzing"
  | "auto-enriched"
  | "suggested"
  | "human-required"
  | "approved"
  | "applied"
  | "rejected";

export type HumanInterventionTrigger =
  | "low-confidence"
  | "conflicting-evidence"
  | "ambiguous-intent"
  | "destructive-rewrite"
  | "safety-failure"
  | "all-conflicting"
  | "cross-note";

export interface EnrichmentStateRecord {
  /** Schema version for forward compatibility */
  version: 1;

  /** Vault-relative path to the source note */
  notePath: string;

  /** SHA-256 hex hash of note content at time of last state transition */
  contentHash: string;

  /** Current enrichment state */
  state: EnrichmentState;

  /** ISO timestamp of last state transition */
  updatedAt: string;

  /** Enrichment run ID that produced the current state */
  runId: string;

  /** Human-intervention triggers that were met (empty if not human-required) */
  triggers: HumanInterventionTrigger[];

  /** Pending patch plan (present when state is suggested/human-required/approved) */
  pendingPlan: PatchPlan | MultiFilePatchPlan | null;

  /** Per-edit approval decisions (present when state is approved) */
  editDecisions: Record<number, "approved" | "rejected"> | null;

  /** Snapshot of original content before apply (for rollback) */
  preApplySnapshot: string | null;

  /** LLM model that generated the suggestions */
  model: string;

  /** Average confidence of proposed edits (0..1) */
  avgConfidence: number | null;

  /** Notes used as context for this enrichment */
  contextNotes: string[];
}

export interface EnrichmentThresholds {
  confidenceThreshold: number;
  destructiveRewriteThreshold: number;
}

export const DEFAULT_ENRICHMENT_THRESHOLDS: EnrichmentThresholds = {
  confidenceThreshold: 0.6,
  destructiveRewriteThreshold: 0.3,
};

// ── transition validation ────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<EnrichmentState, EnrichmentState[]> = {
  "unenriched":     ["analyzing"],
  "analyzing":      ["auto-enriched", "suggested", "human-required", "unenriched"],
  "auto-enriched":  ["unenriched"],
  "suggested":      ["approved", "rejected", "human-required", "unenriched"],
  "human-required": ["suggested", "rejected", "unenriched"],
  "approved":       ["applied", "unenriched"],
  "applied":        ["unenriched"],
  "rejected":       ["unenriched"],
};

export function isValidTransition(
  from: EnrichmentState,
  to: EnrichmentState
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── content hashing ──────────────────────────────────────────────────

export async function computeContentHash(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── sidecar file path ────────────────────────────────────────────────

export async function enrichmentStatePath(notePath: string): Promise<string> {
  const hash = (await computeContentHash(notePath)).slice(0, 8);
  const filename = notePath.split("/").pop()?.replace(/\.md$/, "").slice(0, 30) ?? "note";
  const slug = filename.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").toLowerCase();
  return `AI Copilot/.enrichment/${hash}-${slug}.json`;
}

// ── load / create default ────────────────────────────────────────────

function defaultRecord(notePath: string): EnrichmentStateRecord {
  return {
    version: 1,
    notePath,
    contentHash: "",
    state: "unenriched",
    updatedAt: new Date().toISOString(),
    runId: "",
    triggers: [],
    pendingPlan: null,
    editDecisions: null,
    preApplySnapshot: null,
    model: "",
    avgConfidence: null,
    contextNotes: [],
  };
}

export async function loadEnrichmentState(
  vault: VaultAdapter,
  notePath: string
): Promise<EnrichmentStateRecord> {
  const path = await enrichmentStatePath(notePath);
  if (!vault.exists(path)) {
    return defaultRecord(notePath);
  }
  try {
    const raw = await vault.read(path);
    return JSON.parse(raw) as EnrichmentStateRecord;
  } catch {
    return defaultRecord(notePath);
  }
}

// ── state transition ─────────────────────────────────────────────────

export async function transitionEnrichmentState(
  vault: VaultAdapter,
  notePath: string,
  newState: EnrichmentState,
  updates: Partial<EnrichmentStateRecord>
): Promise<EnrichmentStateRecord> {
  const existing = await loadEnrichmentState(vault, notePath);

  if (!isValidTransition(existing.state, newState)) {
    throw new Error(
      `Invalid enrichment transition: ${existing.state} → ${newState} for ${notePath}`
    );
  }

  const updated: EnrichmentStateRecord = {
    ...existing,
    ...updates,
    state: newState,
    updatedAt: new Date().toISOString(),
  };

  const statePath = await enrichmentStatePath(notePath);

  // Ensure the enrichment directory exists
  const dir = "AI Copilot/.enrichment";
  if (!vault.exists(dir)) {
    await vault.createFolder(dir);
  }

  if (vault.exists(statePath)) {
    await vault.modify(statePath, JSON.stringify(updated, null, 2));
  } else {
    await vault.create(statePath, JSON.stringify(updated, null, 2));
  }

  return updated;
}

// ── human-intervention trigger evaluation ────────────────────────────

export interface TriggerEvaluationInput {
  edits: PatchPlanEditV2[];
  originalContent: string;
  preview: PatchPlanPreview;
  conflicts: ConflictInfo[];
  parseFlags?: string[];
}

export function evaluateInterventionTriggers(
  input: TriggerEvaluationInput,
  thresholds: EnrichmentThresholds = DEFAULT_ENRICHMENT_THRESHOLDS
): HumanInterventionTrigger[] {
  const triggers: HumanInterventionTrigger[] = [];
  const { edits, originalContent, preview, conflicts, parseFlags } = input;

  if (edits.length === 0) return triggers;

  // 1. Low confidence
  const avgConfidence =
    edits.reduce((sum, e) => sum + (e.confidence ?? 1), 0) / edits.length;
  if (avgConfidence < thresholds.confidenceThreshold) {
    triggers.push("low-confidence");
  }

  // 2. Conflicting evidence
  if (parseFlags?.includes("conflicting-evidence")) {
    triggers.push("conflicting-evidence");
  }

  // 3. Ambiguous intent
  if (parseFlags?.includes("ambiguous-intent")) {
    triggers.push("ambiguous-intent");
  }

  // 4. Destructive rewrite
  if (originalContent.length > 0) {
    const totalFindLength = edits.reduce((sum, e) => sum + e.find.length, 0);
    const changeRatio = totalFindLength / originalContent.length;
    if (changeRatio > thresholds.destructiveRewriteThreshold) {
      triggers.push("destructive-rewrite");
    }
  }

  // 5. Safety check failures
  if (preview.edits.some((e) => e.safetyIssues.length > 0)) {
    triggers.push("safety-failure");
  }

  // 6. All edits conflicting
  if (conflicts.length === edits.length && edits.length > 0) {
    triggers.push("all-conflicting");
  }

  return triggers;
}

// ── classify enrichment result ───────────────────────────────────────

export interface ClassifyEnrichmentInput {
  edits: PatchPlanEditV2[];
  originalContent: string;
  preview: PatchPlanPreview;
  conflicts: ConflictInfo[];
  parseFlags?: string[];
  autoApplyEnabled: boolean;
  thresholds?: EnrichmentThresholds;
}

export interface ClassifyEnrichmentResult {
  state: "auto-enriched" | "suggested" | "human-required" | "unenriched";
  triggers: HumanInterventionTrigger[];
  avgConfidence: number | null;
}

/**
 * After LLM analysis, classify what state a note should transition to.
 * Returns unenriched if no edits were generated.
 */
export function classifyEnrichmentResult(
  input: ClassifyEnrichmentInput
): ClassifyEnrichmentResult {
  const { edits, originalContent, preview, conflicts, parseFlags, autoApplyEnabled, thresholds } = input;

  if (edits.length === 0) {
    return { state: "unenriched", triggers: [], avgConfidence: null };
  }

  const avgConfidence =
    edits.reduce((sum, e) => sum + (e.confidence ?? 1), 0) / edits.length;

  const interventionTriggers = evaluateInterventionTriggers(
    { edits, originalContent, preview, conflicts, parseFlags },
    thresholds
  );

  if (interventionTriggers.length > 0) {
    return { state: "human-required", triggers: interventionTriggers, avgConfidence };
  }

  // Check if all edits qualify for auto-apply
  if (autoApplyEnabled) {
    const conflictIndices = new Set(conflicts.map((c) => c.editIndex));
    const allSafe = edits.every((edit, i) => {
      const risk = edit.risk ?? "safe";
      const confidence = edit.confidence ?? 1;
      const hasSafetyIssues = preview.edits[i]?.safetyIssues?.length > 0;
      return (
        risk === "safe" &&
        confidence >= 0.8 &&
        !conflictIndices.has(i) &&
        !hasSafetyIssues
      );
    });

    if (allSafe) {
      return { state: "auto-enriched", triggers: [], avgConfidence };
    }
  }

  return { state: "suggested", triggers: [], avgConfidence };
}

// ── content hash invalidation ────────────────────────────────────────

/**
 * Check if a note's enrichment state should be invalidated due to content change.
 * Returns true if the state was invalidated (transitioned to unenriched).
 */
export async function invalidateIfContentChanged(
  vault: VaultAdapter,
  notePath: string,
  currentContent: string
): Promise<boolean> {
  const state = await loadEnrichmentState(vault, notePath);
  if (state.state === "unenriched") return false;

  const currentHash = await computeContentHash(currentContent);
  if (currentHash === state.contentHash) return false;

  await transitionEnrichmentState(vault, notePath, "unenriched", {
    pendingPlan: null,
    editDecisions: null,
    preApplySnapshot: null,
    triggers: [],
  });

  return true;
}
