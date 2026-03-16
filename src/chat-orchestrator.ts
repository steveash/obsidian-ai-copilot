import { Notice, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { buildClient } from "./llm";
import { AICopilotChatView, AI_COPILOT_VIEW, upsertChatOutput, type ChatMessage } from "./chat";
import type { AICopilotSettings } from "./settings";
import type { RetrievedNote } from "./semantic-retrieval";
import type { VaultAdapter } from "./vault-adapter";

export class ChatOrchestrator {
  constructor(
    private readonly app: App,
    private readonly vault: VaultAdapter,
    private readonly getSettings: () => AICopilotSettings,
    private readonly getRelevantNotes: (query: string, maxResults: number) => Promise<RetrievedNote[]>,
    private readonly writeAssistantOutput: (name: string, body: string) => Promise<void>
  ) {}

  registerView(registerView: (type: string, cb: (leaf: WorkspaceLeaf) => AICopilotChatView) => void) {
    registerView(AI_COPILOT_VIEW, (leaf) => {
      const view = new AICopilotChatView(leaf);
      view.setVaultAdapter(this.vault);
      return view;
    });
  }

  async activateChatView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(AI_COPILOT_VIEW);
    if (leaves.length) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: AI_COPILOT_VIEW, active: true });
    }

    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof AICopilotChatView) {
      view.setVaultAdapter(this.vault);
      view.setSubmitHandler(async (query: string): Promise<ChatMessage> => {
        const settings = this.getSettings();
        const related = await this.getRelevantNotes(query, settings.chatMaxResults);
        const context = related.map((n) => `### ${n.path}\n${n.content.slice(0, 1200)}`).join("\n\n");
        const prompt = `Question: ${query}\n\nUse these notes:\n\n${context}`;
        const output = await buildClient(settings).chat(prompt, "Answer using only note evidence.");
        await upsertChatOutput(this.vault, `## Query\n${query}\n\n## Response\n${output}`);
        return {
          role: "assistant",
          text: output,
          citations: related.map((n) => ({ path: n.path, score: n.score })).slice(0, 5)
        };
      });
    }
  }

  async chatActiveNote(file: TFile) {
    const content = await this.vault.read(file.path);
    const settings = this.getSettings();
    const related = await this.getRelevantNotes(file.basename, settings.chatMaxResults);
    const prompt = [
      `ACTIVE NOTE (${file.path}):`,
      content,
      "\nRELATED CONTEXT:",
      ...related.map((n) => `- ${n.path} (score ${n.score.toFixed(2)})\n${n.content.slice(0, 500)}`),
      "\nTask: summarize note, suggest improvements, and list TODOs."
    ].join("\n\n");

    const output = await buildClient(settings).chat(prompt, "You are an Obsidian assistant.");
    await this.writeAssistantOutput("Chat Output", output);
    new Notice("AI Copilot: chat output saved to AI Copilot/Chat Output.md");
  }

  async chatQuery(query: string) {
    const settings = this.getSettings();
    const related = await this.getRelevantNotes(query, settings.chatMaxResults);
    const context = related.map((n) => `### ${n.path}\n${n.content.slice(0, 1200)}`).join("\n\n");
    const prompt = `Question: ${query}\n\nUse these notes:\n\n${context}`;
    const output = await buildClient(settings).chat(prompt, "Answer using only note evidence.");
    await upsertChatOutput(this.vault, `## Query\n${query}\n\n## Response\n${output}`);
    new Notice("AI Copilot: query response saved.");
  }
}
