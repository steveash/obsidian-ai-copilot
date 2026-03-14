const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9\-_]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{12,}/i
];

const DEFAULT_PROTECTED_PATHS = [
  ".obsidian/",
  ".git/",
  "node_modules/",
  ".env"
];

const DEFAULT_MAX_EDIT_SIZE = 50_000;

export interface PatchSafetyConfig {
  protectedPaths?: string[];
  maxEditSize?: number;
  blockSecretTouching?: boolean;
}

export interface SafetyCheckResult {
  safe: boolean;
  issues: string[];
}

export function checkPathProtected(
  path: string,
  protectedPaths: string[] = DEFAULT_PROTECTED_PATHS
): SafetyCheckResult {
  const issues: string[] = [];
  for (const pp of protectedPaths) {
    if (path === pp || path.startsWith(pp)) {
      issues.push(`path "${path}" is protected (matches "${pp}")`);
    }
  }
  return { safe: issues.length === 0, issues };
}

export function checkEditSize(
  find: string,
  replace: string,
  maxSize: number = DEFAULT_MAX_EDIT_SIZE
): SafetyCheckResult {
  const issues: string[] = [];
  if (find.length > maxSize) {
    issues.push(`find string exceeds max edit size (${find.length} > ${maxSize})`);
  }
  if (replace.length > maxSize) {
    issues.push(`replace string exceeds max edit size (${replace.length} > ${maxSize})`);
  }
  return { safe: issues.length === 0, issues };
}

export function checkSecretTouching(
  find: string,
  replace: string
): SafetyCheckResult {
  const issues: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(find)) {
      issues.push("find string contains a potential secret/credential pattern");
      break;
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(replace)) {
      issues.push("replace string contains a potential secret/credential pattern");
      break;
    }
  }
  return { safe: issues.length === 0, issues };
}

export function runSafetyChecks(
  path: string,
  find: string,
  replace: string,
  config: PatchSafetyConfig = {}
): SafetyCheckResult {
  const allIssues: string[] = [];

  const pathCheck = checkPathProtected(path, config.protectedPaths);
  allIssues.push(...pathCheck.issues);

  const sizeCheck = checkEditSize(find, replace, config.maxEditSize);
  allIssues.push(...sizeCheck.issues);

  if (config.blockSecretTouching !== false) {
    const secretCheck = checkSecretTouching(find, replace);
    allIssues.push(...secretCheck.issues);
  }

  return { safe: allIssues.length === 0, issues: allIssues };
}
