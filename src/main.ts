import { Notice, Plugin, TFile } from "obsidian";
import { buildClient } from "./llm";
import { buildRefinementPrompt, extractTodos } from "./refinement";
import { rankNotesByQuery } from "./search";
import { AICopilotSettingTab, DEFAULT_SETTINGS, type AICopilotSettings } from "./settings";

export default class AICopilotPlugin extends Plugin {
  settings: AICopilotSettings = DEFAULT_SETTINGS;
  private intervalId: number | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AICopilotSettingTab(this.app, this));

    this.addCommand({
      id: "ai-copilot-chat-active-note",
      name: "AI Copilot: Chat about active note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("No active note selected.");
          return;
        }

        const content = await this.app.vault.read(file);
        const query = `Summarize this note and suggest next actions: ${file.path}`;
        const related = await this.getRelevantNotes(query, this.settings.chatMaxResults);
        const prompt = [
          `ACTIVE NOTE (${file.path}):`,
          content,
          "\nRELATED CONTEXT:",
          ...related.map((n) => `- ${n.path} (score ${n.score.toFixed(2)})\n${n.content.slice(0, 500)}`),
          "\nTask: Answer user about this note, suggest improvements, and list TODOs."
        ].join("\n\n");

        const client = buildClient(this.settings);
        const output = await client.chat(prompt, "You are an Obsidian assistant.");
        new Notice(output.slice(0, 2000) || "No response.");
      }
    });

    this.addCommand({
      id: "ai-copilot-run-refinement-now",
      name: "AI Copilot: Run refinement now",
      callback: async () => {
        await this.runRefinementPass();
      }
    });

    this.startRefinementLoop();
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
  }

  private startRefinementLoop() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    const intervalMs = Math.max(15, this.settings.refinementIntervalMinutes) * 60_000;
    this.intervalId = window.setInterval(() => {
      void this.runRefinementPass();
    }, intervalMs);
    this.registerInterval(this.intervalId);
  }

  private async runRefinementPass() {
    const candidates = await this.getRecentNotes(this.settings.refinementLookbackDays);
    if (!candidates.length) {
      new Notice("AI Copilot: no recent notes to refine.");
      return;
    }

    const prompt = buildRefinementPrompt(candidates, {
      enableWebEnrichment: this.settings.enableWebEnrichment
    });
    const client = buildClient(this.settings);
    const output = await client.chat(prompt, "You refine markdown notes and preserve intent.");

    // Feature improvement: TODO digest generation.
    const todos = candidates.flatMap((n) => extractTodos(n.content));
    const summary = [
      `Refinement scanned ${candidates.length} notes`,
      todos.length ? `Found ${todos.length} TODO items` : "No TODO items found"
    ].join(" · ");

    new Notice(`AI Copilot: ${summary}`);

    if (this.settings.refinementAutoApply) {
      const stamp = `\n\n---\n_AI Copilot refinement run:_ ${new Date().toISOString()}\n`;
      const target = await this.ensureRefinementLog();
      await this.app.vault.append(target, `\n## Refinement Output\n\n${output}${stamp}`);
    }
  }

  private async ensureRefinementLog(): Promise<TFile> {
    const path = "AI Copilot/Refinement Log.md";
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    const folder = this.app.vault.getAbstractFileByPath("AI Copilot");
    if (!folder) await this.app.vault.createFolder("AI Copilot");
    return this.app.vault.create(path, "# AI Copilot Refinement Log\n");
  }

  private async getRecentNotes(lookbackDays: number) {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.stat.mtime >= cutoff);
    const contents = await Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f) })));
    return contents;
  }

  private async getRelevantNotes(query: string, maxResults: number) {
    const files = this.app.vault.getMarkdownFiles();
    const notes = await Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f) })));
    return rankNotesByQuery(notes, query, maxResults);
  }
}
