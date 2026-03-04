import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { ItemView } from "obsidian";

export const AI_COPILOT_VIEW = "ai-copilot-chat-view";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export class AICopilotChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private onSubmit: ((query: string) => Promise<string>) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly appRef: App) {
    super(leaf);
    void appRef;
  }

  getViewType() {
    return AI_COPILOT_VIEW;
  }

  getDisplayText() {
    return "AI Copilot Chat";
  }

  setSubmitHandler(handler: (query: string) => Promise<string>) {
    this.onSubmit = handler;
  }

  async onOpen() {
    this.render();
  }

  private render() {
    const root = this.containerEl.children[1];
    root.empty();

    root.createEl("h3", { text: "AI Copilot Chat" });
    const list = root.createDiv({ cls: "ai-copilot-chat-list" });
    for (const msg of this.messages) {
      const item = list.createDiv({ cls: `ai-copilot-msg ai-copilot-${msg.role}` });
      item.createEl("strong", { text: `${msg.role}: ` });
      item.appendText(msg.text);
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
      this.messages.push({ role: "assistant", text: reply });
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
