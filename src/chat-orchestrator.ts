import { Notice, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { buildClient, buildAgentClient } from "./llm-adapter";
import { AICopilotChatView, AI_COPILOT_VIEW, upsertChatOutput, type ChatMessage } from "./chat";
import type { AICopilotSettings } from "./settings";
import type { RetrievedNote } from "./semantic-retrieval";
import type { VaultAdapter } from "./vault-adapter";
import { runAgentLoop } from "./agent-loop";
import type { AgentToolContext } from "./agent-tools";
import { ConversationManager, type Conversation, type ConversationMessage } from "./conversation-manager";

export class ChatOrchestrator {
  private conversationManager: ConversationManager;
  private activeConversation: Conversation | null = null;

  constructor(
    private readonly app: App,
    private readonly vault: VaultAdapter,
    private readonly getSettings: () => AICopilotSettings,
    private readonly getRelevantNotes: (query: string, maxResults: number) => Promise<RetrievedNote[]>,
    private readonly writeAssistantOutput: (name: string, body: string) => Promise<void>
  ) {
    this.conversationManager = new ConversationManager(vault);
  }

  /** Start a new conversation or resume an existing one by ID. */
  async startConversation(topic?: string, resumeId?: string): Promise<Conversation> {
    if (resumeId) {
      const existing = await this.conversationManager.get(resumeId);
      if (existing) {
        this.activeConversation = existing;
        return existing;
      }
    }
    const settings = this.getSettings();
    const model = `${settings.provider}/${settings.provider === "openai" ? settings.openaiModel : settings.provider === "anthropic" ? settings.anthropicModel : settings.bedrockModel}`;
    const conv = await this.conversationManager.create(
      topic ?? `Chat ${new Date().toISOString().slice(0, 16)}`,
      model
    );
    this.activeConversation = conv;
    return conv;
  }

  /** Get the active conversation, creating one if needed. */
  private async ensureConversation(): Promise<Conversation> {
    if (!this.activeConversation) {
      return this.startConversation();
    }
    return this.activeConversation;
  }

  /** Inject vault context as system messages into the conversation. */
  private async injectVaultContext(conv: Conversation, query: string): Promise<void> {
    const settings = this.getSettings();
    const related = await this.getRelevantNotes(query, settings.chatMaxResults);
    if (related.length === 0) return;

    const contextText = related
      .map((n) => `### ${n.path}\n${n.content.slice(0, 1200)}`)
      .join("\n\n");

    await this.conversationManager.addMessage(
      conv.meta.id,
      "system",
      `Relevant vault notes for context:\n\n${contextText}`
    );
  }

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
      // Start a fresh conversation for this chat panel session
      const conv = await this.startConversation();

      view.setSubmitHandler(async (query: string, abortSignal: AbortSignal): Promise<ChatMessage> => {
        const settings = this.getSettings();

        // Record user message
        await this.conversationManager.addMessage(conv.meta.id, "user", query);

        // Inject relevant vault context as system messages
        await this.injectVaultContext(conv, query);

        const agentClient = buildAgentClient(settings);

        if (agentClient) {
          const toolCtx = this.buildToolContext(settings);
          const messages = this.conversationManager.toAgentMessages(conv);
          const systemCtx = this.conversationManager.getSystemContext(conv);
          const systemPrompt = systemCtx.length > 0
            ? systemCtx.join("\n\n") + "\n\nAnswer using the vault notes above as context."
            : undefined;

          const result = await runAgentLoop(
            agentClient,
            query,
            toolCtx,
            settings,
            {
              onToolCall: (name) => view.showToolProgress(name),
              onText: () => view.clearToolProgress()
            },
            messages,
            systemPrompt,
            abortSignal
          );

          // Record assistant response
          await this.conversationManager.addMessage(conv.meta.id, "assistant", result.text);

          await upsertChatOutput(
            this.vault,
            `## Query\n${query}\n\n## Response\n${result.text}`
          );

          return {
            role: "assistant",
            text: result.text,
            citations: result.citations,
            usage: result.usage
          };
        }

        // Fallback: non-agent providers (OpenAI, dry-run)
        const contextMsgs = this.conversationManager.getContextWindow(conv);
        const historyPrompt = contextMsgs
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n\n");
        const output = await buildClient(settings).chat(historyPrompt, "Answer using only note evidence.");

        // Record assistant response
        await this.conversationManager.addMessage(conv.meta.id, "assistant", output);

        await upsertChatOutput(this.vault, `## Query\n${query}\n\n## Response\n${output}`);
        return {
          role: "assistant",
          text: output,
          citations: []
        };
      });
    }
  }

  /** Export the active conversation as a standalone markdown note. */
  async exportConversation(): Promise<string | null> {
    const conv = this.activeConversation;
    if (!conv || conv.messages.length === 0) return null;

    const lines: string[] = [];
    lines.push(`# ${conv.meta.topic}`);
    lines.push("");
    lines.push(`Model: ${conv.meta.model}  `);
    lines.push(`Exported: ${new Date().toISOString()}`);
    lines.push("");

    for (const msg of conv.messages) {
      if (msg.role === "system") continue;
      const label = msg.role === "user" ? "You" : "Assistant";
      const ts = new Date(msg.timestamp).toLocaleString();
      lines.push(`## ${label} (${ts})`);
      lines.push("");
      lines.push(msg.content);
      lines.push("");
    }

    const filename = `AI Copilot/Exports/${conv.meta.topic.replace(/[/\\:*?"<>|]/g, "-").slice(0, 80)}.md`;
    if (!this.vault.exists("AI Copilot/Exports")) {
      if (!this.vault.exists("AI Copilot")) {
        await this.vault.createFolder("AI Copilot");
      }
      await this.vault.createFolder("AI Copilot/Exports");
    }

    const content = lines.join("\n");
    if (this.vault.exists(filename)) {
      await this.vault.modify(filename, content);
    } else {
      await this.vault.create(filename, content);
    }

    return filename;
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
    const conv = await this.ensureConversation();

    // Record user message and inject context
    await this.conversationManager.addMessage(conv.meta.id, "user", query);
    await this.injectVaultContext(conv, query);

    const agentClient = buildAgentClient(settings);

    if (agentClient) {
      const toolCtx = this.buildToolContext(settings);
      const messages = this.conversationManager.toAgentMessages(conv);
      const systemCtx = this.conversationManager.getSystemContext(conv);
      const systemPrompt = systemCtx.length > 0
        ? systemCtx.join("\n\n") + "\n\nAnswer using the vault notes above as context."
        : undefined;

      const result = await runAgentLoop(agentClient, query, toolCtx, settings, undefined, messages, systemPrompt);

      await this.conversationManager.addMessage(conv.meta.id, "assistant", result.text);
      await upsertChatOutput(
        this.vault,
        `## Query\n${query}\n\n## Response\n${result.text}`
      );
      new Notice("AI Copilot: query response saved.");
      return;
    }

    // Fallback: non-agent providers
    const contextMsgs = this.conversationManager.getContextWindow(conv);
    const historyPrompt = contextMsgs
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");
    const output = await buildClient(settings).chat(historyPrompt, "Answer using only note evidence.");

    await this.conversationManager.addMessage(conv.meta.id, "assistant", output);
    await upsertChatOutput(this.vault, `## Query\n${query}\n\n## Response\n${output}`);
    new Notice("AI Copilot: query response saved.");
  }
}
