import { describe, expect, it } from "vitest";
import { InMemoryVaultAdapter, VaultIndexer } from "../src/vault-index";

describe("VaultIndexer", () => {
  const now = Date.now();
  const adapter = new InMemoryVaultAdapter([
    { path: "old.md", content: "legacy", mtime: now - 10 * 24 * 3600_000 },
    { path: "new.md", content: "obsidian plugin architecture", mtime: now - 1_000 },
    { path: "ideas.md", content: "plugin roadmap and todos", mtime: now - 2_000 }
  ]);

  it("filters recent notes", async () => {
    const indexer = new VaultIndexer(adapter);
    const recent = await indexer.recentNotes(2);
    expect(recent.map((n) => n.path)).toEqual(["new.md", "ideas.md"]);
  });

  it("ranks notes by query terms", async () => {
    const indexer = new VaultIndexer(adapter);
    const top = await indexer.topNotesForQuery("obsidian plugin", 2);
    expect(top[0].path).toBe("new.md");
    expect(top).toHaveLength(2);
  });
});
