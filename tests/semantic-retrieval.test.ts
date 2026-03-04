import { describe, expect, it } from "vitest";
import { hybridRetrieve } from "../src/semantic-retrieval";

describe("hybridRetrieve", () => {
  it("combines lexical + semantic + freshness signals", () => {
    const now = Date.now();
    const docs = [
      {
        path: "AI/Plugin Architecture.md",
        content: "# Architecture\nObsidian plugin semantic retrieval and embeddings",
        mtime: now - 1000
      },
      {
        path: "Random/Grocery.md",
        content: "milk eggs bread",
        mtime: now - 1000
      }
    ];

    const out = hybridRetrieve(docs, "obsidian semantic search", {
      maxResults: 2,
      lexicalWeight: 0.45,
      semanticWeight: 0.45,
      freshnessWeight: 0.1,
      graphExpandHops: 1
    });

    expect(out[0].path).toBe("AI/Plugin Architecture.md");
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it("applies graph boost for wikilinked notes", () => {
    const docs = [
      { path: "A.md", content: "Query topic [[B]]", mtime: Date.now() },
      { path: "B.md", content: "Deep details on query topic", mtime: Date.now() }
    ];

    const out = hybridRetrieve(docs, "query topic", {
      maxResults: 2,
      lexicalWeight: 0.5,
      semanticWeight: 0.4,
      freshnessWeight: 0.1,
      graphExpandHops: 1
    });

    const b = out.find((x) => x.path === "B.md");
    expect((b?.graphBoost ?? 0) > 0).toBe(true);
  });
});
