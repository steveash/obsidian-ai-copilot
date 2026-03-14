import type { PatchPlan, MultiFilePatchPlan, PatchPlanEditV2, FilePatchPlan } from "./patch-plan";

export interface ParseResult {
  plans: PatchPlan[];
  multiFilePlans: MultiFilePatchPlan[];
  errors: string[];
}

/**
 * Extract JSON code blocks from an LLM response string.
 * Handles ```json ... ``` fenced blocks and bare JSON objects/arrays.
 */
export function extractJsonBlocks(text: string): string[] {
  const blocks: string[] = [];

  // Fenced code blocks (```json ... ```)
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenced.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }

  // If no fenced blocks found, try bare top-level JSON objects/arrays
  if (blocks.length === 0) {
    const bare = /(?:^|\n)\s*(\{[\s\S]*?\})\s*(?:\n|$)/g;
    while ((match = bare.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }
    const bareArr = /(?:^|\n)\s*(\[[\s\S]*?\])\s*(?:\n|$)/g;
    while ((match = bareArr.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }
  }

  return blocks;
}

/**
 * Determine if a parsed object looks like a PatchPlan (single file).
 */
function isPatchPlanShape(obj: unknown): obj is PatchPlan {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return typeof o.path === "string" && Array.isArray(o.edits);
}

/**
 * Determine if a parsed object looks like a MultiFilePatchPlan.
 */
function isMultiFilePatchPlanShape(obj: unknown): obj is MultiFilePatchPlan {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return Array.isArray(o.files) && (o.files as unknown[]).every(
    (f) => isPatchPlanShape(f)
  );
}

/**
 * Normalize a raw edit object into a PatchPlanEditV2, applying defaults.
 */
function normalizeEdit(raw: Record<string, unknown>, index: number): { edit: PatchPlanEditV2; error?: string } {
  const find = typeof raw.find === "string" ? raw.find : "";
  const replace = typeof raw.replace === "string" ? raw.replace : "";
  const reason = typeof raw.reason === "string" ? raw.reason : `edit ${index + 1}`;
  const replaceAll = raw.replaceAll === true;

  if (!find) {
    return { edit: { find, replace, reason, replaceAll }, error: `edit ${index + 1}: missing find string` };
  }

  const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : undefined;
  const risk = (raw.risk === "safe" || raw.risk === "moderate" || raw.risk === "unsafe") ? raw.risk : undefined;

  return {
    edit: { find, replace, reason, replaceAll, confidence, risk }
  };
}

/**
 * Parse a single JSON object into a PatchPlan, normalizing fields.
 */
function parseSinglePlan(obj: Record<string, unknown>): { plan: PatchPlan; errors: string[] } {
  const errors: string[] = [];
  const path = typeof obj.path === "string" ? obj.path : "";
  const title = typeof obj.title === "string" ? obj.title : undefined;

  if (!path) errors.push("missing path field");

  const rawEdits = Array.isArray(obj.edits) ? obj.edits : [];
  if (rawEdits.length === 0) errors.push("no edits provided");

  const edits: PatchPlanEditV2[] = [];
  for (let i = 0; i < rawEdits.length; i++) {
    const raw = rawEdits[i];
    if (!raw || typeof raw !== "object") {
      errors.push(`edit ${i + 1}: not an object`);
      continue;
    }
    const { edit, error } = normalizeEdit(raw as Record<string, unknown>, i);
    if (error) errors.push(error);
    else edits.push(edit);
  }

  return { plan: { path, title, edits }, errors };
}

/**
 * Parse LLM response text into structured patch plans.
 *
 * Supports:
 * - Single PatchPlan JSON: `{ "path": "...", "edits": [...] }`
 * - MultiFilePatchPlan JSON: `{ "files": [{ "path": "...", "edits": [...] }, ...] }`
 * - Array of PatchPlans: `[{ "path": "...", "edits": [...] }, ...]`
 * - Multiple JSON blocks in one response
 */
export function parseLLMPatchResponse(text: string): ParseResult {
  const result: ParseResult = { plans: [], multiFilePlans: [], errors: [] };
  const blocks = extractJsonBlocks(text);

  if (blocks.length === 0) {
    result.errors.push("no JSON blocks found in LLM response");
    return result;
  }

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch (e) {
      result.errors.push(`invalid JSON: ${(e as Error).message}`);
      continue;
    }

    // Array of plans
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isPatchPlanShape(item)) {
          const { plan, errors } = parseSinglePlan(item as unknown as Record<string, unknown>);
          result.plans.push(plan);
          result.errors.push(...errors);
        }
      }
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) {
      result.errors.push("JSON block is not an object or array");
      continue;
    }

    // Multi-file plan
    if (isMultiFilePatchPlanShape(parsed)) {
      const multi = parsed as unknown as Record<string, unknown>;
      const title = typeof multi.title === "string" ? multi.title : undefined;
      const files: FilePatchPlan[] = [];
      for (const f of (multi.files as unknown[])) {
        const { plan, errors } = parseSinglePlan(f as Record<string, unknown>);
        files.push(plan as FilePatchPlan);
        result.errors.push(...errors);
      }
      result.multiFilePlans.push({ title, files });
      continue;
    }

    // Single plan
    if (isPatchPlanShape(parsed)) {
      const { plan, errors } = parseSinglePlan(parsed as unknown as Record<string, unknown>);
      result.plans.push(plan);
      result.errors.push(...errors);
      continue;
    }

    result.errors.push("JSON block does not match PatchPlan or MultiFilePatchPlan shape");
  }

  return result;
}

/**
 * Build an LLM system prompt that instructs the model to produce structured patch plans.
 */
export function buildPatchPlanSystemPrompt(): string {
  return [
    "You are an Obsidian note refinement assistant that produces structured edits.",
    "For each note that needs changes, output a JSON patch plan inside a ```json code block.",
    "",
    "Single-file format:",
    '```json',
    '{',
    '  "path": "folder/note.md",',
    '  "title": "Brief description of changes",',
    '  "edits": [',
    '    {',
    '      "find": "exact text to find",',
    '      "replace": "replacement text",',
    '      "reason": "why this change",',
    '      "confidence": 0.95,',
    '      "risk": "safe"',
    '    }',
    '  ]',
    '}',
    '```',
    "",
    "Multi-file format:",
    '```json',
    '{',
    '  "title": "Bulk refinement",',
    '  "files": [',
    '    { "path": "note1.md", "edits": [...] },',
    '    { "path": "note2.md", "edits": [...] }',
    '  ]',
    '}',
    '```',
    "",
    "Rules:",
    "- find must be an exact substring of the note content (not a regex)",
    "- keep find strings short but unique enough to match exactly once",
    "- set replaceAll: true only when ALL occurrences should be replaced",
    "- confidence: 0.0-1.0 indicating how certain the edit is correct",
    '- risk: "safe" for formatting/typo fixes, "moderate" for content changes, "unsafe" for structural changes',
    "- Preserve the author's intent — suggest, don't rewrite",
    "- If no edits are needed for a note, omit it entirely"
  ].join("\n");
}
