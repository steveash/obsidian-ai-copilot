import { Notice, Plugin, TFile } from "obsidian";
import { buildClient } from "./llm";
import { buildRefinementPlan, toMarkdownPlan } from "./planner";
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
        if (!file) return void new Notice("No active note selected.");
        const content = await this.app.vault.read(file);
        const related = await this.getRelevantNotes(file.basename, this.settings.chatMaxResults);
        const prompt = [
          `ACTIVE NOTE (${file.path}):`,
          content,
          "\nRELATED CONTEXT:",
          ...related.map((n) => `- ${n.path} (score ${n.score.toFixed(2)})\n${n.content.slice(0, 500)}`),
          "\nTask: summarize note, suggest improvements, and list TODOs."
        ].join("\n\n");

        const output = await buildClient(this.settings).chat(prompt, "You are an Obsidian assistant.");
        await this.writeAssistantOutput("Chat Output", output);
        new Notice("AI Copilot: chat output saved to AI Copilot/Chat Output.md");
      }
    });

    this.addCommand({
      id: "ai-copilot-chat-query",
      name: "AI Copilot: Chat using vault query",
      callback: async () => {
        const query = window.prompt("Ask a question about your notes:");
        if (!query?.trim()) return;
        const related = await this.getRelevantNotes(query, this.settings.chatMaxResults);
        const context = related
          .map((n) => `### ${n.path}\n${n.content.slice(0, 1200)}`)
          .join("\n\n");

        const prompt = `Question: ${query}\n\nUse these notes:\n\n${context}`;
        const output = await buildClient(this.settings).chat(prompt, "Answer using only note evidence.");
        await this.writeAssistantOutput("Chat Output", `## Query\n${query}\n\n## Response\n${output}`);
        new Notice("AI Copilot: query response saved.");
      }
    });

    this.addCommand({
      id: "ai-copilot-run-refinement-now",
      name: "AI Copilot: Run refinement now",
      callback: async () => void this.runRefinementPass()
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
    this.intervalId = window.setInterval(() => void this.runRefinementPass(), intervalMs);
    this.registerInterval(this.intervalId);
  }

  private async runRefinementPass() {
    const candidates = await this.getRecentNotes(this.settings.refinementLookbackDays);
    if (!candidates.length) return void new Notice("AI Copilot: no recent notes to refine.");

    const plan = buildRefinementPlan(candidates);
    const prompt = buildRefinementPrompt(candidates, {
      enableWebEnrichment: this.settings.enableWebEnrichment
    });
    const output = await buildClient(this.settings).chat(
      `${toMarkdownPlan(plan)}\n\n${prompt}`,
      "You refine markdown notes and preserve intent."
    );

    const todos = candidates.flatMap((n) => extractTodos(n.content));
    new Notice(`AI Copilot: scanned ${candidates.length} notes · TODOs ${todos.length}`);

    await this.writeAssistantOutput("Refinement Log", `${toMarkdownPlan(plan)}\n\n## LLM Output\n${output}`);
  }

  private async writeAssistantOutput(name: string, body: string) {
    const file = await this.ensurePluginFile(`${name}.md`, `# ${name}\n`);
    const stamp = `\n\n---\n${new Date().toISOString()}\n`;
    await this.app.vault.append(file, `${stamp}${body}\n`);
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

  private async getRecentNotes(lookbackDays: number) {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.stat.mtime >= cutoff);
    return Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f) })));
  }

  private async getRelevantNotes(query: string, maxResults: number) {
    const files = this.app.vault.getMarkdownFiles();
    const notes = await Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f) })));
    return rankNotesByQuery(notes, query, maxResults);
  }
}
