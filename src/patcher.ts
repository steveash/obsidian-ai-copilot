export interface NotePatch {
  path: string;
  find: string;
  replace: string;
  reason: string;
}

export interface ApplyResult {
  path: string;
  applied: boolean;
  reason?: string;
  updatedContent: string;
}

export function applyPatch(content: string, patch: NotePatch): ApplyResult {
  if (!patch.find) {
    return { path: patch.path, applied: false, reason: "empty find", updatedContent: content };
  }
  if (!content.includes(patch.find)) {
    return { path: patch.path, applied: false, reason: "find text not found", updatedContent: content };
  }
  return {
    path: patch.path,
    applied: true,
    updatedContent: content.replace(patch.find, patch.replace)
  };
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
