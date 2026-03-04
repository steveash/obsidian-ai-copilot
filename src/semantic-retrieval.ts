export interface NoteDoc {
  path: string;
  content: string;
  mtime?: number;
}

export interface HybridResult extends NoteDoc {
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

export interface HybridOptions {
  maxResults: number;
  lexicalWeight: number;
  semanticWeight: number;
  freshnessWeight: number;
  graphExpandHops: number;
}

const DEFAULT_DIM = 256;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9#\[\]\/\-\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function embed(text: string, dim = DEFAULT_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  for (const tok of tokens) {
    const idx = hashToken(tok) % dim;
    vec[idx] += 1;

    // char trigram features improve fuzzy semantic-ish overlap for morph variants
    for (let i = 0; i < Math.max(0, tok.length - 2); i++) {
      const tri = tok.slice(i, i + 3);
      vec[hashToken(`tri:${tri}`) % dim] += 0.35;
    }
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

function extractMetadata(content: string) {
  const tags = [...content.matchAll(/(^|\s)#([a-zA-Z0-9_\/-]+)/g)].map((m) => m[2].toLowerCase());
  const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split("|")[0].trim());
  const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim());
  return { tags, links, headings };
}

function lexicalScore(doc: NoteDoc, queryTerms: string[]): number {
  const hay = `${doc.path}\n${doc.content}`.toLowerCase();
  if (!queryTerms.length) return 0;
  const matches = queryTerms.filter((t) => hay.includes(t));
  const coverage = matches.length / queryTerms.length;
  const phrase = hay.includes(queryTerms.join(" ")) ? 0.5 : 0;
  return coverage + phrase;
}

function freshnessScore(mtime: number | undefined): number {
  if (!mtime) return 0;
  const ageDays = (Date.now() - mtime) / (1000 * 60 * 60 * 24);
  return 1 / (1 + Math.max(0, ageDays));
}

export function hybridRetrieve(notes: NoteDoc[], query: string, options: HybridOptions): HybridResult[] {
  const qTerms = tokenize(query);
  const qVec = embed(query);

  const base = notes.map((doc) => {
    const metadata = extractMetadata(doc.content);
    const sem = cosine(embed(`${doc.path}\n${doc.content}`), qVec);
    const lex = lexicalScore(doc, qTerms);
    const fresh = freshnessScore(doc.mtime);
    return {
      ...doc,
      metadata,
      lexicalScore: lex,
      semanticScore: sem,
      freshnessScore: fresh,
      graphBoost: 0,
      score: options.lexicalWeight * lex + options.semanticWeight * sem + options.freshnessWeight * fresh
    };
  });

  // lightweight graph enrichment: boost notes linked from already-relevant notes
  if (options.graphExpandHops > 0) {
    const pathMap = new Map(base.map((b) => [b.path, b]));
    const topSeed = [...base].sort((a, b) => b.score - a.score).slice(0, Math.max(3, options.maxResults));
    for (const seed of topSeed) {
      for (const link of seed.metadata.links) {
        const direct = pathMap.get(link) || pathMap.get(`${link}.md`);
        if (direct) {
          direct.graphBoost += 0.15;
          direct.score += 0.15;
        }
      }
    }
  }

  return base
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxResults);
}
