import { Notice, Plugin, TFile } from "obsidian";
import { rollbackPatchPlan } from "./patch-plan";
import { redactSensitive } from "./safety";
import { AICopilotSettingTab, DEFAULT_SETTINGS, type AICopilotSettings } from "./settings";
import { validateSettings } from "./config-validation";
import { RetrievalOrchestrator } from "./retrieval-orchestrator";
import { IndexingOrchestrator } from "./indexing-orchestrator";
import { ChatOrchestrator } from "./chat-orchestrator";
import { registerPluginCommands, runRefinementFlow } from "./command-registration";
import type { PatchTransaction } from "./patcher";

export default class AICopilotPlugin extends Plugin {
  settings: AICopilotSettings = DEFAULT_SETTINGS;
  private intervalId: number | null = null;
  private lastPatchTransactions: PatchTransaction[] = [];
  private lastPatchTargetPath: string | null = null;

  private indexing = new IndexingOrchestrator(this.app, () => this.settings);
  private retrieval = new RetrievalOrchestrator({
    getAllNotes: () => this.indexing.getAllNotes(),
    getVectorIndex: () => this.indexing.getVectorIndex(),
    getSettings: () => this.settings
  });
  private chat = new ChatOrchestrator(
    this.app,
    () => this.settings,
    (query, max) => this.retrieval.getRelevantNotes(query, max),
    (name, body) => this.writeAssistantOutput(name, body)
  );

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AICopilotSettingTab(this.app, this));
    if (this.settings.strictConfigValidation) {
      const issues = validateSettings(this.settings);
      if (issues.length) new Notice(`AI Copilot settings warnings: ${issues.join(" | ")}`);
    }

    this.indexing.initializeVectorIndex();
    this.chat.registerView((type, cb) => this.registerView(type, cb));

    registerPluginCommands(
      {
        addCommand: (cmd) => this.addCommand(cmd),
        app: this.app,
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
        writeAssistantOutput: (name, body) => this.writeAssistantOutput(name, body),
        runRefinementPass: () => this.runRefinementPass()
      },
      this.chat,
      this.indexing
    );

    this.startRefinementLoop();
    this.indexing.registerVaultSyncEvents((evt) => this.registerEvent(evt));

    new Notice("AI Copilot loaded.");
  }

  onunload() {
    if (this.intervalId) window.clearInterval(this.intervalId);
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
      this.app,
      (name, body) => this.writeAssistantOutput(name, body)
    );
  }

  async rollbackLastPatchFromCurrentContent(current: string): Promise<string> {
    return rollbackPatchPlan(current, this.lastPatchTransactions);
  }

  private async writeAssistantOutput(name: string, body: string) {
    const file = await this.ensurePluginFile(`${name}.md`, `# ${name}\n`);
    const stamp = `\n\n---\n${new Date().toISOString()}\n`;
    const out = this.settings.redactSensitiveLogs ? redactSensitive(body) : body;
    await this.app.vault.append(file, `${stamp}${out}\n`);
  }

  private async ensurePluginFile(name: string, initial: string): Promise<TFile> {
    const folderPath = "AI Copilot";
    const path = `${folderPath}/${name}`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }
    return this.app.vault.create(path, initial);
  }
}
