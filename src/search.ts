export interface SearchableNote {
  path: string;
  content: string;
}

export interface RankedNote extends SearchableNote {
  score: number;
  matchedTerms: string[];
}

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((x) => x.length > 1);
}

export function rankNotesByQuery(notes: SearchableNote[], query: string, maxResults = 5): RankedNote[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];

  return notes
    .map((note) => {
      const hay = `${note.path}\n${note.content}`.toLowerCase();
      const matchedTerms = terms.filter((term) => hay.includes(term));
      const exactPhraseBonus = hay.includes(query.toLowerCase()) ? 1.5 : 0;
      const coverage = matchedTerms.length / terms.length;
      const density = matchedTerms.length / Math.max(1, tokenize(note.content).length);
      const score = coverage * 3 + density + exactPhraseBonus;
      return { ...note, score, matchedTerms };
    })
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
