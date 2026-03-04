import { describe, expect, it } from "vitest";
import { buildRefinementPrompt } from "../src/refinement";

describe("buildRefinementPrompt", () => {
  it("includes note paths and content", () => {
    const prompt = buildRefinementPrompt([
      { path: "Daily/2026-03-04.md", content: "TODO: wire API" },
      { path: "Project/Ideas.md", content: "duplicate thought" }
    ]);

    expect(prompt).toContain("Daily/2026-03-04.md");
    expect(prompt).toContain("TODO: wire API");
    expect(prompt).toContain("Project/Ideas.md");
  });
});
