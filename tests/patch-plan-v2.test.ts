import { describe, expect, it } from "vitest";
import {
  applyPatchPlan,
  applyMultiFilePatchPlan,
  detectConflicts,
  previewPatchPlan,
  rollbackPatchPlan,
  rollbackToSnapshot,
  toMarkdownPatchPlanPreview,
  validateMultiFilePatchPlan,
  validatePatchPlan,
  type MultiFilePatchPlan,
  type PatchPlan,
  type PatchPlanEditV2
} from "../src/patch-plan";

// ── conflict detection ───────────────────────────────────────────────

describe("detectConflicts", () => {
  it("detects stale find regions", () => {
    const content = "hello world";
    const edits: PatchPlanEditV2[] = [
      { find: "missing text", replace: "x", reason: "fix" }
    ];
    const conflicts = detectConflicts(content, edits);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflict).toBe("stale");
    expect(conflicts[0].detail).toContain("stale");
  });

  it("detects ambiguous multi-match without replaceAll", () => {
    const content = "foo bar foo baz foo";
    const edits: PatchPlanEditV2[] = [
      { find: "foo", replace: "qux", reason: "rename" }
    ];
    const conflicts = detectConflicts(content, edits);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflict).toBe("ambiguous");
    expect(conflicts[0].detail).toContain("3 locations");
  });

  it("no conflict for replaceAll with multiple matches", () => {
    const content = "foo bar foo";
    const edits: PatchPlanEditV2[] = [
      { find: "foo", replace: "qux", reason: "rename", replaceAll: true }
    ];
    const conflicts = detectConflicts(content, edits);
    expect(conflicts).toHaveLength(0);
  });

  it("detects stale caused by earlier edit consuming text", () => {
    const content = "abc def";
    const edits: PatchPlanEditV2[] = [
      { find: "abc", replace: "xyz", reason: "first" },
      { find: "abc", replace: "123", reason: "second" }
    ];
    const conflicts = detectConflicts(content, edits);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].editIndex).toBe(1);
    expect(conflicts[0].conflict).toBe("stale");
  });

  it("returns empty for clean edits", () => {
    const content = "hello world";
    const edits: PatchPlanEditV2[] = [
      { find: "hello", replace: "hi", reason: "greet" }
    ];
    expect(detectConflicts(content, edits)).toHaveLength(0);
  });
});

// ── subset apply ─────────────────────────────────────────────────────

describe("subset apply", () => {
  const content = "aaa bbb ccc";
  const plan: PatchPlan = {
    path: "test.md",
    edits: [
      { find: "aaa", replace: "AAA", reason: "upper a" },
      { find: "bbb", replace: "BBB", reason: "upper b" },
      { find: "ccc", replace: "CCC", reason: "upper c" }
    ]
  };

  it("applies only selected indices", () => {
    const result = applyPatchPlan(content, plan, { selectedIndices: [0, 2] });
    expect(result.finalContent).toBe("AAA bbb CCC");
    expect(result.summary).toContain("subset");
    expect(result.summary).toContain("2/3 selected");
  });

  it("applies all when no selection", () => {
    const result = applyPatchPlan(content, plan);
    expect(result.finalContent).toBe("AAA BBB CCC");
  });

  it("stores pre-apply snapshot", () => {
    const result = applyPatchPlan(content, plan);
    expect(result.snapshot).toBe(content);
  });
});

// ── snapshot rollback ────────────────────────────────────────────────

describe("rollback", () => {
  it("rollbackToSnapshot returns exact original", () => {
    const original = "original content here";
    expect(rollbackToSnapshot(original)).toBe(original);
  });

  it("transaction rollback preserves content", () => {
    const content = "hello world";
    const plan: PatchPlan = {
      path: "t.md",
      edits: [
        { find: "hello", replace: "hi", reason: "short" },
        { find: "world", replace: "earth", reason: "rename" }
      ]
    };
    const applied = applyPatchPlan(content, plan);
    expect(applied.finalContent).toBe("hi earth");
    const rolled = rollbackPatchPlan(applied.finalContent, applied.transactions);
    expect(rolled).toBe(content);
  });
});

// ── safety-gated apply ───────────────────────────────────────────────

describe("safety-gated apply", () => {
  it("blocks edits touching secrets", () => {
    const content = "key: sk-abcdefghijklmnopqrstuvwx here";
    const plan: PatchPlan = {
      path: "notes/config.md",
      edits: [
        { find: "sk-abcdefghijklmnopqrstuvwx", replace: "[redacted]", reason: "remove key" }
      ]
    };
    const result = applyPatchPlan(content, plan, { safetyConfig: {} });
    expect(result.finalContent).toBe(content); // blocked
    expect(result.summary).toContain("blocked by safety");
  });

  it("allows edits when secret checking disabled", () => {
    const content = "key: sk-abcdefghijklmnopqrstuvwx here";
    const plan: PatchPlan = {
      path: "notes/config.md",
      edits: [
        { find: "sk-abcdefghijklmnopqrstuvwx", replace: "[redacted]", reason: "remove key" }
      ]
    };
    const result = applyPatchPlan(content, plan, {
      safetyConfig: { blockSecretTouching: false }
    });
    expect(result.finalContent).toContain("[redacted]");
  });
});

// ── multi-file patch plan ────────────────────────────────────────────

describe("multi-file patch plan", () => {
  it("validates multi-file plans", () => {
    const plan: MultiFilePatchPlan = {
      title: "bulk fix",
      files: [
        { path: "a.md", edits: [{ find: "x", replace: "y", reason: "fix" }] },
        { path: "", edits: [] }
      ]
    };
    const v = validateMultiFilePatchPlan(plan);
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.includes("path is required"))).toBe(true);
  });

  it("applies edits across multiple files", () => {
    const plan: MultiFilePatchPlan = {
      title: "normalize",
      files: [
        { path: "a.md", edits: [{ find: "old", replace: "new", reason: "update" }] },
        { path: "b.md", edits: [{ find: "foo", replace: "bar", reason: "rename" }] }
      ]
    };
    const contents = new Map([
      ["a.md", "old content"],
      ["b.md", "foo fighters"]
    ]);
    const result = applyMultiFilePatchPlan(contents, plan);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].applied.finalContent).toBe("new content");
    expect(result.results[1].applied.finalContent).toBe("bar fighters");
    expect(result.results[0].skipped).toBe(false);
    expect(result.summary).toContain("2 file(s) processed");
  });

  it("skips missing files gracefully", () => {
    const plan: MultiFilePatchPlan = {
      files: [
        { path: "missing.md", edits: [{ find: "x", replace: "y", reason: "fix" }] }
      ]
    };
    const result = applyMultiFilePatchPlan(new Map(), plan);
    expect(result.results[0].skipped).toBe(true);
    expect(result.results[0].safetyCheck.issues[0]).toContain("not found");
  });

  it("skips protected paths", () => {
    const plan: MultiFilePatchPlan = {
      files: [
        { path: ".obsidian/config.json", edits: [{ find: "x", replace: "y", reason: "fix" }] }
      ]
    };
    const contents = new Map([[".obsidian/config.json", "x content"]]);
    const result = applyMultiFilePatchPlan(contents, plan);
    expect(result.results[0].skipped).toBe(true);
    expect(result.results[0].applied.finalContent).toBe("x content"); // unchanged
  });

  it("supports per-file subset selection", () => {
    const plan: MultiFilePatchPlan = {
      files: [{
        path: "a.md",
        edits: [
          { find: "aaa", replace: "AAA", reason: "first" },
          { find: "bbb", replace: "BBB", reason: "second" }
        ]
      }]
    };
    const contents = new Map([["a.md", "aaa bbb"]]);
    const selectedEdits = new Map([["a.md", [1]]]);
    const result = applyMultiFilePatchPlan(contents, plan, { selectedEdits });
    expect(result.results[0].applied.finalContent).toBe("aaa BBB");
  });
});

// ── preview with v2 fields ───────────────────────────────────────────

describe("preview with v2 fields", () => {
  it("includes confidence and risk in preview", () => {
    const content = "hello world";
    const plan: PatchPlan = {
      path: "test.md",
      edits: [
        { find: "hello", replace: "hi", reason: "shorten", confidence: 0.95, risk: "safe" } as PatchPlanEditV2
      ]
    };
    const preview = previewPatchPlan(content, plan);
    expect(preview.edits[0].confidence).toBe(0.95);
    expect(preview.edits[0].risk).toBe("safe");
    expect(preview.summary.safeEdits).toBe(1);
    expect(preview.summary.unsafeEdits).toBe(0);
  });

  it("counts unsafe edits in summary", () => {
    const content = "hello world";
    const plan: PatchPlan = {
      path: "test.md",
      edits: [
        { find: "hello", replace: "hi", reason: "shorten", risk: "unsafe" } as PatchPlanEditV2
      ]
    };
    const preview = previewPatchPlan(content, plan);
    expect(preview.summary.unsafeEdits).toBe(1);
  });

  it("includes safety issues in markdown preview", () => {
    const content = "hello world";
    const plan: PatchPlan = {
      path: ".obsidian/config.json",
      edits: [
        { find: "hello", replace: "hi", reason: "shorten", risk: "unsafe" } as PatchPlanEditV2
      ]
    };
    const preview = previewPatchPlan(content, plan);
    const md = toMarkdownPatchPlanPreview(preview);
    expect(md).toContain("flagged unsafe");
    expect(md).toContain("Risk: unsafe");
    expect(md).toContain("Safety issues:");
  });
});
