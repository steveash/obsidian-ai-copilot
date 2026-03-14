import { describe, expect, it } from "vitest";
import {
  extractJsonBlocks,
  parseLLMPatchResponse,
  buildPatchPlanSystemPrompt
} from "../src/patch-plan-parser";

// ── JSON extraction ─────────────────────────────────────────────────

describe("extractJsonBlocks", () => {
  it("extracts fenced json blocks", () => {
    const text = 'Some text\n```json\n{"path":"a.md","edits":[]}\n```\nmore text';
    const blocks = extractJsonBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(JSON.parse(blocks[0])).toEqual({ path: "a.md", edits: [] });
  });

  it("extracts multiple fenced blocks", () => {
    const text = '```json\n{"a":1}\n```\ntext\n```json\n{"b":2}\n```';
    expect(extractJsonBlocks(text)).toHaveLength(2);
  });

  it("handles fenced blocks without json language tag", () => {
    const text = '```\n{"path":"b.md","edits":[]}\n```';
    const blocks = extractJsonBlocks(text);
    expect(blocks).toHaveLength(1);
  });

  it("returns empty for plain text", () => {
    expect(extractJsonBlocks("just some notes about editing")).toHaveLength(0);
  });
});

// ── single plan parsing ─────────────────────────────────────────────

describe("parseLLMPatchResponse – single plan", () => {
  it("parses a valid single-file plan", () => {
    const text = '```json\n' + JSON.stringify({
      path: "notes/test.md",
      title: "Fix typos",
      edits: [
        { find: "teh", replace: "the", reason: "typo fix", confidence: 0.99, risk: "safe" }
      ]
    }) + '\n```';

    const result = parseLLMPatchResponse(text);
    expect(result.plans).toHaveLength(1);
    expect(result.multiFilePlans).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    const plan = result.plans[0];
    expect(plan.path).toBe("notes/test.md");
    expect(plan.title).toBe("Fix typos");
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].find).toBe("teh");
    expect(plan.edits[0].replace).toBe("the");
    expect((plan.edits[0] as any).confidence).toBe(0.99);
    expect((plan.edits[0] as any).risk).toBe("safe");
  });

  it("reports error for missing find string", () => {
    const text = '```json\n' + JSON.stringify({
      path: "a.md",
      edits: [{ find: "", replace: "x", reason: "fix" }]
    }) + '\n```';

    const result = parseLLMPatchResponse(text);
    expect(result.errors.some((e) => e.includes("missing find"))).toBe(true);
  });

  it("reports error for missing path", () => {
    const text = '```json\n' + JSON.stringify({
      path: "",
      edits: [{ find: "a", replace: "b", reason: "fix" }]
    }) + '\n```';

    const result = parseLLMPatchResponse(text);
    expect(result.errors.some((e) => e.includes("missing path"))).toBe(true);
  });

  it("defaults reason when missing", () => {
    const text = '```json\n' + JSON.stringify({
      path: "a.md",
      edits: [{ find: "old", replace: "new" }]
    }) + '\n```';

    const result = parseLLMPatchResponse(text);
    expect(result.plans[0].edits[0].reason).toBe("edit 1");
  });

  it("clamps confidence to [0, 1]", () => {
    const text = '```json\n' + JSON.stringify({
      path: "a.md",
      edits: [{ find: "x", replace: "y", reason: "fix", confidence: 1.5 }]
    }) + '\n```';

    const result = parseLLMPatchResponse(text);
    expect((result.plans[0].edits[0] as any).confidence).toBe(1.0);
  });
});

// ── multi-file plan parsing ─────────────────────────────────────────

describe("parseLLMPatchResponse – multi-file plan", () => {
  it("parses a multi-file plan", () => {
    const text = '```json\n' + JSON.stringify({
      title: "Bulk cleanup",
      files: [
        { path: "a.md", edits: [{ find: "foo", replace: "bar", reason: "rename" }] },
        { path: "b.md", edits: [{ find: "old", replace: "new", reason: "update" }] }
      ]
    }) + '\n```';

    const result = parseLLMPatchResponse(text);
    expect(result.multiFilePlans).toHaveLength(1);
    expect(result.plans).toHaveLength(0);

    const multi = result.multiFilePlans[0];
    expect(multi.title).toBe("Bulk cleanup");
    expect(multi.files).toHaveLength(2);
    expect(multi.files[0].path).toBe("a.md");
    expect(multi.files[1].path).toBe("b.md");
  });
});

// ── array of plans ──────────────────────────────────────────────────

describe("parseLLMPatchResponse – array", () => {
  it("parses an array of plans", () => {
    const text = '```json\n' + JSON.stringify([
      { path: "a.md", edits: [{ find: "x", replace: "y", reason: "fix" }] },
      { path: "b.md", edits: [{ find: "p", replace: "q", reason: "fix" }] }
    ]) + '\n```';

    const result = parseLLMPatchResponse(text);
    expect(result.plans).toHaveLength(2);
  });
});

// ── error handling ──────────────────────────────────────────────────

describe("parseLLMPatchResponse – errors", () => {
  it("reports error for no JSON blocks", () => {
    const result = parseLLMPatchResponse("Here are my suggestions: fix the typos.");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("no JSON blocks");
  });

  it("reports error for invalid JSON", () => {
    const result = parseLLMPatchResponse('```json\n{invalid json}\n```');
    expect(result.errors.some((e) => e.includes("invalid JSON"))).toBe(true);
  });

  it("reports error for non-matching shape", () => {
    const result = parseLLMPatchResponse('```json\n{"name":"not a patch"}\n```');
    expect(result.errors.some((e) => e.includes("does not match"))).toBe(true);
  });
});

// ── system prompt ───────────────────────────────────────────────────

describe("buildPatchPlanSystemPrompt", () => {
  it("returns a non-empty prompt string", () => {
    const prompt = buildPatchPlanSystemPrompt();
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("find");
    expect(prompt).toContain("replace");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("risk");
  });
});
