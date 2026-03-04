"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AICopilotPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/llm.ts
var DryRunClient = class {
  async chat(prompt) {
    return `DRY_RUN_RESPONSE

${prompt.slice(0, 1200)}`;
  }
};
var OpenAIClient = class {
  constructor(settings) {
    this.settings = settings;
  }
  async chat(prompt, system = "You are a helpful note assistant.") {
    if (!this.settings.openaiApiKey) {
      throw new Error("OpenAI API key missing in plugin settings");
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.openaiApiKey}`
      },
      body: JSON.stringify({
        model: this.settings.openaiModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
    }
    const json = await response.json();
    return json.choices?.[0]?.message?.content?.trim() || "";
  }
};
function buildClient(settings) {
  if (settings.provider === "openai") return new OpenAIClient(settings);
  return new DryRunClient();
}

// src/refinement.ts
function extractTodos(markdown) {
  const lines = markdown.split(/\r?\n/);
  return lines.filter((l) => /^\s*[-*]\s+\[\s\]\s+/i.test(l) || /^\s*TODO[:\s]/i.test(l)).map((l) => l.trim());
}
function detectDuplicateTitleClusters(notes) {
  const groups = /* @__PURE__ */ new Map();
  for (const n of notes) {
    const base = n.path.split("/").at(-1)?.replace(/\.md$/i, "").toLowerCase() ?? n.path;
    const arr = groups.get(base) ?? [];
    arr.push(n.path);
    groups.set(base, arr);
  }
  return [...groups.values()].filter((arr) => arr.length > 1).map((arr) => ({ anchor: arr[0], duplicates: arr.slice(1) }));
}
function buildRefinementPrompt(notes, options) {
  const header = [
    "You are an Obsidian note refinement assistant.",
    "Improve clarity, merge duplicates, surface TODOs, and suggest missing context.",
    "For each note, provide:",
    "1) Issues found",
    "2) Concrete edits (markdown snippets)",
    "3) Optional research followups",
    options?.enableWebEnrichment ? "You MAY suggest web queries when context gaps are obvious." : "Do NOT require internet lookups; work only with provided content.",
    "Keep suggestions concise and practical."
  ].join("\n");
  const body = notes.map((n, i) => `## Note ${i + 1}: ${n.path}
${n.content}`).join("\n\n");
  return `${header}

${body}`;
}

// src/planner.ts
function buildRefinementPlan(notes) {
  const todos = notes.flatMap((n) => extractTodos(n.content));
  const duplicateClusters = detectDuplicateTitleClusters(notes);
  const suggestions = [];
  if (duplicateClusters.length) {
    suggestions.push(`Merge or cross-link ${duplicateClusters.length} duplicate title cluster(s).`);
  }
  if (todos.length > 0) {
    suggestions.push(`Create a consolidated task dashboard for ${todos.length} TODO item(s).`);
  }
  const sparseNotes = notes.filter((n) => n.content.trim().split(/\s+/).length < 40);
  if (sparseNotes.length) {
    suggestions.push(`Expand ${sparseNotes.length} short note(s) with context/examples.`);
  }
  if (!suggestions.length) {
    suggestions.push("No obvious structural issues found; focus on style and clarity improvements.");
  }
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    noteCount: notes.length,
    todoCount: todos.length,
    duplicateClusters,
    suggestions
  };
}
function toMarkdownPlan(plan) {
  const dupes = plan.duplicateClusters.length ? plan.duplicateClusters.map((d) => `- Anchor: ${d.anchor} | Duplicates: ${d.duplicates.join(", ")}`).join("\n") : "- None";
  return [
    "## Refinement Plan",
    `- Generated: ${plan.generatedAt}`,
    `- Notes scanned: ${plan.noteCount}`,
    `- TODOs found: ${plan.todoCount}`,
    "",
    "### Duplicate clusters",
    dupes,
    "",
    "### Suggestions",
    ...plan.suggestions.map((s) => `- ${s}`)
  ].join("\n");
}

// src/search.ts
function tokenize(input) {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((x) => x.length > 1);
}
function rankNotesByQuery(notes, query, maxResults = 5) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  return notes.map((note) => {
    const hay = `${note.path}
${note.content}`.toLowerCase();
    const matchedTerms = terms.filter((term) => hay.includes(term));
    const exactPhraseBonus = hay.includes(query.toLowerCase()) ? 1.5 : 0;
    const coverage = matchedTerms.length / terms.length;
    const density = matchedTerms.length / Math.max(1, tokenize(note.content).length);
    const score = coverage * 3 + density + exactPhraseBonus;
    return { ...note, score, matchedTerms };
  }).filter((n) => n.score > 0).sort((a, b) => b.score - a.score).slice(0, maxResults);
}

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  provider: "none",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  chatMaxResults: 6,
  refinementIntervalMinutes: 120,
  refinementLookbackDays: 3,
  refinementAutoApply: false,
  enableWebEnrichment: false
};
var AICopilotSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI Copilot Settings" });
    new import_obsidian.Setting(containerEl).setName("Provider").setDesc("LLM provider used by chat + refinement").addDropdown(
      (d) => d.addOption("none", "None (dry-run)").addOption("openai", "OpenAI").setValue(this.plugin.settings.provider).onChange(async (value) => {
        this.plugin.settings.provider = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("OpenAI API key").setDesc("Stored locally in Obsidian plugin data.").addText(
      (t) => t.setPlaceholder("sk-...").setValue(this.plugin.settings.openaiApiKey).onChange(async (value) => {
        this.plugin.settings.openaiApiKey = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("OpenAI model").setDesc("Model used for note chat and refinement").addText(
      (t) => t.setValue(this.plugin.settings.openaiModel).onChange(async (value) => {
        this.plugin.settings.openaiModel = value.trim() || "gpt-4o-mini";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Chat max note results").setDesc("How many notes are included in chat context").addSlider(
      (s) => s.setLimits(1, 20, 1).setValue(this.plugin.settings.chatMaxResults).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.chatMaxResults = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Refinement interval (minutes)").setDesc("Background pass cadence").addText(
      (t) => t.setValue(String(this.plugin.settings.refinementIntervalMinutes)).onChange(async (value) => {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 15) {
          this.plugin.settings.refinementIntervalMinutes = Math.floor(n);
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Refinement lookback (days)").setDesc("Only notes modified within this range are candidates").addSlider(
      (s) => s.setLimits(1, 30, 1).setValue(this.plugin.settings.refinementLookbackDays).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.refinementLookbackDays = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto apply refinement").setDesc("If disabled, plugin only logs/surfaces suggestions").addToggle(
      (tg) => tg.setValue(this.plugin.settings.refinementAutoApply).onChange(async (value) => {
        this.plugin.settings.refinementAutoApply = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Enable web enrichment").setDesc("Allow refinement prompts to request internet context").addToggle(
      (tg) => tg.setValue(this.plugin.settings.enableWebEnrichment).onChange(async (value) => {
        this.plugin.settings.enableWebEnrichment = value;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/main.ts
var AICopilotPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.intervalId = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AICopilotSettingTab(this.app, this));
    this.addCommand({
      id: "ai-copilot-chat-active-note",
      name: "AI Copilot: Chat about active note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return void new import_obsidian2.Notice("No active note selected.");
        const content = await this.app.vault.read(file);
        const related = await this.getRelevantNotes(file.basename, this.settings.chatMaxResults);
        const prompt = [
          `ACTIVE NOTE (${file.path}):`,
          content,
          "\nRELATED CONTEXT:",
          ...related.map((n) => `- ${n.path} (score ${n.score.toFixed(2)})
${n.content.slice(0, 500)}`),
          "\nTask: summarize note, suggest improvements, and list TODOs."
        ].join("\n\n");
        const output = await buildClient(this.settings).chat(prompt, "You are an Obsidian assistant.");
        await this.writeAssistantOutput("Chat Output", output);
        new import_obsidian2.Notice("AI Copilot: chat output saved to AI Copilot/Chat Output.md");
      }
    });
    this.addCommand({
      id: "ai-copilot-chat-query",
      name: "AI Copilot: Chat using vault query",
      callback: async () => {
        const query = window.prompt("Ask a question about your notes:");
        if (!query?.trim()) return;
        const related = await this.getRelevantNotes(query, this.settings.chatMaxResults);
        const context = related.map((n) => `### ${n.path}
${n.content.slice(0, 1200)}`).join("\n\n");
        const prompt = `Question: ${query}

Use these notes:

${context}`;
        const output = await buildClient(this.settings).chat(prompt, "Answer using only note evidence.");
        await this.writeAssistantOutput("Chat Output", `## Query
${query}

## Response
${output}`);
        new import_obsidian2.Notice("AI Copilot: query response saved.");
      }
    });
    this.addCommand({
      id: "ai-copilot-run-refinement-now",
      name: "AI Copilot: Run refinement now",
      callback: async () => void this.runRefinementPass()
    });
    this.startRefinementLoop();
    new import_obsidian2.Notice("AI Copilot loaded.");
  }
  onunload() {
    if (this.intervalId) window.clearInterval(this.intervalId);
  }
  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.startRefinementLoop();
  }
  startRefinementLoop() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    const intervalMs = Math.max(15, this.settings.refinementIntervalMinutes) * 6e4;
    this.intervalId = window.setInterval(() => void this.runRefinementPass(), intervalMs);
    this.registerInterval(this.intervalId);
  }
  async runRefinementPass() {
    const candidates = await this.getRecentNotes(this.settings.refinementLookbackDays);
    if (!candidates.length) return void new import_obsidian2.Notice("AI Copilot: no recent notes to refine.");
    const plan = buildRefinementPlan(candidates);
    const prompt = buildRefinementPrompt(candidates, {
      enableWebEnrichment: this.settings.enableWebEnrichment
    });
    const output = await buildClient(this.settings).chat(
      `${toMarkdownPlan(plan)}

${prompt}`,
      "You refine markdown notes and preserve intent."
    );
    const todos = candidates.flatMap((n) => extractTodos(n.content));
    new import_obsidian2.Notice(`AI Copilot: scanned ${candidates.length} notes \xB7 TODOs ${todos.length}`);
    await this.writeAssistantOutput("Refinement Log", `${toMarkdownPlan(plan)}

## LLM Output
${output}`);
  }
  async writeAssistantOutput(name, body) {
    const file = await this.ensurePluginFile(`${name}.md`, `# ${name}
`);
    const stamp = `

---
${(/* @__PURE__ */ new Date()).toISOString()}
`;
    await this.app.vault.append(file, `${stamp}${body}
`);
  }
  async ensurePluginFile(name, initial) {
    const folderPath = "AI Copilot";
    const path = `${folderPath}/${name}`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian2.TFile) return existing;
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }
    return this.app.vault.create(path, initial);
  }
  async getRecentNotes(lookbackDays) {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1e3;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.stat.mtime >= cutoff);
    return Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f) })));
  }
  async getRelevantNotes(query, maxResults) {
    const files = this.app.vault.getMarkdownFiles();
    const notes = await Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f) })));
    return rankNotesByQuery(notes, query, maxResults);
  }
};
