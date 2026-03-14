import { applyPatchSet, previewPatch, rollbackTransactions, type NotePatch, type PatchTransaction } from "./patcher";
import { runSafetyChecks, type PatchSafetyConfig, type SafetyCheckResult } from "./patch-safety";

// ── v1 types (preserved for backward compat) ────────────────────────

export interface PatchPlanEdit {
  find: string;
  replace: string;
  reason: string;
  replaceAll?: boolean;
}

export interface PatchPlan {
  path: string;
  title?: string;
  edits: PatchPlanEdit[];
}

// ── v2 types ─────────────────────────────────────────────────────────

export type EditRisk = "safe" | "moderate" | "unsafe";

export interface PatchPlanEditV2 extends PatchPlanEdit {
  confidence?: number; // 0..1
  risk?: EditRisk;
}

export interface FilePatchPlan {
  path: string;
  title?: string;
  edits: PatchPlanEditV2[];
}

export interface MultiFilePatchPlan {
  title?: string;
  files: FilePatchPlan[];
}

export interface PatchPlanValidation {
  valid: boolean;
  issues: string[];
}

export interface PatchPlanPreview {
  path: string;
  title?: string;
  summary: {
    totalEdits: number;
    appliedEdits: number;
    totalOccurrences: number;
    safeEdits: number;
    unsafeEdits: number;
  };
  edits: Array<{
    index: number;
    reason: string;
    applied: boolean;
    occurrences: number;
    status: string;
    beforeSample: string;
    afterSample: string;
    confidence?: number;
    risk?: EditRisk;
    safetyIssues: string[];
  }>;
}

export interface AppliedPatchPlan {
  finalContent: string;
  transactions: PatchTransaction[];
  snapshot: string; // pre-apply content snapshot
  summary: string;
}

export interface ConflictInfo {
  editIndex: number;
  reason: string;
  find: string;
  conflict: "stale" | "ambiguous";
  detail: string;
}

// ── multi-file types ─────────────────────────────────────────────────

export interface MultiFileApplyResult {
  title?: string;
  results: Array<{
    path: string;
    applied: AppliedPatchPlan;
    safetyCheck: SafetyCheckResult;
    conflicts: ConflictInfo[];
    skipped: boolean;
  }>;
  summary: string;
}

// ── validation ───────────────────────────────────────────────────────

export function validatePatchPlan(plan: PatchPlan): PatchPlanValidation {
  const issues: string[] = [];
  if (!plan.path.trim()) issues.push("path is required");
  if (!Array.isArray(plan.edits) || plan.edits.length === 0) {
    issues.push("at least one edit is required");
  }

  const seenEditKeys = new Set<string>();
  plan.edits.forEach((edit, idx) => {
    if (!edit.find) issues.push(`edit ${idx + 1}: find is required`);
    if (edit.find.length > 20_000) issues.push(`edit ${idx + 1}: find token is too large`);
    if (edit.find === edit.replace) issues.push(`edit ${idx + 1}: find and replace are identical`);
    if (!edit.reason?.trim()) issues.push(`edit ${idx + 1}: reason is required`);
    const dedupeKey = `${edit.find}\u0000${edit.replace}\u0000${Boolean(edit.replaceAll)}`;
    if (seenEditKeys.has(dedupeKey)) issues.push(`edit ${idx + 1}: duplicate edit`);
    seenEditKeys.add(dedupeKey);
  });

  return { valid: issues.length === 0, issues };
}

export function validateMultiFilePatchPlan(plan: MultiFilePatchPlan): PatchPlanValidation {
  const issues: string[] = [];
  if (!plan.files.length) issues.push("at least one file is required");
  for (const file of plan.files) {
    const fileValidation = validatePatchPlan(file);
    if (!fileValidation.valid) {
      issues.push(...fileValidation.issues.map((i) => `[${file.path}] ${i}`));
    }
  }
  return { valid: issues.length === 0, issues };
}

// ── conflict detection ───────────────────────────────────────────────

export function detectConflicts(content: string, edits: PatchPlanEditV2[]): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  let simulated = content;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const occurrences = countOccurrences(simulated, edit.find);

    if (occurrences === 0) {
      conflicts.push({
        editIndex: i,
        reason: edit.reason,
        find: edit.find.slice(0, 100),
        conflict: "stale",
        detail: "find text not present in content (stale region)"
      });
    } else if (occurrences > 1 && !edit.replaceAll) {
      conflicts.push({
        editIndex: i,
        reason: edit.reason,
        find: edit.find.slice(0, 100),
        conflict: "ambiguous",
        detail: `find text matches ${occurrences} locations; consider replaceAll or a more specific find`
      });
    }

    // Simulate the edit to check subsequent edits against post-apply state
    if (occurrences > 0) {
      simulated = edit.replaceAll
        ? simulated.split(edit.find).join(edit.replace)
        : simulated.replace(edit.find, edit.replace);
    }
  }

  return conflicts;
}

function countOccurrences(content: string, find: string): number {
  if (!find) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    idx = content.indexOf(find, idx);
    if (idx < 0) return count;
    count += 1;
    idx += find.length;
  }
}

// ── preview ──────────────────────────────────────────────────────────

export function previewPatchPlan(
  content: string,
  plan: PatchPlan,
  safetyConfig?: PatchSafetyConfig
): PatchPlanPreview {
  let next = content;
  const edits = plan.edits.map((edit, idx) => {
    const v2 = edit as PatchPlanEditV2;
    const safety = runSafetyChecks(plan.path, edit.find, edit.replace, safetyConfig);

    const p = previewPatch(next, {
      path: plan.path,
      find: edit.find,
      replace: edit.replace,
      reason: edit.reason,
      replaceAll: edit.replaceAll
    });
    if (p.applied) {
      next = edit.replaceAll ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, edit.replace);
    }
    return {
      index: idx + 1,
      reason: edit.reason,
      applied: p.applied,
      occurrences: p.occurrences,
      status: p.applied ? "applied" : "no-op (find text not found)",
      beforeSample: p.beforeSample,
      afterSample: p.afterSample,
      confidence: v2.confidence,
      risk: v2.risk,
      safetyIssues: safety.issues
    };
  });

  return {
    path: plan.path,
    title: plan.title,
    summary: {
      totalEdits: edits.length,
      appliedEdits: edits.filter((e) => e.applied).length,
      totalOccurrences: edits.reduce((sum, e) => sum + e.occurrences, 0),
      safeEdits: edits.filter((e) => (e.risk ?? "safe") === "safe" && e.safetyIssues.length === 0).length,
      unsafeEdits: edits.filter((e) => e.risk === "unsafe" || e.safetyIssues.length > 0).length
    },
    edits
  };
}

// ── apply (with snapshot + optional subset) ──────────────────────────

export function applyPatchPlan(
  content: string,
  plan: PatchPlan,
  options?: { selectedIndices?: number[]; safetyConfig?: PatchSafetyConfig }
): AppliedPatchPlan {
  const snapshot = content;
  const selected = options?.selectedIndices;

  const editsToApply = selected
    ? plan.edits.filter((_, i) => selected.includes(i))
    : plan.edits;

  const patches: NotePatch[] = editsToApply.map((edit) => ({
    path: plan.path,
    find: edit.find,
    replace: edit.replace,
    reason: edit.reason,
    replaceAll: edit.replaceAll
  }));

  // Safety checks — skip edits that fail safety
  const safePatchesAndTxs: { patch: NotePatch; safetyOk: boolean }[] = patches.map((patch) => {
    if (!options?.safetyConfig) return { patch, safetyOk: true };
    const check = runSafetyChecks(patch.path, patch.find, patch.replace, options.safetyConfig);
    return { patch, safetyOk: check.safe };
  });

  const filteredPatches = safePatchesAndTxs.filter((p) => p.safetyOk).map((p) => p.patch);
  const applied = applyPatchSet(content, filteredPatches);
  const appliedCount = applied.transactions.filter((tx) => tx.applied).length;
  const skippedCount = safePatchesAndTxs.filter((p) => !p.safetyOk).length;

  let summary = `Applied ${appliedCount}/${patches.length} edit(s)`;
  if (skippedCount) summary += ` (${skippedCount} blocked by safety)`;
  if (selected) summary += ` [subset: ${selected.length}/${plan.edits.length} selected]`;

  return {
    finalContent: applied.finalContent,
    transactions: applied.transactions,
    snapshot,
    summary
  };
}

// ── multi-file apply ─────────────────────────────────────────────────

export function applyMultiFilePatchPlan(
  fileContents: Map<string, string>,
  plan: MultiFilePatchPlan,
  options?: { selectedEdits?: Map<string, number[]>; safetyConfig?: PatchSafetyConfig }
): MultiFileApplyResult {
  const results: MultiFileApplyResult["results"] = [];

  for (const file of plan.files) {
    const content = fileContents.get(file.path);
    if (content === undefined) {
      results.push({
        path: file.path,
        applied: { finalContent: "", transactions: [], snapshot: "", summary: "file not found" },
        safetyCheck: { safe: false, issues: [`file "${file.path}" not found in provided contents`] },
        conflicts: [],
        skipped: true
      });
      continue;
    }

    const safetyCheck = runSafetyChecks(file.path, "", "", options?.safetyConfig);
    const conflicts = detectConflicts(content, file.edits);
    const staleConflicts = conflicts.filter((c) => c.conflict === "stale");

    // Skip file entirely if path is protected
    if (!safetyCheck.safe) {
      results.push({
        path: file.path,
        applied: { finalContent: content, transactions: [], snapshot: content, summary: "blocked by safety" },
        safetyCheck,
        conflicts,
        skipped: true
      });
      continue;
    }

    const selectedIndices = options?.selectedEdits?.get(file.path);
    const applied = applyPatchPlan(content, file, {
      selectedIndices,
      safetyConfig: options?.safetyConfig
    });

    results.push({
      path: file.path,
      applied,
      safetyCheck,
      conflicts,
      skipped: false
    });
  }

  const totalApplied = results.filter((r) => !r.skipped).length;
  const totalSkipped = results.filter((r) => r.skipped).length;
  const summary = `Multi-file patch: ${totalApplied} file(s) processed, ${totalSkipped} skipped`;

  return { title: plan.title, results, summary };
}

// ── rollback ─────────────────────────────────────────────────────────

export function rollbackPatchPlan(content: string, transactions: PatchTransaction[]): string {
  return rollbackTransactions(content, transactions);
}

export function rollbackToSnapshot(snapshot: string): string {
  return snapshot;
}

// ── markdown formatting ──────────────────────────────────────────────

export function toMarkdownPatchPlanPreview(preview: PatchPlanPreview): string {
  const lines = [
    "## Patch Plan Preview",
    preview.title ? `Title: ${preview.title}` : null,
    `Path: ${preview.path}`,
    `Summary: ${preview.summary.appliedEdits}/${preview.summary.totalEdits} edits apply · ${preview.summary.totalOccurrences} total occurrences`,
    preview.summary.unsafeEdits ? `⚠ ${preview.summary.unsafeEdits} edit(s) flagged unsafe` : null,
    ""
  ].filter(Boolean) as string[];

  for (const edit of preview.edits) {
    lines.push(`### Edit ${edit.index}: ${edit.reason}`);
    lines.push(`- Applied: ${edit.applied ? "yes" : "no"}`);
    lines.push(`- Status: ${edit.status}`);
    lines.push(`- Occurrences: ${edit.occurrences}`);
    if (edit.confidence !== undefined) lines.push(`- Confidence: ${(edit.confidence * 100).toFixed(0)}%`);
    if (edit.risk) lines.push(`- Risk: ${edit.risk}`);
    if (edit.safetyIssues.length) {
      lines.push(`- Safety issues: ${edit.safetyIssues.join("; ")}`);
    }
    lines.push("- Before sample:");
    lines.push("```md");
    lines.push(edit.beforeSample);
    lines.push("```");
    lines.push("- After sample:");
    lines.push("```md");
    lines.push(edit.afterSample);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
