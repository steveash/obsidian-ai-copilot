import type { WorkspaceLeaf } from "obsidian";
import { ItemView, Notice, TFile } from "obsidian";
import type { VaultAdapter } from "./vault-adapter";
import type { DeepChat } from "deep-chat";
import { escapeHtml, formatCitationHtml, formatToolProgressText } from "./chat-format";

export { escapeHtml, formatCitationHtml, formatToolProgressText };

export const AI_COPILOT_VIEW = "ai-copilot-chat-view";

export interface ChatCitation {
  path: string;
  score?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: ChatCitation[];
}

export class AICopilotChatView extends ItemView {
  private deepChatEl: DeepChat | null = null;
  private onSubmit: ((query: string) => Promise<ChatMessage>) | null = null;
  private toolProgressEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return AI_COPILOT_VIEW;
  }

  getDisplayText() {
    return "AI Copilot Chat";
  }

  setSubmitHandler(handler: (query: string) => Promise<ChatMessage>) {
    this.onSubmit = handler;
    this.applyHandler();
  }

  showToolProgress(toolName: string) {
    if (!this.toolProgressEl) return;
    const label = formatToolProgressText(toolName);
    this.toolProgressEl.setText(label);
    this.toolProgressEl.style.display = "block";
  }

  clearToolProgress() {
    if (!this.toolProgressEl) return;
    this.toolProgressEl.style.display = "none";
    this.toolProgressEl.setText("");
  }

  async onOpen() {
    // Side-effect import: registers <deep-chat> custom element in the browser
    await import("deep-chat");

    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("ai-copilot-chat-root");

    root.createEl("h3", { text: "AI Copilot Chat" });

    this.toolProgressEl = root.createDiv({ cls: "ai-copilot-tool-progress" });
    this.toolProgressEl.style.display = "none";

    const container = root.createDiv({ cls: "ai-copilot-deep-chat-container" });
    const el = document.createElement("deep-chat") as DeepChat;
    container.appendChild(el);
    this.deepChatEl = el;

    this.configureDeepChat();
    this.applyHandler();
  }

  private configureDeepChat() {
    const el = this.deepChatEl;
    if (!el) return;

    // Sizing
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.border = "none";
    el.style.borderRadius = "0";

    // Chat container style (background matches Obsidian theme via CSS vars)
    el.chatStyle = {
      backgroundColor: "var(--background-primary)"
    };

    // Input area
    el.inputAreaStyle = {
      backgroundColor: "var(--background-primary)",
      borderTop: "1px solid var(--background-modifier-border)"
    };

    el.textInput = {
      placeholder: { text: "Ask about your notes..." },
      styles: {
        container: {
          backgroundColor: "var(--background-primary-alt)",
          border: "1px solid var(--background-modifier-border)",
          borderRadius: "8px",
          color: "var(--text-normal)"
        },
        focus: {
          border: "1px solid var(--interactive-accent)"
        }
      }
    };

    // Submit button
    el.submitButtonStyles = {
      submit: {
        container: {
          default: {
            backgroundColor: "var(--interactive-accent)",
            borderRadius: "6px"
          },
          hover: {
            backgroundColor: "var(--interactive-accent-hover)"
          }
        }
      },
      loading: {
        container: {
          default: {
            backgroundColor: "var(--background-modifier-border)",
            borderRadius: "6px"
          }
        }
      }
    };

    // Message bubble styles
    el.messageStyles = {
      default: {
        shared: {
          bubble: {
            maxWidth: "100%",
            fontSize: "var(--font-text-size)",
            fontFamily: "var(--font-text)",
            lineHeight: "var(--line-height-normal)"
          }
        },
        user: {
          bubble: {
            backgroundColor: "var(--background-primary-alt)",
            color: "var(--text-normal)",
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "8px"
          }
        },
        ai: {
          bubble: {
            backgroundColor: "var(--background-secondary)",
            color: "var(--text-normal)",
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "8px"
          }
        }
      },
      loading: {
        message: {
          styles: {
            bubble: {
              backgroundColor: "var(--background-secondary)",
              color: "var(--text-muted)",
              border: "1px solid var(--background-modifier-border)",
              borderRadius: "8px"
            }
          }
        }
      },
      html: {
        ai: {
          bubble: {
            backgroundColor: "var(--background-secondary)",
            color: "var(--text-normal)",
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "8px"
          }
        }
      }
    };

    // Loading indicator
    el.displayLoadingBubble = true;

    // Error display
    el.errorMessages = {
      displayServiceErrorMessages: true
    };

    // Markdown rendering via Remarkable
    el.remarkable = { typographer: true };

    // Citation click handling via htmlClassUtilities
    el.htmlClassUtilities = {
      "deep-chat-citations": {
        styles: {
          default: {
            marginTop: "8px",
            paddingTop: "6px",
            borderTop: "1px dashed var(--background-modifier-border)",
            fontSize: "12px"
          }
        }
      },
      "deep-chat-citation-title": {
        styles: {
          default: {
            opacity: "0.75",
            marginBottom: "2px",
            fontWeight: "600"
          }
        }
      },
      "deep-chat-citation-link": {
        styles: {
          default: {
            color: "var(--text-accent)",
            cursor: "pointer",
            textDecoration: "none"
          },
          hover: {
            textDecoration: "underline"
          }
        },
        events: {
          click: (event: Partial<MouseEvent>) => {
            const target = event.target as HTMLElement | undefined;
            const path = target?.dataset?.path;
            if (path) {
              void this.openCitation(path);
            }
          }
        }
      }
    };

    // Intro message
    el.introMessage = {
      text: "Ask me anything about your vault notes."
    };
  }

  /**
   * Wire the connect handler to the orchestrator's submit callback.
   * Called whenever setSubmitHandler is invoked or the element is ready.
   */
  private applyHandler() {
    const el = this.deepChatEl;
    if (!el || !this.onSubmit) return;
    const handler = this.onSubmit;

    el.connect = {
      handler: async (
        body: { messages: Array<{ role: string; text?: string }> },
        signals
      ) => {
        const lastMsg = body.messages[body.messages.length - 1];
        const query = lastMsg?.text?.trim() ?? "";
        if (!query) {
          await signals.onResponse({ text: "Please enter a message." });
          return;
        }

        try {
          const reply = await handler(query);

          if (reply.citations?.length) {
            // Return text response, then add citation HTML as a follow-up
            await signals.onResponse({ text: reply.text });
            el.addMessage({ html: formatCitationHtml(reply.citations), role: "ai" });
          } else {
            await signals.onResponse({ text: reply.text });
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "An error occurred";
          await signals.onResponse({ error: message });
        }
      }
    };
  }

  private async openCitation(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && "path" in file) {
      await this.app.workspace.getLeaf(true).openFile(file as TFile);
      return;
    }
    new Notice(`AI Copilot: source not found (${path})`);
  }
}

export async function upsertChatOutput(
  vault: VaultAdapter,
  text: string
): Promise<void> {
  const path = "AI Copilot/Chat Output.md";
  if (!vault.exists(path)) {
    if (!vault.exists("AI Copilot")) {
      await vault.createFolder("AI Copilot");
    }
    await vault.create(path, "# Chat Output\n");
  }

  await vault.append(
    path,
    `\n\n---\n${new Date().toISOString()}\n${text}\n`
  );
}
