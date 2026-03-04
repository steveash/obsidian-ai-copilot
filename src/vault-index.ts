export interface VaultNote {
  path: string;
  content: string;
  mtime: number;
}

export interface VaultAdapter {
  listMarkdownNotes(): Promise<VaultNote[]>;
}

export class VaultIndexer {
  constructor(private readonly adapter: VaultAdapter) {}

  async recentNotes(lookbackDays: number): Promise<VaultNote[]> {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const all = await this.adapter.listMarkdownNotes();
    return all.filter((n) => n.mtime >= cutoff);
  }

  async topNotesForQuery(query: string, maxResults: number): Promise<VaultNote[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const all = await this.adapter.listMarkdownNotes();
    return all
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

export class InMemoryVaultAdapter implements VaultAdapter {
  constructor(private readonly notes: VaultNote[]) {}
  async listMarkdownNotes(): Promise<VaultNote[]> {
    return this.notes;
  }
}
