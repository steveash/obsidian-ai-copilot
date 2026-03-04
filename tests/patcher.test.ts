import { describe, expect, it } from "vitest";
import { applyPatch, buildRollbackPatch } from "../src/patcher";

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
