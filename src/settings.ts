import type { App } from "obsidian";
import { PluginSettingTab, Setting } from "obsidian";
import type AICopilotPlugin from "./main";

export interface AICopilotSettings {
  provider: "openai" | "none";
  openaiApiKey: string;
  openaiModel: string;
  chatMaxResults: number;
  refinementIntervalMinutes: number;
  refinementLookbackDays: number;
  refinementAutoApply: boolean;
  enableWebEnrichment: boolean;
}

export const DEFAULT_SETTINGS: AICopilotSettings = {
  provider: "none",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  chatMaxResults: 6,
  refinementIntervalMinutes: 120,
  refinementLookbackDays: 3,
  refinementAutoApply: false,
  enableWebEnrichment: false
};

export class AICopilotSettingTab extends PluginSettingTab {
  plugin: AICopilotPlugin;

  constructor(app: App, plugin: AICopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI Copilot Settings" });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("LLM provider used by chat + refinement")
      .addDropdown((d) =>
        d
          .addOption("none", "None (dry-run)")
          .addOption("openai", "OpenAI")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value: "openai" | "none") => {
            this.plugin.settings.provider = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Stored locally in Obsidian plugin data.")
      .addText((t) =>
        t
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAI model")
      .setDesc("Model used for note chat and refinement")
      .addText((t) =>
        t.setValue(this.plugin.settings.openaiModel).onChange(async (value) => {
          this.plugin.settings.openaiModel = value.trim() || "gpt-4o-mini";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Chat max note results")
      .setDesc("How many notes are included in chat context")
      .addSlider((s) =>
        s
          .setLimits(1, 20, 1)
          .setValue(this.plugin.settings.chatMaxResults)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.chatMaxResults = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Refinement interval (minutes)")
      .setDesc("Background pass cadence")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.refinementIntervalMinutes))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 15) {
              this.plugin.settings.refinementIntervalMinutes = Math.floor(n);
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Refinement lookback (days)")
      .setDesc("Only notes modified within this range are candidates")
      .addSlider((s) =>
        s
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.refinementLookbackDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.refinementLookbackDays = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto apply refinement")
      .setDesc("If disabled, plugin only logs/surfaces suggestions")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.refinementAutoApply).onChange(async (value) => {
          this.plugin.settings.refinementAutoApply = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Enable web enrichment")
      .setDesc("Allow refinement prompts to request internet context")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.enableWebEnrichment).onChange(async (value) => {
          this.plugin.settings.enableWebEnrichment = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
