import {
  applyPatchPlan,
  applyMultiFilePatchPlan,
  detectConflicts,
  previewPatchPlan,
  rollbackToSnapshot,
  toMarkdownPatchPlanPreview,
  validatePatchPlan,
  validateMultiFilePatchPlan,
  type AppliedPatchPlan,
  type MultiFileApplyResult,
  type MultiFilePatchPlan,
  type PatchPlan,
  type PatchPlanPreview,
  type ConflictInfo
} from "./patch-plan";
import type { PatchSafetyConfig } from "./patch-safety";
import { parseLLMPatchResponse, buildPatchPlanSystemPrompt, type ParseResult } from "./patch-plan-parser";
import { buildRefinementPrompt, extractTodos } from "./refinement";
import { buildRefinementPlan, toMarkdownPlan } from "./planner";
import type { RefineCandidate } from "./refinement";

// ── types ────────────────────────────────────────────────────────────

export interface RefinementPreview {
  parseResult: ParseResult;
  singleFilePreviews: Array<{
    plan: PatchPlan;
    preview: PatchPlanPreview;
    conflicts: ConflictInfo[];
  }>;
  multiFilePreviews: Array<{
    plan: MultiFilePatchPlan;
    filePreviews: Array<{
      path: string;
      preview: PatchPlanPreview;
      conflicts: ConflictInfo[];
    }>;
  }>;
  todoCount: number;
  rawLLMOutput: string;
}

export interface ApplyDecision {
  /** For single-file plans: index into singleFilePreviews */
  singleFileSelections?: Array<{
    planIndex: number;
    selectedEditIndices?: number[]; // undefined = all
  }>;
  /** For multi-file plans: index into multiFilePreviews */
  multiFileSelections?: Array<{
    planIndex: number;
    selectedEdits?: Map<string, number[]>; // per-file subset; undefined = all
  }>;
}

export interface ApplyResult {
  singleFileResults: Array<{
    path: string;
    applied: AppliedPatchPlan;
    conflicts: ConflictInfo[];
  }>;
  multiFileResults: MultiFileApplyResult[];
  summary: string;
}

export interface SmartRefinementSnapshot {
  snapshots: Map<string, string>; // path → original content
  appliedAt: number;
}

// ── preview phase ───────────────────────────────────────────────────

/**
 * Generate a preview of LLM-suggested refinements without applying anything.
 * This is the first phase of the preview-first flow.
 */
export function buildRefinementPreview(
  llmOutput: string,
  fileContents: Map<string, string>,
  candidates: RefineCandidate[],
  safetyConfig?: PatchSafetyConfig
): RefinementPreview {
  const parseResult = parseLLMPatchResponse(llmOutput);
  const todoCount = candidates.flatMap((c) => extractTodos(c.content)).length;

  // Preview single-file plans
  const singleFilePreviews = parseResult.plans.map((plan) => {
    const content = fileContents.get(plan.path) ?? "";
    const preview = previewPatchPlan(content, plan, safetyConfig);
    const conflicts = content ? detectConflicts(content, plan.edits as any) : [];
    return { plan, preview, conflicts };
  });

  // Preview multi-file plans
  const multiFilePreviews = parseResult.multiFilePlans.map((plan) => {
    const filePreviews = plan.files.map((file) => {
      const content = fileContents.get(file.path) ?? "";
      const preview = previewPatchPlan(content, file, safetyConfig);
      const conflicts = content ? detectConflicts(content, file.edits) : [];
      return { path: file.path, preview, conflicts };
    });
    return { plan, filePreviews };
  });

  return { parseResult, singleFilePreviews, multiFilePreviews, todoCount, rawLLMOutput: llmOutput };
}

// ── apply phase ─────────────────────────────────────────────────────

/**
 * Apply selected edits from a preview. Returns results and a snapshot for rollback.
 */
export function applyRefinementDecision(
  preview: RefinementPreview,
  decision: ApplyDecision,
  fileContents: Map<string, string>,
  safetyConfig?: PatchSafetyConfig
): { result: ApplyResult; snapshot: SmartRefinementSnapshot } {
  const snapshotMap = new Map<string, string>();
  const singleFileResults: ApplyResult["singleFileResults"] = [];
  const multiFileResults: ApplyResult["multiFileResults"] = [];

  // Apply single-file selections
  if (decision.singleFileSelections) {
    for (const sel of decision.singleFileSelections) {
      const entry = preview.singleFilePreviews[sel.planIndex];
      if (!entry) continue;

      const content = fileContents.get(entry.plan.path);
      if (content === undefined) continue;

      snapshotMap.set(entry.plan.path, content);
      const applied = applyPatchPlan(content, entry.plan, {
        selectedIndices: sel.selectedEditIndices,
        safetyConfig
      });
      const conflicts = detectConflicts(content, entry.plan.edits as any);

      singleFileResults.push({
        path: entry.plan.path,
        applied,
        conflicts
      });
    }
  }

  // Apply multi-file selections
  if (decision.multiFileSelections) {
    for (const sel of decision.multiFileSelections) {
      const entry = preview.multiFilePreviews[sel.planIndex];
      if (!entry) continue;

      // Snapshot all files in this plan
      for (const file of entry.plan.files) {
        const content = fileContents.get(file.path);
        if (content !== undefined) snapshotMap.set(file.path, content);
      }

      const result = applyMultiFilePatchPlan(fileContents, entry.plan, {
        selectedEdits: sel.selectedEdits,
        safetyConfig
      });
      multiFileResults.push(result);
    }
  }

  const totalApplied = singleFileResults.filter((r) => r.applied.transactions.some((t) => t.applied)).length
    + multiFileResults.reduce((sum, r) => sum + r.results.filter((fr) => !fr.skipped).length, 0);

  const summary = `Smart refinement: ${totalApplied} file(s) modified`;

  return {
    result: { singleFileResults, multiFileResults, summary },
    snapshot: { snapshots: snapshotMap, appliedAt: Date.now() }
  };
}

// ── rollback ────────────────────────────────────────────────────────

/**
 * Restore all files to their pre-apply state using snapshots.
 */
export function buildRollbackContents(snapshot: SmartRefinementSnapshot): Map<string, string> {
  return new Map(snapshot.snapshots);
}

// ── auto-apply (safe edits only) ────────────────────────────────────

/**
 * Build an ApplyDecision that only includes safe, non-conflicting edits.
 * Used for unattended/auto-apply mode.
 */
export function buildSafeAutoApplyDecision(preview: RefinementPreview): ApplyDecision {
  const singleFileSelections: ApplyDecision["singleFileSelections"] = [];

  for (let i = 0; i < preview.singleFilePreviews.length; i++) {
    const entry = preview.singleFilePreviews[i];
    const conflictIndices = new Set(entry.conflicts.map((c) => c.editIndex));

    const safeIndices: number[] = [];
    for (let j = 0; j < entry.plan.edits.length; j++) {
      const edit = entry.plan.edits[j] as any;
      const risk = edit.risk ?? "safe";
      const confidence = edit.confidence ?? 1;
      const isSafe = risk === "safe" && confidence >= 0.8 && !conflictIndices.has(j);

      // Also check preview safety issues
      const previewEdit = entry.preview.edits[j];
      const hasSafetyIssues = previewEdit?.safetyIssues?.length > 0;

      if (isSafe && !hasSafetyIssues) safeIndices.push(j);
    }

    if (safeIndices.length > 0) {
      singleFileSelections.push({ planIndex: i, selectedEditIndices: safeIndices });
    }
  }

  // For multi-file plans, same logic per file
  const multiFileSelections: ApplyDecision["multiFileSelections"] = [];

  for (let i = 0; i < preview.multiFilePreviews.length; i++) {
    const entry = preview.multiFilePreviews[i];
    const selectedEdits = new Map<string, number[]>();
    let hasAny = false;

    for (const fp of entry.filePreviews) {
      const conflictIndices = new Set(fp.conflicts.map((c) => c.editIndex));
      const fileInPlan = entry.plan.files.find((f) => f.path === fp.path);
      if (!fileInPlan) continue;

      const safeIndices: number[] = [];
      for (let j = 0; j < fileInPlan.edits.length; j++) {
        const edit = fileInPlan.edits[j];
        const risk = edit.risk ?? "safe";
        const confidence = edit.confidence ?? 1;
        const isSafe = risk === "safe" && confidence >= 0.8 && !conflictIndices.has(j);
        const hasSafetyIssues = fp.preview.edits[j]?.safetyIssues?.length > 0;

        if (isSafe && !hasSafetyIssues) safeIndices.push(j);
      }

      if (safeIndices.length > 0) {
        selectedEdits.set(fp.path, safeIndices);
        hasAny = true;
      }
    }

    if (hasAny) {
      multiFileSelections.push({ planIndex: i, selectedEdits });
    }
  }

  return { singleFileSelections, multiFileSelections };
}

// ── markdown formatting ─────────────────────────────────────────────

export function toMarkdownRefinementPreview(preview: RefinementPreview): string {
  const lines: string[] = ["# Refinement Preview"];

  if (preview.parseResult.errors.length) {
    lines.push(`\n## Parse Warnings`);
    for (const err of preview.parseResult.errors) {
      lines.push(`- ${err}`);
    }
  }

  lines.push(`\nTODOs found: ${preview.todoCount}`);

  for (const entry of preview.singleFilePreviews) {
    lines.push("");
    lines.push(toMarkdownPatchPlanPreview(entry.preview));
    if (entry.conflicts.length) {
      lines.push(`\n### Conflicts`);
      for (const c of entry.conflicts) {
        lines.push(`- Edit ${c.editIndex + 1} (${c.conflict}): ${c.detail}`);
      }
    }
  }

  for (const entry of preview.multiFilePreviews) {
    lines.push(`\n## Multi-File Plan: ${entry.plan.title ?? "(untitled)"}`);
    for (const fp of entry.filePreviews) {
      lines.push("");
      lines.push(toMarkdownPatchPlanPreview(fp.preview));
      if (fp.conflicts.length) {
        lines.push(`\n### Conflicts`);
        for (const c of fp.conflicts) {
          lines.push(`- Edit ${c.editIndex + 1} (${c.conflict}): ${c.detail}`);
        }
      }
    }
  }

  return lines.join("\n");
}
