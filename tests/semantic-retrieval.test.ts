import { describe, expect, it } from "vitest";
import { applyGraphBoost, cosine, tokenize } from "../src/semantic-retrieval";

describe("semantic utilities", () => {
  it("tokenizes queries", () => {
    expect(tokenize("Obsidian semantic-search!")).toContain("obsidian");
  });

  it("computes cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("applies graph boost from linked notes", () => {
    const boosted = applyGraphBoost(
      [
        {
          path: "A.md",
          content: "[[B]]",
          score: 1,
          lexicalScore: 1,
          semanticScore: 0.1,
          freshnessScore: 0.1,
          graphBoost: 0,
          metadata: { tags: [], links: ["B"], headings: [] }
        },
        {
          path: "B.md",
          content: "target",
          score: 0.2,
          lexicalScore: 0.2,
          semanticScore: 0.1,
          freshnessScore: 0.1,
          graphBoost: 0,
          metadata: { tags: [], links: [], headings: [] }
        }
      ],
      2,
      1
    );

    const b = boosted.find((x) => x.path === "B.md");
    expect((b?.graphBoost ?? 0) > 0).toBe(true);
  });
});
