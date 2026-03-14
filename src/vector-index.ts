export interface StoredVector {
  id: string;
  path: string;
  chunkId?: string;
  contentHash: string;
  model: string;
  vector: number[];
  updatedAt: number;
  mtime?: number;
  textPreview?: string;
}

export interface VectorIndexData {
  version: 2;
  records: Record<string, StoredVector>;
}

type LegacyVectorIndexData = {
  version?: number;
  records?: Record<string, StoredVector>;
};

export interface VectorStorage {
  load(): Promise<VectorIndexData>;
  save(data: VectorIndexData): Promise<void>;
}

export interface EmbeddingProvider {
  embed(text: string, model: string): Promise<number[]>;
}

export class InMemoryVectorStorage implements VectorStorage {
  private data: VectorIndexData = { version: 2, records: {} };
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

  private normalizeLoadedData(loaded: VectorIndexData | LegacyVectorIndexData): VectorIndexData {
    if (loaded.version === 2 && loaded.records) {
      return { version: 2, records: loaded.records };
    }
    return { version: 2, records: loaded.records ?? {} };
  }

  private async ensureLoaded() {
    if (!this.cache) {
      const loaded = await this.storage.load();
      // migrate v1->v2 defensively
      this.cache = this.normalizeLoadedData(loaded);
    }
  }

  async getOrCreate(id: string, path: string, content: string, model: string, mtime?: number): Promise<number[]> {
    await this.ensureLoaded();
    if (!this.cache) throw new Error("Vector cache failed to initialize");
    const hash = contentHash(content);
    const rec = this.cache.records[id];
    if (rec && rec.contentHash === hash && rec.model === model) return rec.vector;

    const vector = await this.provider.embed(content, model);
    this.cache.records[id] = {
      id,
      path,
      chunkId: id.includes("#") ? id : undefined,
      contentHash: hash,
      model,
      vector,
      updatedAt: Date.now(),
      mtime,
      textPreview: content.slice(0, 180)
    };
    await this.storage.save(this.cache);
    return vector;
  }

  async indexChunks(chunks: Array<{ id: string; path: string; content: string; mtime?: number }>, model: string): Promise<number> {
    await this.ensureLoaded();
    for (const c of chunks) {
      await this.getOrCreate(c.id, c.path, c.content, model, c.mtime);
    }
    return chunks.length;
  }

  async removePath(path: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.cache) throw new Error("Vector cache failed to initialize");
    for (const key of Object.keys(this.cache.records)) {
      if (this.cache.records[key].path === path) delete this.cache.records[key];
    }
    await this.storage.save(this.cache);
  }

  async rebuild(chunks: Array<{ id: string; path: string; content: string; mtime?: number }>, model: string): Promise<number> {
    this.cache = { version: 2, records: {} };
    await this.storage.save(this.cache);
    return this.indexChunks(chunks, model);
  }
}
