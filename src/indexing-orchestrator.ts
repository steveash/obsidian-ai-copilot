import { OpenAIEmbeddingProvider, BedrockEmbeddingProvider, FallbackHashEmbeddingProvider } from "./embedding-provider";
import { BackgroundIndexingQueue } from "./indexing-queue";
import { removeIndexedNote, syncIndexedNote } from "./indexing-sync";
import type { AICopilotSettings } from "./settings";
import { PersistentVectorIndex } from "./vector-index";
import { VaultVectorStorage } from "./vault-vector-storage";
import type { VaultAdapter, VaultEventRef } from "./vault-adapter";

export class IndexingOrchestrator {
  private vectorIndex: PersistentVectorIndex | null = null;
  readonly queue = new BackgroundIndexingQueue();

  constructor(private readonly vault: VaultAdapter, private readonly getSettings: () => AICopilotSettings) {}

  initializeVectorIndex() {
    const settings = this.getSettings();
    const provider = this.buildEmbeddingProvider(settings);
    this.vectorIndex = new PersistentVectorIndex(new VaultVectorStorage(this.vault), provider);
  }

  private buildEmbeddingProvider(settings: AICopilotSettings) {
    switch (settings.embeddingProvider) {
      case "openai":
        return new OpenAIEmbeddingProvider(settings);
      case "bedrock":
        return new BedrockEmbeddingProvider(settings);
      default:
        return new FallbackHashEmbeddingProvider();
    }
  }

  getVectorIndex(): PersistentVectorIndex {
    if (!this.vectorIndex) this.initializeVectorIndex();
    return this.vectorIndex!;
  }

  async getAllNotes(): Promise<Array<{ path: string; content: string; mtime: number }>> {
    const files = this.vault.listMarkdownFiles();
    return Promise.all(
      files.map(async (f) => ({ path: f.path, content: await this.vault.read(f.path), mtime: f.mtime }))
    );
  }

  async getRecentNotes(lookbackDays: number): Promise<Array<{ path: string; content: string }>> {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const files = this.vault.listMarkdownFiles().filter((f) => f.mtime >= cutoff);
    return Promise.all(files.map(async (f) => ({ path: f.path, content: await this.vault.read(f.path) })));
  }

  async rebuildPersistentIndex(): Promise<number> {
    const settings = this.getSettings();
    const idx = this.getVectorIndex();
    const notes = await this.getAllNotes();
    const model = this.activeEmbeddingModel(settings);
    const count = await idx.rebuild(
      notes.map((n) => ({
        id: `${n.path}#full`,
        path: n.path,
        content: `${n.path}\n${n.content}`,
        mtime: n.mtime
      })),
      model
    );
    await idx.setProvider(settings.embeddingProvider);
    return count;
  }

  /** Returns the active embedding model name based on provider selection. */
  private activeEmbeddingModel(settings: AICopilotSettings): string {
    return settings.embeddingProvider === "bedrock"
      ? settings.bedrockEmbeddingModel
      : settings.embeddingModel;
  }

  /** Check if the embedding provider has changed since last index build. */
  async needsProviderRebuild(): Promise<boolean> {
    const idx = this.getVectorIndex();
    const stored = await idx.getStoredProvider();
    return stored !== undefined && stored !== this.getSettings().embeddingProvider;
  }

  registerVaultSyncEvents(registerEvent: (evt: VaultEventRef) => void) {
    registerEvent(
      this.vault.on("modify", async (file) => {
        if (!file.path.endsWith(".md")) return;
        this.queue.enqueue(async () => {
          const content = await this.vault.read(file.path);
          const settings = this.getSettings();
          await syncIndexedNote(
            this.getVectorIndex(),
            { path: file.path, content, mtime: file.mtime },
            this.activeEmbeddingModel(settings),
            settings.retrievalChunkSize
          );
        });
      })
    );

    registerEvent(
      this.vault.on("delete", async (file) => {
        if (!file.path.endsWith(".md")) return;
        this.queue.enqueue(async () => {
          await removeIndexedNote(this.getVectorIndex(), file.path);
        });
      })
    );
  }
}
