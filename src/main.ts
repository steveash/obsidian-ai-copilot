import { Plugin, Notice } from "obsidian";

export default class AICopilotPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "ai-copilot-open-chat",
      name: "AI Copilot: Open chat (placeholder)",
      callback: () => {
        new Notice("AI Copilot chat UI coming soon.");
      }
    });

    this.registerInterval(window.setInterval(() => {
      // Placeholder for scheduled refinement job.
      // Future: collect recent notes, run LLM, write suggestions.
    }, 1000 * 60 * 60));
  }
}
