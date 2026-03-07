import type { App, TFile } from "obsidian";
import type { StoredVector, VectorIndexData, VectorStorage } from "./vector-index";

const INDEX_PATH = "AI Copilot/.index/vectors.json";

function getParsedRecords(value: unknown): Record<string, StoredVector> | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as { records?: unknown };
  if (!maybe.records || typeof maybe.records !== "object") return null;
  return maybe.records as Record<string, StoredVector>;
}

export class VaultVectorStorage implements VectorStorage {
  constructor(private readonly app: App) {}

  async load(): Promise<VectorIndexData> {
    const f = this.app.vault.getAbstractFileByPath(INDEX_PATH);
    if (!f) return { version: 2, records: {} };
    const text = await this.app.vault.read(f as TFile);
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
    const folder = this.app.vault.getAbstractFileByPath("AI Copilot");
    if (!folder) await this.app.vault.createFolder("AI Copilot");
    const idxFolder = this.app.vault.getAbstractFileByPath("AI Copilot/.index");
    if (!idxFolder) await this.app.vault.createFolder("AI Copilot/.index");

    const existing = this.app.vault.getAbstractFileByPath(INDEX_PATH);
    const content = JSON.stringify(data);
    if (existing) await this.app.vault.modify(existing as TFile, content);
    else await this.app.vault.create(INDEX_PATH, content);
  }
}
