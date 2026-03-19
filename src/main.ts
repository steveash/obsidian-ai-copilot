import { Notice, Plugin } from "obsidian";
import { rollbackPatchPlan } from "./patch-plan";
import { redactSensitive } from "./safety";
import { AICopilotSettingTab, DEFAULT_SETTINGS, type AICopilotSettings } from "./settings";
import { validateSettings } from "./config-validation";
import { RetrievalOrchestrator } from "./retrieval-orchestrator";
import { IndexingOrchestrator } from "./indexing-orchestrator";
import { ChatOrchestrator } from "./chat-orchestrator";
import { registerPluginCommands, runRefinementFlow } from "./command-registration";
import { ObsidianVaultAdapter } from "./obsidian-vault-adapter";
import type { VaultAdapter } from "./vault-adapter";
import type { PatchTransaction } from "./patcher";
import type { SmartRefinementSnapshot } from "./smart-refinement";
import { EnrichmentOrchestrator } from "./enrichment-orchestrator";
import { EnrichmentQueueView, ENRICHMENT_QUEUE_VIEW } from "./enrichment-queue-view";

export default class AICopilotPlugin extends Plugin {
  settings: AICopilotSettings = DEFAULT_SETTINGS;
  private intervalId: number | null = null;
  private lastPatchTransactions: PatchTransaction[] = [];
  private lastPatchTargetPath: string | null = null;
  private lastRefinementSnapshot: SmartRefinementSnapshot | null = null;

  private vault_: VaultAdapter = new ObsidianVaultAdapter(this.app);
  private indexing = new IndexingOrchestrator(this.vault_, () => this.settings);
  private retrieval = new RetrievalOrchestrator({
    getAllNotes: () => this.indexing.getAllNotes(),
    getVectorIndex: () => this.indexing.getVectorIndex(),
    getSettings: () => this.settings
  });
  private chat = new ChatOrchestrator(
    this.app,
    this.vault_,
    () => this.settings,
    (query, max) => this.retrieval.getRelevantNotes(query, max),
    (name, body) => this.writeAssistantOutput(name, body)
  );
  private enrichment = new EnrichmentOrchestrator({
    vault: this.vault_,
    getSettings: () => this.settings,
    indexing: this.indexing,
    writeAssistantOutput: (name, body) => this.writeAssistantOutput(name, body),
  });

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AICopilotSettingTab(this.app, this));
    if (this.settings.strictConfigValidation) {
      const issues = validateSettings(this.settings);
      if (issues.length) new Notice(`AI Copilot settings warnings: ${issues.join(" | ")}`);
    }

    this.indexing.initializeVectorIndex();
    this.chat.registerView((type, cb) => this.registerView(type, cb));
    this.registerView(ENRICHMENT_QUEUE_VIEW, (leaf) => {
      const view = new EnrichmentQueueView(leaf);
      view.setDeps(this.vault_);
      return view;
    });

    registerPluginCommands(
      {
        addCommand: (cmd) => this.addCommand(cmd),
        app: this.app,
        vault: this.vault_,
        getSettings: () => this.settings,
        setLastPatchState: (transactions, path) => {
          this.lastPatchTransactions = transactions;
          this.lastPatchTargetPath = path;
        },
        clearLastPatchState: () => {
          this.lastPatchTransactions = [];
          this.lastPatchTargetPath = null;
        },
        getLastPatchState: () => ({ transactions: this.lastPatchTransactions, path: this.lastPatchTargetPath }),
        setLastRefinementSnapshot: (snapshot) => { this.lastRefinementSnapshot = snapshot; },
        clearLastRefinementSnapshot: () => { this.lastRefinementSnapshot = null; },
        getLastRefinementSnapshot: () => this.lastRefinementSnapshot,
        writeAssistantOutput: (name, body) => this.writeAssistantOutput(name, body),
        runRefinementPass: () => this.runRefinementPass()
      },
      this.chat,
      this.indexing
    );

    this.startRefinementLoop();
    this.indexing.registerVaultSyncEvents((evt) => this.registerEvent(evt as any));
    this.enrichment.registerVaultEvents((evt) => this.registerEvent(evt as any));

    new Notice("AI Copilot loaded.");
  }

  onunload() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    this.enrichment.dispose();
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.startRefinementLoop();
    this.indexing.initializeVectorIndex();
  }

  private startRefinementLoop() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    const intervalMs = Math.max(15, this.settings.refinementIntervalMinutes) * 60_000;
    this.intervalId = window.setInterval(() => {
      this.runRefinementPass().catch((err) => {
        console.error("AI Copilot refinement pass failed:", err);
      });
    }, intervalMs);
    this.registerInterval(this.intervalId);
  }

  private async runRefinementPass() {
    const candidates = await this.indexing.getRecentNotes(this.settings.refinementLookbackDays);
    await runRefinementFlow(
      candidates,
      this.settings,
      (transactions, path) => {
        this.lastPatchTransactions = transactions;
        this.lastPatchTargetPath = path;
      },
      this.vault_,
      (name, body) => this.writeAssistantOutput(name, body),
      (snapshot) => { this.lastRefinementSnapshot = snapshot; }
    );
  }

  async rollbackLastPatchFromCurrentContent(current: string): Promise<string> {
    return rollbackPatchPlan(current, this.lastPatchTransactions);
  }

  private async writeAssistantOutput(name: string, body: string) {
    await this.ensurePluginFile(`${name}.md`, `# ${name}\n`);
    const path = `AI Copilot/${name}.md`;
    const stamp = `\n\n---\n${new Date().toISOString()}\n`;
    const out = this.settings.redactSensitiveLogs ? redactSensitive(body) : body;
    await this.vault_.append(path, `${stamp}${out}\n`);
  }

  private async ensurePluginFile(name: string, initial: string): Promise<void> {
    const folderPath = "AI Copilot";
    const path = `${folderPath}/${name}`;
    if (this.vault_.exists(path)) return;
    if (!this.vault_.exists(folderPath)) {
      await this.vault_.createFolder(folderPath);
    }
    await this.vault_.create(path, initial);
  }
}
