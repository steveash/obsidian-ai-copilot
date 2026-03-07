export interface NoteDoc {
  path: string;
  content: string;
  mtime?: number;
}

export interface RetrievedNoteMetadata {
  tags: string[];
  links: string[];
  headings: string[];
  fullContent?: string;
}

export interface RetrievedNote extends NoteDoc {
  score: number;
  lexicalScore: number;
  semanticScore: number;
  freshnessScore: number;
  graphBoost: number;
  metadata: RetrievedNoteMetadata;
}

export interface RetrievalQueryConstraints {
  folder?: string;
  tag?: string;
  link?: string;
  before?: number;
  after?: number;
  terms: string[];
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9#\[\]\/\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function parseQueryConstraints(query: string): RetrievalQueryConstraints {
  const parts = query.split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  const out: RetrievalQueryConstraints = { terms };

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith("folder:")) {
      out.folder = lower.slice("folder:".length).replace(/^\/+/, "");
      continue;
    }
    if (lower.startsWith("tag:")) {
      out.tag = lower.slice("tag:".length).replace(/^#/, "");
      continue;
    }
    if (lower.startsWith("link:")) {
      out.link = part.slice("link:".length).replace(/\.md$/i, "");
      continue;
    }
    if (lower.startsWith("before:")) {
      const ts = Date.parse(part.slice("before:".length));
      if (Number.isFinite(ts)) out.before = ts;
      continue;
    }
    if (lower.startsWith("after:")) {
      const ts = Date.parse(part.slice("after:".length));
      if (Number.isFinite(ts)) out.after = ts;
      continue;
    }
    terms.push(part);
  }

  return out;
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
  const matches = queryTerms.filter((t) => hay.includes(t.toLowerCase()));
  const coverage = matches.length / queryTerms.length;
  const phrase = hay.includes(queryTerms.join(" ").toLowerCase()) ? 0.5 : 0;
  return coverage + phrase;
}

export function freshnessScore(mtime: number | undefined): number {
  if (!mtime) return 0;
  const ageDays = (Date.now() - mtime) / (1000 * 60 * 60 * 24);
  return 1 / (1 + Math.max(0, ageDays));
}

export function passesQueryConstraints(doc: NoteDoc, metadata: RetrievedNoteMetadata, q: RetrievalQueryConstraints): boolean {
  if (q.folder && !doc.path.toLowerCase().startsWith(q.folder.toLowerCase())) return false;
  if (q.tag && !metadata.tags.includes(q.tag.toLowerCase())) return false;
  if (q.link) {
    const needle = q.link.toLowerCase();
    const has = metadata.links.some((l) => l.toLowerCase() === needle || l.toLowerCase() === `${needle}.md`);
    if (!has) return false;
  }
  if (q.before && doc.mtime && doc.mtime > q.before) return false;
  if (q.after && doc.mtime && doc.mtime < q.after) return false;
  return true;
}

export function metadataBoost(doc: NoteDoc, metadata: RetrievedNoteMetadata, q: RetrievalQueryConstraints): number {
  let boost = 0;
  if (q.folder && doc.path.toLowerCase().startsWith(q.folder.toLowerCase())) boost += 0.18;
  if (q.tag && metadata.tags.includes(q.tag.toLowerCase())) boost += 0.2;
  if (q.link) {
    const needle = q.link.toLowerCase();
    if (metadata.links.some((l) => l.toLowerCase() === needle || l.toLowerCase() === `${needle}.md`)) boost += 0.2;
  }
  if (q.terms.length && metadata.headings.some((h) => q.terms.some((t) => h.toLowerCase().includes(t.toLowerCase())))) {
    boost += 0.08;
  }
  return boost;
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
