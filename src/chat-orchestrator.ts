import { Notice, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { buildClient, buildAgentClient } from "./llm";
import { AICopilotChatView, AI_COPILOT_VIEW, upsertChatOutput, type ChatMessage } from "./chat";
import type { AICopilotSettings } from "./settings";
import type { RetrievedNote } from "./semantic-retrieval";
import type { VaultAdapter } from "./vault-adapter";
import { runAgentLoop } from "./agent-loop";
import type { AgentToolContext } from "./agent-tools";

export class ChatOrchestrator {
  constructor(
    private readonly app: App,
    private readonly vault: VaultAdapter,
    private readonly getSettings: () => AICopilotSettings,
    private readonly getRelevantNotes: (query: string, maxResults: number) => Promise<RetrievedNote[]>,
    private readonly writeAssistantOutput: (name: string, body: string) => Promise<void>
  ) {}

  registerView(registerView: (type: string, cb: (leaf: WorkspaceLeaf) => AICopilotChatView) => void) {
    registerView(AI_COPILOT_VIEW, (leaf) => new AICopilotChatView(leaf));
  }

  private buildToolContext(settings: AICopilotSettings): AgentToolContext {
    return {
      vault: this.vault,
      searchNotes: (query, maxResults) => this.getRelevantNotes(query, maxResults),
      maxSearchResults: settings.chatMaxResults
    };
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
      view.setSubmitHandler(async (query: string): Promise<ChatMessage> => {
        const settings = this.getSettings();
        const agentClient = buildAgentClient(settings);

        if (agentClient) {
          const toolCtx = this.buildToolContext(settings);
          const result = await runAgentLoop(
            agentClient,
            query,
            toolCtx,
            settings,
            {
              onToolCall: (name) => view.showToolProgress(name),
              onText: () => view.clearToolProgress()
            }
          );

          await upsertChatOutput(
            this.vault,
            `## Query\n${query}\n\n## Response\n${result.text}`
          );

          return {
            role: "assistant",
            text: result.text,
            citations: result.citations
          };
        }

        // Fallback: non-agent providers (OpenAI, dry-run)
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
    const agentClient = buildAgentClient(settings);

    if (agentClient) {
      const toolCtx = this.buildToolContext(settings);
      const result = await runAgentLoop(agentClient, query, toolCtx, settings);
      await upsertChatOutput(
        this.vault,
        `## Query\n${query}\n\n## Response\n${result.text}`
      );
      new Notice("AI Copilot: query response saved.");
      return;
    }

    // Fallback: non-agent providers
    const related = await this.getRelevantNotes(query, settings.chatMaxResults);
    const context = related.map((n) => `### ${n.path}\n${n.content.slice(0, 1200)}`).join("\n\n");
    const prompt = `Question: ${query}\n\nUse these notes:\n\n${context}`;
    const output = await buildClient(settings).chat(prompt, "Answer using only note evidence.");
    await upsertChatOutput(this.vault, `## Query\n${query}\n\n## Response\n${output}`);
    new Notice("AI Copilot: query response saved.");
  }
}
