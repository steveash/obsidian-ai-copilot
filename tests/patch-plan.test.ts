import { describe, expect, it } from "vitest";
import {
  applyPatchPlan,
  previewPatchPlan,
  rollbackPatchPlan,
  toMarkdownPatchPlanPreview,
  validatePatchPlan,
  type PatchPlan
} from "../src/patch-plan";

describe("patch plan validation + preview + rollback", () => {
  const base = "# Plan\n\t- [ ] one  \n\t- [ ] two\n";
  const plan: PatchPlan = {
    path: "plan.md",
    title: "Normalize markdown spacing",
    edits: [
      { find: "\t", replace: "  ", reason: "expand tabs" },
      { find: "  ", replace: " ", reason: "collapse double spaces" }
    ]
  };

  it("validates structured patch plans", () => {
    const ok = validatePatchPlan(plan);
    expect(ok.valid).toBe(true);

    const bad = validatePatchPlan({
      path: "",
      edits: [{ find: "x", replace: "x", reason: "" }]
    });
    expect(bad.valid).toBe(false);
    expect(bad.issues.length).toBeGreaterThan(1);
  });

  it("builds richer previews with summary", () => {
    const preview = previewPatchPlan(base, plan);
    expect(preview.summary.totalEdits).toBe(2);
    expect(preview.summary.appliedEdits).toBeGreaterThan(0);
    expect(preview.edits[0].beforeSample).toContain("\t");
    const md = toMarkdownPatchPlanPreview(preview);
    expect(md).toContain("Patch Plan Preview");
    expect(md).toContain("Summary:");
  });

  it("applies and rolls back consistently", () => {
    const applied = applyPatchPlan(base, plan);
    expect(applied.finalContent).not.toBe(base);
    expect(applied.summary).toContain("Applied");

    const rolled = rollbackPatchPlan(applied.finalContent, applied.transactions);
    expect(rolled).toBe(base);
  });
});
