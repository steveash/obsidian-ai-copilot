export interface StoredVector {
  path: string;
  contentHash: string;
  model: string;
  vector: number[];
  updatedAt: number;
}

export interface VectorIndexData {
  version: 1;
  records: Record<string, StoredVector>;
}

export interface VectorStorage {
  load(): Promise<VectorIndexData>;
  save(data: VectorIndexData): Promise<void>;
}

export interface EmbeddingProvider {
  embed(text: string, model: string): Promise<number[]>;
}

export class InMemoryVectorStorage implements VectorStorage {
  private data: VectorIndexData = { version: 1, records: {} };
  async load(): Promise<VectorIndexData> { return this.data; }
  async save(data: VectorIndexData): Promise<void> { this.data = data; }
}

export function contentHash(input: string): string {
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 ^= c + 31;
    h2 = Math.imul(h2, 16777619);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

export class PersistentVectorIndex {
  private cache: VectorIndexData | null = null;
  constructor(private readonly storage: VectorStorage, private readonly provider: EmbeddingProvider) {}

  private async ensureLoaded() {
    if (!this.cache) this.cache = await this.storage.load();
  }

  async getOrCreate(path: string, content: string, model: string): Promise<number[]> {
    await this.ensureLoaded();
    const hash = contentHash(content);
    const rec = this.cache!.records[path];
    if (rec && rec.contentHash === hash && rec.model === model) return rec.vector;

    const vector = await this.provider.embed(content, model);
    this.cache!.records[path] = {
      path,
      contentHash: hash,
      model,
      vector,
      updatedAt: Date.now()
    };
    await this.storage.save(this.cache!);
    return vector;
  }

  async rebuild(entries: Array<{ path: string; content: string }>, model: string): Promise<number> {
    await this.ensureLoaded();
    for (const e of entries) {
      await this.getOrCreate(e.path, e.content, model);
    }
    return entries.length;
  }
}
