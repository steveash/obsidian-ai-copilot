export interface NotePatch {
  path: string;
  find: string;
  replace: string;
  reason: string;
  replaceAll?: boolean;
}

export interface ApplyResult {
  path: string;
  applied: boolean;
  reason?: string;
  updatedContent: string;
  occurrences?: number;
}

export interface PatchPreview {
  path: string;
  reason: string;
  applied: boolean;
  beforeSample: string;
  afterSample: string;
  occurrences: number;
}

export interface PatchTransaction {
  patch: NotePatch;
  original: string;
  updated: string;
  applied: boolean;
  rollbackPatch: NotePatch | null;
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

function sampleAround(content: string, needle: string, radius = 50): string {
  if (!needle) return content.slice(0, radius * 2);
  const idx = content.indexOf(needle);
  if (idx < 0) return content.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + needle.length + radius);
  return content.slice(start, end);
}

export function applyPatch(content: string, patch: NotePatch): ApplyResult {
  if (!patch.find) {
    return { path: patch.path, applied: false, reason: "empty find", updatedContent: content, occurrences: 0 };
  }
  const occurrences = countOccurrences(content, patch.find);
  if (!occurrences) {
    return {
      path: patch.path,
      applied: false,
      reason: "find text not found",
      updatedContent: content,
      occurrences: 0
    };
  }
  const updatedContent = patch.replaceAll
    ? content.split(patch.find).join(patch.replace)
    : content.replace(patch.find, patch.replace);
  return {
    path: patch.path,
    applied: true,
    updatedContent,
    occurrences
  };
}

export function previewPatch(content: string, patch: NotePatch): PatchPreview {
  const applied = applyPatch(content, patch);
  return {
    path: patch.path,
    reason: patch.reason,
    applied: applied.applied,
    beforeSample: sampleAround(content, patch.find),
    afterSample: sampleAround(applied.updatedContent, patch.replace || patch.find),
    occurrences: applied.occurrences ?? 0
  };
}

export function applyPatchTransaction(content: string, patch: NotePatch): PatchTransaction {
  const result = applyPatch(content, patch);
  return {
    patch,
    original: content,
    updated: result.updatedContent,
    applied: result.applied,
    rollbackPatch: result.applied ? buildRollbackPatch(content, result.updatedContent, patch.path) : null
  };
}

export function applyPatchSet(content: string, patches: NotePatch[]): { finalContent: string; transactions: PatchTransaction[] } {
  let next = content;
  const transactions: PatchTransaction[] = [];
  for (const patch of patches) {
    const tx = applyPatchTransaction(next, patch);
    transactions.push(tx);
    next = tx.updated;
  }
  return { finalContent: next, transactions };
}

export function rollbackTransactions(content: string, transactions: PatchTransaction[]): string {
  let next = content;
  for (const tx of [...transactions].reverse()) {
    if (!tx.rollbackPatch) continue;
    const rolled = applyPatch(next, tx.rollbackPatch);
    next = rolled.updatedContent;
  }
  return next;
}

export function buildRollbackPatch(original: string, updated: string, path: string): NotePatch | null {
  if (original === updated) return null;
  return {
    path,
    find: updated,
    replace: original,
    reason: "rollback"
  };
}
