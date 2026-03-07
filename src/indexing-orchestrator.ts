import { TFile, type App } from "obsidian";
import { OpenAIEmbeddingProvider, FallbackHashEmbeddingProvider } from "./embedding-provider";
import { BackgroundIndexingQueue } from "./indexing-queue";
import { removeIndexedNote, syncIndexedNote } from "./indexing-sync";
import type { AICopilotSettings } from "./settings";
import { PersistentVectorIndex } from "./vector-index";
import { VaultVectorStorage } from "./vault-vector-storage";

export class IndexingOrchestrator {
  private vectorIndex: PersistentVectorIndex | null = null;
  readonly queue = new BackgroundIndexingQueue();

  constructor(private readonly app: App, private readonly getSettings: () => AICopilotSettings) {}

  initializeVectorIndex() {
    const settings = this.getSettings();
    const provider = settings.provider === "openai"
      ? new OpenAIEmbeddingProvider(settings)
      : new FallbackHashEmbeddingProvider();
    this.vectorIndex = new PersistentVectorIndex(new VaultVectorStorage(this.app), provider);
  }

  getVectorIndex(): PersistentVectorIndex {
    if (!this.vectorIndex) this.initializeVectorIndex();
    return this.vectorIndex!;
  }

  async getAllNotes(): Promise<Array<{ path: string; content: string; mtime: number }>> {
    const files = this.app.vault.getMarkdownFiles();
    return Promise.all(
      files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f), mtime: f.stat.mtime }))
    );
  }

  async getRecentNotes(lookbackDays: number): Promise<Array<{ path: string; content: string }>> {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.stat.mtime >= cutoff);
    return Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f) })));
  }

  async rebuildPersistentIndex(): Promise<number> {
    const notes = await this.getAllNotes();
    return this.getVectorIndex().rebuild(
      notes.map((n) => ({
        id: `${n.path}#full`,
        path: n.path,
        content: `${n.path}\n${n.content}`,
        mtime: n.mtime
      })),
      this.getSettings().embeddingModel
    );
  }

  registerVaultSyncEvents(registerEvent: (evt: any) => void) {
    registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (!(file instanceof TFile) || !file.path.endsWith(".md")) return;
        this.queue.enqueue(async () => {
          const content = await this.app.vault.read(file);
          const settings = this.getSettings();
          await syncIndexedNote(
            this.getVectorIndex(),
            { path: file.path, content, mtime: file.stat.mtime },
            settings.embeddingModel,
            settings.retrievalChunkSize
          );
        });
      })
    );

    registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (!("path" in file) || !file.path.endsWith(".md")) return;
        this.queue.enqueue(async () => {
          await removeIndexedNote(this.getVectorIndex(), file.path);
        });
      })
    );
  }
}
