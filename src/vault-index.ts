export type { VaultNote, VaultFile, VaultEventRef, VaultAdapter } from "./vault-adapter";
export { InMemoryVaultAdapter } from "./vault-adapter";

import type { VaultAdapter } from "./vault-adapter";

export interface VaultNoteResult {
  path: string;
  content: string;
  mtime: number;
}

export class VaultIndexer {
  constructor(private readonly adapter: VaultAdapter) {}

  async recentNotes(lookbackDays: number): Promise<VaultNoteResult[]> {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const files = this.adapter.listMarkdownFiles().filter((f) => f.mtime >= cutoff);
    return Promise.all(
      files.map(async (f) => ({
        path: f.path,
        content: await this.adapter.read(f.path),
        mtime: f.mtime
      }))
    );
  }

  async topNotesForQuery(query: string, maxResults: number): Promise<VaultNoteResult[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const files = this.adapter.listMarkdownFiles();
    const notes = await Promise.all(
      files.map(async (f) => ({
        path: f.path,
        content: await this.adapter.read(f.path),
        mtime: f.mtime
      }))
    );

    return notes
      .map((note) => {
        const hay = `${note.path}\n${note.content}`.toLowerCase();
        const score = terms.reduce((acc, t) => (hay.includes(t) ? acc + 1 : acc), 0);
        return { note, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((x) => x.note);
  }
}
