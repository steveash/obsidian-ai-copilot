import { describe, expect, it } from "vitest";
import { RetrievalOrchestrator } from "../src/retrieval-orchestrator";
import { InMemoryVectorStorage, PersistentVectorIndex } from "../src/vector-index";

class MockEmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    return [text.length, text.includes("release") ? 2 : 1, text.split(/\s+/).length % 7];
  }
}

describe("integration: retrieval orchestrator", () => {
  it("returns relevant sections and full note body", async () => {
    const index = new PersistentVectorIndex(new InMemoryVectorStorage(), new MockEmbeddingProvider());
    const notes = [
      {
        path: "projects/release.md",
        content: "# Plan\nrelease checklist\n\n## Notes\nship with tests",
        mtime: Date.now()
      },
      {
        path: "random.md",
        content: "# Grocery\nbuy milk",
        mtime: Date.now() - 10_000
      }
    ];

    const orchestrator = new RetrievalOrchestrator({
      getAllNotes: async () => notes,
      getVectorIndex: () => index,
      getSettings: () => ({
        embeddingModel: "test-model",
        retrievalChunkSize: 1200,
        preselectCandidateCount: 10,
        retrievalLexicalWeight: 0.6,
        retrievalSemanticWeight: 0.3,
        retrievalFreshnessWeight: 0.1,
        retrievalGraphExpandHops: 1,
        rerankerEnabled: false,
        rerankerTopK: 5
      } as any)
    });

    const results = await orchestrator.getRelevantNotes("release checklist", 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("## Relevant Section 1");
    expect(results[0].content).toContain("## Full Note (projects/release.md)");
    expect(results[0].content).toContain("release checklist");
  });
});
