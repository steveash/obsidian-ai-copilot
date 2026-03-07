import { applyPatchSet, previewPatch, rollbackTransactions, type NotePatch, type PatchTransaction } from "./patcher";

export interface PatchPlanEdit {
  find: string;
  replace: string;
  reason: string;
}

export interface PatchPlan {
  path: string;
  title?: string;
  edits: PatchPlanEdit[];
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
  };
  edits: Array<{
    index: number;
    reason: string;
    applied: boolean;
    occurrences: number;
    beforeSample: string;
    afterSample: string;
  }>;
}

export interface AppliedPatchPlan {
  finalContent: string;
  transactions: PatchTransaction[];
  summary: string;
}

export function validatePatchPlan(plan: PatchPlan): PatchPlanValidation {
  const issues: string[] = [];
  if (!plan.path.trim()) issues.push("path is required");
  if (!Array.isArray(plan.edits) || plan.edits.length === 0) {
    issues.push("at least one edit is required");
  }

  plan.edits.forEach((edit, idx) => {
    if (!edit.find) issues.push(`edit ${idx + 1}: find is required`);
    if (edit.find === edit.replace) issues.push(`edit ${idx + 1}: find and replace are identical`);
    if (!edit.reason?.trim()) issues.push(`edit ${idx + 1}: reason is required`);
  });

  return { valid: issues.length === 0, issues };
}

export function previewPatchPlan(content: string, plan: PatchPlan): PatchPlanPreview {
  let next = content;
  const edits = plan.edits.map((edit, idx) => {
    const p = previewPatch(next, {
      path: plan.path,
      find: edit.find,
      replace: edit.replace,
      reason: edit.reason
    });
    if (p.applied) {
      next = next.replace(edit.find, edit.replace);
    }
    return {
      index: idx + 1,
      reason: edit.reason,
      applied: p.applied,
      occurrences: p.occurrences,
      beforeSample: p.beforeSample,
      afterSample: p.afterSample
    };
  });

  return {
    path: plan.path,
    title: plan.title,
    summary: {
      totalEdits: edits.length,
      appliedEdits: edits.filter((e) => e.applied).length,
      totalOccurrences: edits.reduce((sum, e) => sum + e.occurrences, 0)
    },
    edits
  };
}

export function applyPatchPlan(content: string, plan: PatchPlan): AppliedPatchPlan {
  const patches: NotePatch[] = plan.edits.map((edit) => ({
    path: plan.path,
    find: edit.find,
    replace: edit.replace,
    reason: edit.reason
  }));
  const applied = applyPatchSet(content, patches);
  const appliedCount = applied.transactions.filter((tx) => tx.applied).length;
  return {
    finalContent: applied.finalContent,
    transactions: applied.transactions,
    summary: `Applied ${appliedCount}/${patches.length} edit(s)`
  };
}

export function rollbackPatchPlan(content: string, transactions: PatchTransaction[]): string {
  return rollbackTransactions(content, transactions);
}

export function toMarkdownPatchPlanPreview(preview: PatchPlanPreview): string {
  const lines = [
    "## Patch Plan Preview",
    preview.title ? `Title: ${preview.title}` : null,
    `Path: ${preview.path}`,
    `Summary: ${preview.summary.appliedEdits}/${preview.summary.totalEdits} edits apply · ${preview.summary.totalOccurrences} total occurrences`,
    ""
  ].filter(Boolean) as string[];

  for (const edit of preview.edits) {
    lines.push(`### Edit ${edit.index}: ${edit.reason}`);
    lines.push(`- Applied: ${edit.applied ? "yes" : "no"}`);
    lines.push(`- Occurrences: ${edit.occurrences}`);
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
