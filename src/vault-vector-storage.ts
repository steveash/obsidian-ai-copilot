import type { App, TFile } from "obsidian";
import type { VectorIndexData, VectorStorage } from "./vector-index";

const INDEX_PATH = "AI Copilot/.index/vectors.json";

export class VaultVectorStorage implements VectorStorage {
  constructor(private readonly app: App) {}

  async load(): Promise<VectorIndexData> {
    const f = this.app.vault.getAbstractFileByPath(INDEX_PATH);
    if (!f) return { version: 1, records: {} };
    const text = await this.app.vault.read(f as TFile);
    try {
      const parsed = JSON.parse(text) as VectorIndexData;
      if (parsed?.version === 1 && parsed.records) return parsed;
      return { version: 1, records: {} };
    } catch {
      return { version: 1, records: {} };
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
