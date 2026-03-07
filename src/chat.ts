import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { ItemView, Notice } from "obsidian";

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
  private messages: ChatMessage[] = [];
  private onSubmit: ((query: string) => Promise<ChatMessage>) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly appRef: App) {
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
  }

  async onOpen() {
    this.render();
  }

  private async openCitation(path: string) {
    const file = this.appRef.vault.getAbstractFileByPath(path);
    if (file && "path" in file) {
      await this.appRef.workspace.getLeaf(true).openFile(file as TFile);
      return;
    }
    new Notice(`AI Copilot: source not found (${path})`);
  }

  private render() {
    const root = this.containerEl.children[1];
    root.empty();

    root.createEl("h3", { text: "AI Copilot Chat" });
    const list = root.createDiv({ cls: "ai-copilot-chat-list" });
    list.style.maxHeight = "65vh";
    list.style.overflowY = "auto";

    for (const msg of this.messages) {
      const item = list.createDiv({ cls: `ai-copilot-msg ai-copilot-${msg.role}` });
      item.createEl("strong", { text: `${msg.role}: ` });
      item.appendText(msg.text);

      if (msg.role === "assistant" && msg.citations?.length) {
        const sourceBox = item.createDiv({ cls: "ai-copilot-citations" });
        sourceBox.createEl("div", { text: "Sources:", cls: "ai-copilot-citation-title" });
        const ul = sourceBox.createEl("ul");
        for (const citation of msg.citations) {
          const li = ul.createEl("li");
          const scoreText = typeof citation.score === "number" ? ` (${citation.score.toFixed(2)})` : "";
          const link = li.createEl("a", { text: `${citation.path}${scoreText}`, href: "#" });
          link.onclick = (e) => {
            e.preventDefault();
            void this.openCitation(citation.path);
          };
        }
      }
    }

    const form = root.createEl("form");
    const input = form.createEl("input", { type: "text", placeholder: "Ask about your notes..." });
    input.style.width = "80%";
    const btn = form.createEl("button", { text: "Send" });
    btn.type = "submit";

    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q || !this.onSubmit) return;
      this.messages.push({ role: "user", text: q });
      input.value = "";
      this.render();
      const reply = await this.onSubmit(q);
      this.messages.push(reply);
      this.render();
    };
  }
}

export async function upsertChatOutput(app: App, text: string): Promise<TFile> {
  const path = "AI Copilot/Chat Output.md";
  const existing = app.vault.getAbstractFileByPath(path);
  let file: TFile;
  if (existing && "path" in existing) {
    file = existing as TFile;
  } else {
    if (!app.vault.getAbstractFileByPath("AI Copilot")) {
      await app.vault.createFolder("AI Copilot");
    }
    file = await app.vault.create(path, "# Chat Output\n");
  }

  await app.vault.append(file, `\n\n---\n${new Date().toISOString()}\n${text}\n`);
  return file;
}
