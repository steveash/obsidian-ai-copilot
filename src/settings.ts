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
  retrievalLexicalWeight: number;
  retrievalSemanticWeight: number;
  retrievalFreshnessWeight: number;
  retrievalGraphExpandHops: number;
  embeddingModel: string;
  preselectCandidateCount: number;
  retrievalChunkSize: number;
  rerankerEnabled: boolean;
  rerankerTopK: number;
  rerankerType: "openai" | "heuristic";
  rerankerModel: string;
}

export const DEFAULT_SETTINGS: AICopilotSettings = {
  provider: "none",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  chatMaxResults: 6,
  refinementIntervalMinutes: 120,
  refinementLookbackDays: 3,
  refinementAutoApply: false,
  enableWebEnrichment: false,
  retrievalLexicalWeight: 0.45,
  retrievalSemanticWeight: 0.45,
  retrievalFreshnessWeight: 0.1,
  retrievalGraphExpandHops: 1,
  embeddingModel: "text-embedding-3-large",
  preselectCandidateCount: 40,
  retrievalChunkSize: 1200,
  rerankerEnabled: true,
  rerankerTopK: 8,
  rerankerType: "openai",
  rerankerModel: "gpt-4.1-mini"
};

function parseProvider(value: string): AICopilotSettings["provider"] {
  return value === "openai" ? "openai" : "none";
}

function parseRerankerType(value: string): AICopilotSettings["rerankerType"] {
  return value === "openai" ? "openai" : "heuristic";
}

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
          .onChange(async (value: string) => {
            this.plugin.settings.provider = parseProvider(value);
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

    new Setting(containerEl)
      .setName("Retrieval lexical weight")
      .setDesc("Weight for BM25-style keyword overlap")
      .addSlider((s) =>
        s
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.retrievalLexicalWeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.retrievalLexicalWeight = Number(value.toFixed(2));
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Retrieval semantic weight")
      .setDesc("Weight for local embedding cosine similarity")
      .addSlider((s) =>
        s
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.retrievalSemanticWeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.retrievalSemanticWeight = Number(value.toFixed(2));
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Retrieval freshness weight")
      .setDesc("Bias toward recently edited notes")
      .addSlider((s) =>
        s
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.retrievalFreshnessWeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.retrievalFreshnessWeight = Number(value.toFixed(2));
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Graph expansion hops")
      .setDesc("Boost notes connected by [[wikilinks]] from top results")
      .addSlider((s) =>
        s
          .setLimits(0, 2, 1)
          .setValue(this.plugin.settings.retrievalGraphExpandHops)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.retrievalGraphExpandHops = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc("Remote embedding model for persistent vector index")
      .addText((t) =>
        t.setValue(this.plugin.settings.embeddingModel).onChange(async (value) => {
          this.plugin.settings.embeddingModel = value.trim() || "text-embedding-3-large";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Preselect candidates")
      .setDesc("Lexical top-N candidates before vector reranking")
      .addSlider((s) =>
        s
          .setLimits(10, 200, 5)
          .setValue(this.plugin.settings.preselectCandidateCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.preselectCandidateCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Chunk size (chars)")
      .setDesc("Approximate section chunk size for vector indexing")
      .addSlider((s) =>
        s
          .setLimits(400, 3000, 100)
          .setValue(this.plugin.settings.retrievalChunkSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.retrievalChunkSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable reranker")
      .setDesc("Second-pass rerank on top retrieved chunks")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.rerankerEnabled).onChange(async (value) => {
          this.plugin.settings.rerankerEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Reranker top-k")
      .setDesc("How many results get reranker pass")
      .addSlider((s) =>
        s
          .setLimits(3, 20, 1)
          .setValue(this.plugin.settings.rerankerTopK)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.rerankerTopK = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reranker engine")
      .setDesc("Best quality: OpenAI LLM reranker")
      .addDropdown((d) =>
        d
          .addOption("openai", "OpenAI (best quality)")
          .addOption("heuristic", "Heuristic (local fallback)")
          .setValue(this.plugin.settings.rerankerType)
          .onChange(async (value: string) => {
            this.plugin.settings.rerankerType = parseRerankerType(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reranker model")
      .setDesc("OpenAI model used for reranking")
      .addText((t) =>
        t.setValue(this.plugin.settings.rerankerModel).onChange(async (value) => {
          this.plugin.settings.rerankerModel = value.trim() || "gpt-4.1-mini";
          await this.plugin.saveSettings();
        })
      );
  }
}
