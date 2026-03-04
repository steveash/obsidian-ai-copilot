import { describe, expect, it } from "vitest";
import {
  buildRefinementPrompt,
  detectDuplicateTitleClusters,
  extractTodos
} from "../src/refinement";

describe("extractTodos", () => {
  it("extracts markdown and TODO-prefix tasks", () => {
    const input = [
      "- [ ] ship plugin",
      "- [x] done item",
      "TODO: write docs",
      "random"
    ].join("\n");
    expect(extractTodos(input)).toEqual(["- [ ] ship plugin", "TODO: write docs"]);
  });
});

describe("duplicate title clustering", () => {
  it("groups files with same basename", () => {
    const clusters = detectDuplicateTitleClusters([
      { path: "A/Ideas.md", content: "1" },
      { path: "B/Ideas.md", content: "2" },
      { path: "C/Other.md", content: "3" }
    ]);
    expect(clusters).toEqual([{ anchor: "A/Ideas.md", duplicates: ["B/Ideas.md"] }]);
  });
});

describe("buildRefinementPrompt", () => {
  it("includes web enrichment policy text", () => {
    const prompt = buildRefinementPrompt([{ path: "x.md", content: "abc" }], {
      enableWebEnrichment: false
    });
    expect(prompt).toContain("Do NOT require internet lookups");
  });
});
