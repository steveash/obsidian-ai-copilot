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
  warnings?: string[];
}

const FILTER_KEYS = new Set(["folder", "tag", "link", "before", "after"]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9#\[\]\/\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function tokenizeQueryPreservingQuotes(query: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i])) i += 1;
    if (i >= query.length) break;

    let token = "";
    while (i < query.length && !/\s/.test(query[i])) {
      if ((query[i] === '"' || query[i] === "'") && token.endsWith(":")) {
        const quote = query[i++];
        while (i < query.length && query[i] !== quote) {
          if (query[i] === "\\" && i + 1 < query.length) {
            token += query[i + 1];
            i += 2;
            continue;
          }
          token += query[i++];
        }
        if (query[i] === quote) i += 1;
        continue;
      }
      token += query[i++];
    }

    if (token) out.push(token);
  }
  return out;
}

function normalizeFolder(folder: string): string | null {
  const cleaned = folder.trim().replace(/^\.?\/+/, "").replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!cleaned || cleaned.includes("..")) return null;
  return cleaned.toLowerCase();
}

function normalizeTag(tag: string): string | null {
  const cleaned = tag.trim().replace(/^#/, "").toLowerCase();
  if (!cleaned || !/^[a-z0-9_\/-]+$/.test(cleaned)) return null;
  return cleaned;
}

function normalizeLink(link: string): string | null {
  const cleaned = link.trim().replace(/\.md$/i, "").replace(/^\[\[|\]\]$/g, "");
  if (!cleaned || cleaned.includes("\n")) return null;
  return cleaned;
}

function parseDateMs(input: string): number | null {
  const ts = Date.parse(input.trim());
  return Number.isFinite(ts) ? ts : null;
}

export function parseQueryConstraints(query: string): RetrievalQueryConstraints {
  const terms: string[] = [];
  const warnings: string[] = [];
  const out: RetrievalQueryConstraints = { terms, warnings };

  const tokens = tokenizeQueryPreservingQuotes(query);
  for (const token of tokens) {
    const sepIdx = token.indexOf(":");
    if (sepIdx <= 0) {
      terms.push(token);
      continue;
    }

    const key = token.slice(0, sepIdx).toLowerCase();
    const rawValue = token.slice(sepIdx + 1).trim();
    if (!FILTER_KEYS.has(key) || !rawValue) {
      terms.push(token);
      continue;
    }

    if (key === "folder") {
      const value = normalizeFolder(rawValue);
      if (value) out.folder = value;
      else {
        warnings.push(`Invalid folder filter: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }

    if (key === "tag") {
      const value = normalizeTag(rawValue);
      if (value) out.tag = value;
      else {
        warnings.push(`Invalid tag filter: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }

    if (key === "link") {
      const value = normalizeLink(rawValue);
      if (value) out.link = value;
      else {
        warnings.push(`Invalid link filter: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }

    if (key === "before") {
      const value = parseDateMs(rawValue);
      if (value !== null) out.before = value;
      else {
        warnings.push(`Invalid before date: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }

    if (key === "after") {
      const value = parseDateMs(rawValue);
      if (value !== null) out.after = value;
      else {
        warnings.push(`Invalid after date: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }
  }

  if (out.before && out.after && out.before < out.after) {
    warnings.push("before date is earlier than after date; date filters ignored");
    delete out.before;
    delete out.after;
  }

  if (!out.warnings?.length) delete out.warnings;
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
