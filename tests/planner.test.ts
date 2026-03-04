import { describe, expect, it } from "vitest";
import { buildRefinementPlan, toMarkdownPlan } from "../src/planner";

describe("buildRefinementPlan", () => {
  it("captures duplicate titles and todos", () => {
    const plan = buildRefinementPlan([
      { path: "A/Ideas.md", content: "TODO: first" },
      { path: "B/Ideas.md", content: "- [ ] second" },
      { path: "C/Long.md", content: "word ".repeat(60) }
    ]);

    expect(plan.todoCount).toBe(2);
    expect(plan.duplicateClusters).toHaveLength(1);
    expect(plan.suggestions.length).toBeGreaterThan(0);

    const markdown = toMarkdownPlan(plan);
    expect(markdown).toContain("Refinement Plan");
    expect(markdown).toContain("Duplicate clusters");
  });
});
