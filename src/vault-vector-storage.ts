import type { StoredVector, VectorIndexData, VectorStorage } from "./vector-index";
import type { VaultAdapter } from "./vault-adapter";

const INDEX_PATH = "AI Copilot/.index/vectors.json";

function getParsedRecords(value: unknown): Record<string, StoredVector> | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as { records?: unknown };
  if (!maybe.records || typeof maybe.records !== "object") return null;
  return maybe.records as Record<string, StoredVector>;
}

export class VaultVectorStorage implements VectorStorage {
  constructor(private readonly vault: VaultAdapter) {}

  async load(): Promise<VectorIndexData> {
    if (!this.vault.exists(INDEX_PATH)) return { version: 2, records: {} };
    const text = await this.vault.read(INDEX_PATH);
    try {
      const parsed: unknown = JSON.parse(text);
      const records = getParsedRecords(parsed);
      if (records) {
        return { version: 2, records };
      }
      return { version: 2, records: {} };
    } catch {
      return { version: 2, records: {} };
    }
  }

  async save(data: VectorIndexData): Promise<void> {
    if (!this.vault.exists("AI Copilot")) await this.vault.createFolder("AI Copilot");
    if (!this.vault.exists("AI Copilot/.index")) await this.vault.createFolder("AI Copilot/.index");

    const content = JSON.stringify(data);
    if (this.vault.exists(INDEX_PATH)) await this.vault.modify(INDEX_PATH, content);
    else await this.vault.create(INDEX_PATH, content);
  }
}
