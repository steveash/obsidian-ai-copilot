import { describe, expect, it } from "vitest";
import { mergeChunkResultsToFullNotes } from "../src/retrieval-context";
import { removeIndexedNote, syncIndexedNote } from "../src/indexing-sync";
import { InMemoryVectorStorage, PersistentVectorIndex } from "../src/vector-index";
import type { RetrievedNote } from "../src/semantic-retrieval";

class MockEmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    return [text.length, text.split(/\s+/).length, 1];
  }
}

describe("integration: event-driven indexing + retrieval context", () => {
  it("indexes note updates and removes deleted note vectors", async () => {
    const storage = new InMemoryVectorStorage();
    const index = new PersistentVectorIndex(storage, new MockEmbeddingProvider());

    await syncIndexedNote(
      index,
      {
        path: "daily/note.md",
        content: "# Plan\nShip feature\n\n## Tasks\n- [ ] write tests",
        mtime: 100
      },
      "test-model",
      1200
    );

    const afterCreate = await storage.load();
    const createdRecords = Object.values(afterCreate.records).filter((r) => r.path === "daily/note.md");
    expect(createdRecords.length).toBeGreaterThan(0);

    await syncIndexedNote(
      index,
      {
        path: "daily/note.md",
        content: "# Plan\nShip hardened feature\n\n## Tasks\n- [ ] write integration tests",
        mtime: 200
      },
      "test-model",
      1200
    );

    const afterModify = await storage.load();
    const modifiedRecords = Object.values(afterModify.records).filter((r) => r.path === "daily/note.md");
    expect(modifiedRecords.length).toBeGreaterThan(0);
    expect(modifiedRecords.some((r) => (r.textPreview ?? "").includes("hardened"))).toBe(true);

    await removeIndexedNote(index, "daily/note.md");

    const afterDelete = await storage.load();
    const deletedRecords = Object.values(afterDelete.records).filter((r) => r.path === "daily/note.md");
    expect(deletedRecords).toHaveLength(0);
  });

  it("keeps relevant sections and full note content in merged retrieval", () => {
    const chunks: RetrievedNote[] = [
      {
        path: "project/alpha.md",
        content: "# Goals\nMost relevant section",
        score: 0.9,
        lexicalScore: 0.7,
        semanticScore: 0.8,
        freshnessScore: 0.4,
        graphBoost: 0,
        metadata: { tags: [], links: [], headings: ["Goals"], fullContent: "# Alpha\nFull note body" }
      },
      {
        path: "project/alpha.md",
        content: "# Notes\nSecondary context",
        score: 0.7,
        lexicalScore: 0.6,
        semanticScore: 0.6,
        freshnessScore: 0.4,
        graphBoost: 0,
        metadata: { tags: [], links: [], headings: ["Notes"], fullContent: "# Alpha\nFull note body" }
      }
    ];

    const merged = mergeChunkResultsToFullNotes(chunks);
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toContain("## Relevant Section 1");
    expect(merged[0].content).toContain("Most relevant section");
    expect(merged[0].content).toContain("## Full Note (project/alpha.md)");
    expect(merged[0].content).toContain("# Alpha\nFull note body");
  });
});
