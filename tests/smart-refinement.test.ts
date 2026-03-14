import { describe, expect, it } from "vitest";
import {
  buildRefinementPreview,
  applyRefinementDecision,
  buildSafeAutoApplyDecision,
  buildRollbackContents,
  toMarkdownRefinementPreview,
  type ApplyDecision
} from "../src/smart-refinement";

const SINGLE_PLAN_LLM = '```json\n' + JSON.stringify({
  path: "notes/test.md",
  title: "Fix typos",
  edits: [
    { find: "teh", replace: "the", reason: "typo fix", confidence: 0.99, risk: "safe" },
    { find: "wrold", replace: "world", reason: "typo fix", confidence: 0.95, risk: "safe" }
  ]
}) + '\n```';

const MULTI_PLAN_LLM = '```json\n' + JSON.stringify({
  title: "Bulk fix",
  files: [
    { path: "a.md", edits: [{ find: "old", replace: "new", reason: "update", confidence: 0.9, risk: "safe" }] },
    { path: "b.md", edits: [{ find: "foo", replace: "bar", reason: "rename", confidence: 0.5, risk: "moderate" }] }
  ]
}) + '\n```';

// ── preview ─────────────────────────────────────────────────────────

describe("buildRefinementPreview", () => {
  it("builds preview from single-file LLM output", () => {
    const contents = new Map([["notes/test.md", "teh wrold is big"]]);
    const candidates = [{ path: "notes/test.md", content: "teh wrold is big" }];

    const preview = buildRefinementPreview(SINGLE_PLAN_LLM, contents, candidates);
    expect(preview.singleFilePreviews).toHaveLength(1);
    expect(preview.multiFilePreviews).toHaveLength(0);

    const fp = preview.singleFilePreviews[0];
    expect(fp.preview.summary.appliedEdits).toBe(2);
    expect(fp.conflicts).toHaveLength(0);
  });

  it("builds preview from multi-file LLM output", () => {
    const contents = new Map([["a.md", "old content"], ["b.md", "foo fighters"]]);
    const candidates = [
      { path: "a.md", content: "old content" },
      { path: "b.md", content: "foo fighters" }
    ];

    const preview = buildRefinementPreview(MULTI_PLAN_LLM, contents, candidates);
    expect(preview.multiFilePreviews).toHaveLength(1);
    expect(preview.multiFilePreviews[0].filePreviews).toHaveLength(2);
  });

  it("detects stale conflicts in preview", () => {
    const staleLLM = '```json\n' + JSON.stringify({
      path: "x.md",
      edits: [{ find: "missing text", replace: "y", reason: "fix" }]
    }) + '\n```';
    const contents = new Map([["x.md", "actual content here"]]);
    const preview = buildRefinementPreview(staleLLM, contents, []);

    expect(preview.singleFilePreviews[0].conflicts).toHaveLength(1);
    expect(preview.singleFilePreviews[0].conflicts[0].conflict).toBe("stale");
  });

  it("counts TODOs from candidates", () => {
    const contents = new Map([["notes/test.md", "teh wrold"]]);
    const candidates = [{ path: "t.md", content: "- [ ] do something\n- [ ] another" }];
    const preview = buildRefinementPreview(SINGLE_PLAN_LLM, contents, candidates);
    expect(preview.todoCount).toBe(2);
  });
});

// ── apply ───────────────────────────────────────────────────────────

describe("applyRefinementDecision", () => {
  it("applies all edits from a single-file plan", () => {
    const contents = new Map([["notes/test.md", "teh wrold is big"]]);
    const candidates = [{ path: "notes/test.md", content: "teh wrold is big" }];
    const preview = buildRefinementPreview(SINGLE_PLAN_LLM, contents, candidates);

    const decision: ApplyDecision = {
      singleFileSelections: [{ planIndex: 0 }]
    };

    const { result, snapshot } = applyRefinementDecision(preview, decision, contents);
    expect(result.singleFileResults).toHaveLength(1);
    expect(result.singleFileResults[0].applied.finalContent).toBe("the world is big");
    expect(snapshot.snapshots.get("notes/test.md")).toBe("teh wrold is big");
  });

  it("applies subset of edits", () => {
    const contents = new Map([["notes/test.md", "teh wrold is big"]]);
    const candidates = [{ path: "notes/test.md", content: "teh wrold is big" }];
    const preview = buildRefinementPreview(SINGLE_PLAN_LLM, contents, candidates);

    const decision: ApplyDecision = {
      singleFileSelections: [{ planIndex: 0, selectedEditIndices: [0] }]
    };

    const { result } = applyRefinementDecision(preview, decision, contents);
    expect(result.singleFileResults[0].applied.finalContent).toBe("the wrold is big");
  });

  it("applies multi-file plan", () => {
    const contents = new Map([["a.md", "old content"], ["b.md", "foo fighters"]]);
    const candidates = [{ path: "a.md", content: "old content" }];
    const preview = buildRefinementPreview(MULTI_PLAN_LLM, contents, candidates);

    const decision: ApplyDecision = {
      multiFileSelections: [{ planIndex: 0 }]
    };

    const { result, snapshot } = applyRefinementDecision(preview, decision, contents);
    expect(result.multiFileResults).toHaveLength(1);
    expect(snapshot.snapshots.has("a.md")).toBe(true);
    expect(snapshot.snapshots.has("b.md")).toBe(true);
  });
});

// ── safe auto-apply ─────────────────────────────────────────────────

describe("buildSafeAutoApplyDecision", () => {
  it("selects only safe high-confidence non-conflicting edits", () => {
    const mixedLLM = '```json\n' + JSON.stringify({
      path: "t.md",
      edits: [
        { find: "aaa", replace: "AAA", reason: "safe", confidence: 0.99, risk: "safe" },
        { find: "bbb", replace: "BBB", reason: "risky", confidence: 0.9, risk: "unsafe" },
        { find: "ccc", replace: "CCC", reason: "low confidence", confidence: 0.3, risk: "safe" }
      ]
    }) + '\n```';

    const contents = new Map([["t.md", "aaa bbb ccc"]]);
    const preview = buildRefinementPreview(mixedLLM, contents, []);
    const decision = buildSafeAutoApplyDecision(preview);

    expect(decision.singleFileSelections).toHaveLength(1);
    expect(decision.singleFileSelections![0].selectedEditIndices).toEqual([0]);
  });

  it("skips conflicting edits even if safe", () => {
    const staleLLM = '```json\n' + JSON.stringify({
      path: "t.md",
      edits: [
        { find: "missing", replace: "x", reason: "stale", confidence: 1.0, risk: "safe" },
        { find: "hello", replace: "hi", reason: "ok", confidence: 0.95, risk: "safe" }
      ]
    }) + '\n```';

    const contents = new Map([["t.md", "hello world"]]);
    const preview = buildRefinementPreview(staleLLM, contents, []);
    const decision = buildSafeAutoApplyDecision(preview);

    expect(decision.singleFileSelections).toHaveLength(1);
    // Only edit index 1 should be selected (the non-stale one)
    expect(decision.singleFileSelections![0].selectedEditIndices).toEqual([1]);
  });

  it("returns empty selections when no edits are safe", () => {
    const unsafeLLM = '```json\n' + JSON.stringify({
      path: "t.md",
      edits: [{ find: "x", replace: "y", reason: "risky", confidence: 0.9, risk: "unsafe" }]
    }) + '\n```';

    const contents = new Map([["t.md", "x marks the spot"]]);
    const preview = buildRefinementPreview(unsafeLLM, contents, []);
    const decision = buildSafeAutoApplyDecision(preview);

    expect(decision.singleFileSelections).toHaveLength(0);
  });
});

// ── rollback ────────────────────────────────────────────────────────

describe("buildRollbackContents", () => {
  it("returns snapshot map for file restoration", () => {
    const snapshot = {
      snapshots: new Map([["a.md", "original a"], ["b.md", "original b"]]),
      appliedAt: Date.now()
    };

    const rollback = buildRollbackContents(snapshot);
    expect(rollback.get("a.md")).toBe("original a");
    expect(rollback.get("b.md")).toBe("original b");
  });
});

// ── markdown formatting ─────────────────────────────────────────────

describe("toMarkdownRefinementPreview", () => {
  it("produces readable markdown with previews and conflicts", () => {
    const contents = new Map([["notes/test.md", "teh wrold is big"]]);
    const candidates = [{ path: "notes/test.md", content: "teh wrold is big" }];
    const preview = buildRefinementPreview(SINGLE_PLAN_LLM, contents, candidates);

    const md = toMarkdownRefinementPreview(preview);
    expect(md).toContain("# Refinement Preview");
    expect(md).toContain("Patch Plan Preview");
    expect(md).toContain("typo fix");
  });

  it("shows parse warnings", () => {
    const contents = new Map<string, string>();
    const preview = buildRefinementPreview("no json here", contents, []);
    const md = toMarkdownRefinementPreview(preview);
    expect(md).toContain("Parse Warnings");
    expect(md).toContain("no JSON blocks");
  });
});
