export interface NoteDoc {
  path: string;
  content: string;
  mtime?: number;
}

export interface RetrievedNote extends NoteDoc {
  score: number;
  lexicalScore: number;
  semanticScore: number;
  freshnessScore: number;
  graphBoost: number;
  metadata: {
    tags: string[];
    links: string[];
    headings: string[];
  };
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9#\[\]\/\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

export function extractMetadata(content: string) {
  const tags = [...content.matchAll(/(^|\s)#([a-zA-Z0-9_\/-]+)/g)].map((m) => m[2].toLowerCase());
  const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split("|")[0].trim());
  const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim());
  return { tags, links, headings };
}

export function lexicalScore(doc: NoteDoc, queryTerms: string[]): number {
  const hay = `${doc.path}\n${doc.content}`.toLowerCase();
  if (!queryTerms.length) return 0;
  const matches = queryTerms.filter((t) => hay.includes(t));
  const coverage = matches.length / queryTerms.length;
  const phrase = hay.includes(queryTerms.join(" ")) ? 0.5 : 0;
  return coverage + phrase;
}

export function freshnessScore(mtime: number | undefined): number {
  if (!mtime) return 0;
  const ageDays = (Date.now() - mtime) / (1000 * 60 * 60 * 24);
  return 1 / (1 + Math.max(0, ageDays));
}

export function applyGraphBoost(results: RetrievedNote[], maxResults: number, hops: number): RetrievedNote[] {
  if (hops <= 0) return results;
  const pathMap = new Map(results.map((r) => [r.path, r]));
  const topSeed = [...results].sort((a, b) => b.score - a.score).slice(0, Math.max(3, maxResults));
  for (const seed of topSeed) {
    for (const link of seed.metadata.links) {
      const direct = pathMap.get(link) || pathMap.get(`${link}.md`);
      if (direct) {
        direct.graphBoost += 0.15;
        direct.score += 0.15;
      }
    }
  }
  return results;
}
