import { TFile, type App } from "obsidian";
import type { VaultAdapter, VaultFile, VaultEventRef } from "./vault-adapter";

export class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  listMarkdownFiles(): VaultFile[] {
    return this.app.vault.getMarkdownFiles().map((f) => ({
      path: f.path,
      mtime: f.stat.mtime
    }));
  }

  async read(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    return this.app.vault.read(file);
  }

  exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  async create(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }

  async modify(path: string, content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    await this.app.vault.modify(file, content);
  }

  async append(path: string, content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    await this.app.vault.append(file, content);
  }

  async createFolder(path: string): Promise<void> {
    await this.app.vault.createFolder(path);
  }

  on(event: "modify" | "delete", callback: (file: VaultFile) => void): VaultEventRef {
    if (event === "modify") {
      return this.app.vault.on("modify", (f) => {
        if (f instanceof TFile) {
          callback({ path: f.path, mtime: f.stat.mtime });
        }
      });
    }
    return this.app.vault.on("delete", (f) => {
      if ("path" in f) {
        const mtime = f instanceof TFile ? f.stat.mtime : 0;
        callback({ path: f.path, mtime });
      }
    });
  }
}
