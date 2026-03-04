import { describe, expect, it } from "vitest";
import { rankNotesByQuery } from "../src/search";

describe("rankNotesByQuery", () => {
  it("ranks more relevant notes first", () => {
    const ranked = rankNotesByQuery(
      [
        { path: "alpha.md", content: "obsidian plugin api guide" },
        { path: "beta.md", content: "shopping list eggs milk" }
      ],
      "obsidian plugin",
      2
    );

    expect(ranked[0].path).toBe("alpha.md");
    expect(ranked[0].score).toBeGreaterThan(0);
  });
});
