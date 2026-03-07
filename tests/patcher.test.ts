import { describe, expect, it } from "vitest";
import {
  applyPatch,
  applyPatchSet,
  buildRollbackPatch,
  previewPatch,
  rollbackTransactions
} from "../src/patcher";

describe("applyPatch", () => {
  it("applies patch when find exists", () => {
    const res = applyPatch("hello world", {
      path: "x.md",
      find: "world",
      replace: "obsidian",
      reason: "upgrade"
    });
    expect(res.applied).toBe(true);
    expect(res.updatedContent).toBe("hello obsidian");
    expect(res.occurrences).toBe(1);
  });

  it("returns non-applied result when missing", () => {
    const res = applyPatch("hello", {
      path: "x.md",
      find: "zzz",
      replace: "x",
      reason: "none"
    });
    expect(res.applied).toBe(false);
  });
});

describe("buildRollbackPatch", () => {
  it("builds inverse patch", () => {
    const rb = buildRollbackPatch("a", "b", "n.md");
    expect(rb?.find).toBe("b");
    expect(rb?.replace).toBe("a");
  });
});

describe("preview/apply/rollback workflow", () => {
  it("previews and rolls back a patch set", () => {
    const base = "# Plan\n- todo one\n- todo two\n";
    const preview = previewPatch(base, {
      path: "plan.md",
      find: "todo",
      replace: "done",
      reason: "promote task"
    });
    expect(preview.applied).toBe(true);
    expect(preview.beforeSample).toContain("todo");
    expect(preview.afterSample).toContain("done");

    const { finalContent, transactions } = applyPatchSet(base, [
      { path: "plan.md", find: "todo one", replace: "done one", reason: "line1" },
      { path: "plan.md", find: "todo two", replace: "done two", reason: "line2" }
    ]);

    expect(finalContent).toContain("done one");
    expect(finalContent).toContain("done two");

    const rolledBack = rollbackTransactions(finalContent, transactions);
    expect(rolledBack).toBe(base);
  });
});
