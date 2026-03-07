import { describe, expect, it } from "vitest";
import { HeuristicReranker, createReranker } from "../src/reranker";

describe("HeuristicReranker", () => {
  it("reorders based on query term hits", async () => {
    const r = new HeuristicReranker();
    const out = await r.rerank("obsidian plugin", [
      { id: "1", text: "grocery list", score: 1 },
      { id: "2", text: "obsidian plugin architecture", score: 1 }
    ]);
    expect(out[0].id).toBe("2");
  });

  it("factory picks heuristic", () => {
    const r = createReranker({ rerankerType: "heuristic" } as any);
    expect(r).toBeInstanceOf(HeuristicReranker);
  });
});
