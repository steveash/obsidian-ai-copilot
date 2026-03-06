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
var import_obsidian3 = require("obsidian");

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

// src/chat.ts
var import_obsidian = require("obsidian");
var AI_COPILOT_VIEW = "ai-copilot-chat-view";
var AICopilotChatView = class extends import_obsidian.ItemView {
  constructor(leaf, appRef) {
    super(leaf);
    this.appRef = appRef;
    this.messages = [];
    this.onSubmit = null;
    void appRef;
  }
  getViewType() {
    return AI_COPILOT_VIEW;
  }
  getDisplayText() {
    return "AI Copilot Chat";
  }
  setSubmitHandler(handler) {
    this.onSubmit = handler;
  }
  async onOpen() {
    this.render();
  }
  render() {
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
};
async function upsertChatOutput(app, text) {
  const path = "AI Copilot/Chat Output.md";
  const existing = app.vault.getAbstractFileByPath(path);
  let file;
  if (existing && "path" in existing) {
    file = existing;
  } else {
    if (!app.vault.getAbstractFileByPath("AI Copilot")) {
      await app.vault.createFolder("AI Copilot");
    }
    file = await app.vault.create(path, "# Chat Output\n");
  }
  await app.vault.append(file, `

---
${(/* @__PURE__ */ new Date()).toISOString()}
${text}
`);
  return file;
}

// src/patcher.ts
function applyPatch(content, patch) {
  if (!patch.find) {
    return { path: patch.path, applied: false, reason: "empty find", updatedContent: content };
  }
  if (!content.includes(patch.find)) {
    return { path: patch.path, applied: false, reason: "find text not found", updatedContent: content };
  }
  return {
    path: patch.path,
    applied: true,
    updatedContent: content.replace(patch.find, patch.replace)
  };
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

// src/semantic-retrieval.ts
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9#\[\]\/\-\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}
function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}
function extractMetadata(content) {
  const tags = [...content.matchAll(/(^|\s)#([a-zA-Z0-9_\/-]+)/g)].map((m) => m[2].toLowerCase());
  const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split("|")[0].trim());
  const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim());
  return { tags, links, headings };
}
function lexicalScore(doc, queryTerms) {
  const hay = `${doc.path}
${doc.content}`.toLowerCase();
  if (!queryTerms.length) return 0;
  const matches = queryTerms.filter((t) => hay.includes(t));
  const coverage = matches.length / queryTerms.length;
  const phrase = hay.includes(queryTerms.join(" ")) ? 0.5 : 0;
  return coverage + phrase;
}
function freshnessScore(mtime) {
  if (!mtime) return 0;
  const ageDays = (Date.now() - mtime) / (1e3 * 60 * 60 * 24);
  return 1 / (1 + Math.max(0, ageDays));
}
function applyGraphBoost(results, maxResults, hops) {
  if (hops <= 0) return results;
  const pathMap = new Map(results.map((r) => [r.path, r]));
  const topSeed = [...results].sort((a, b) => b.score - a.score).slice(0, Math.max(3, maxResults));
  for (const seed of topSeed) {
    for (const link of seed.metadata.links) {
      const direct = pathMap.get(link) || pathMap.get(`${link}.md`);
      if (direct) {
        direct.graphBoost += 0.15;
        direct.score += 0.15;
      }
    }
  }
  return results;
}

// src/vector-index.ts
function contentHash(input) {
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 ^= c + 31;
    h2 = Math.imul(h2, 16777619);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}
var PersistentVectorIndex = class {
  constructor(storage, provider) {
    this.storage = storage;
    this.provider = provider;
    this.cache = null;
  }
  async ensureLoaded() {
    if (!this.cache) this.cache = await this.storage.load();
  }
  async getOrCreate(path, content, model) {
    await this.ensureLoaded();
    const hash = contentHash(content);
    const rec = this.cache.records[path];
    if (rec && rec.contentHash === hash && rec.model === model) return rec.vector;
    const vector = await this.provider.embed(content, model);
    this.cache.records[path] = {
      path,
      contentHash: hash,
      model,
      vector,
      updatedAt: Date.now()
    };
    await this.storage.save(this.cache);
    return vector;
  }
  async rebuild(entries, model) {
    await this.ensureLoaded();
    for (const e of entries) {
      await this.getOrCreate(e.path, e.content, model);
    }
    return entries.length;
  }
};

// src/embedding-provider.ts
var OpenAIEmbeddingProvider = class {
  constructor(settings) {
    this.settings = settings;
  }
  async embed(text, model) {
    if (!this.settings.openaiApiKey) throw new Error("Missing OpenAI API key");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.openaiApiKey}`
      },
      body: JSON.stringify({ model, input: text.slice(0, 2e4) })
    });
    if (!res.ok) throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return json.data?.[0]?.embedding ?? [];
  }
};
var FallbackHashEmbeddingProvider = class {
  async embed(text) {
    const arr = new Array(256).fill(0);
    const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    for (const t of clean) {
      let h = 0;
      for (let i = 0; i < t.length; i++) h = h * 31 + t.charCodeAt(i) >>> 0;
      arr[h % arr.length] += 1;
    }
    const norm = Math.sqrt(arr.reduce((a, b) => a + b * b, 0)) || 1;
    return arr.map((x) => x / norm);
  }
};

// src/vault-vector-storage.ts
var INDEX_PATH = "AI Copilot/.index/vectors.json";
var VaultVectorStorage = class {
  constructor(app) {
    this.app = app;
  }
  async load() {
    const f = this.app.vault.getAbstractFileByPath(INDEX_PATH);
    if (!f) return { version: 1, records: {} };
    const text = await this.app.vault.read(f);
    try {
      const parsed = JSON.parse(text);
      if (parsed?.version === 1 && parsed.records) return parsed;
      return { version: 1, records: {} };
    } catch {
      return { version: 1, records: {} };
    }
  }
  async save(data) {
    const folder = this.app.vault.getAbstractFileByPath("AI Copilot");
    if (!folder) await this.app.vault.createFolder("AI Copilot");
    const idxFolder = this.app.vault.getAbstractFileByPath("AI Copilot/.index");
    if (!idxFolder) await this.app.vault.createFolder("AI Copilot/.index");
    const existing = this.app.vault.getAbstractFileByPath(INDEX_PATH);
    const content = JSON.stringify(data);
    if (existing) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(INDEX_PATH, content);
  }
};

// src/safety.ts
var API_KEY_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi
];
function redactSensitive(input) {
  let output = input;
  for (const pattern of API_KEY_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
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
  preselectCandidateCount: 40
};
var AICopilotSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI Copilot Settings" });
    new import_obsidian2.Setting(containerEl).setName("Provider").setDesc("LLM provider used by chat + refinement").addDropdown(
      (d) => d.addOption("none", "None (dry-run)").addOption("openai", "OpenAI").setValue(this.plugin.settings.provider).onChange(async (value) => {
        this.plugin.settings.provider = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("OpenAI API key").setDesc("Stored locally in Obsidian plugin data.").addText(
      (t) => t.setPlaceholder("sk-...").setValue(this.plugin.settings.openaiApiKey).onChange(async (value) => {
        this.plugin.settings.openaiApiKey = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("OpenAI model").setDesc("Model used for note chat and refinement").addText(
      (t) => t.setValue(this.plugin.settings.openaiModel).onChange(async (value) => {
        this.plugin.settings.openaiModel = value.trim() || "gpt-4o-mini";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Chat max note results").setDesc("How many notes are included in chat context").addSlider(
      (s) => s.setLimits(1, 20, 1).setValue(this.plugin.settings.chatMaxResults).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.chatMaxResults = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Refinement interval (minutes)").setDesc("Background pass cadence").addText(
      (t) => t.setValue(String(this.plugin.settings.refinementIntervalMinutes)).onChange(async (value) => {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 15) {
          this.plugin.settings.refinementIntervalMinutes = Math.floor(n);
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Refinement lookback (days)").setDesc("Only notes modified within this range are candidates").addSlider(
      (s) => s.setLimits(1, 30, 1).setValue(this.plugin.settings.refinementLookbackDays).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.refinementLookbackDays = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Auto apply refinement").setDesc("If disabled, plugin only logs/surfaces suggestions").addToggle(
      (tg) => tg.setValue(this.plugin.settings.refinementAutoApply).onChange(async (value) => {
        this.plugin.settings.refinementAutoApply = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Enable web enrichment").setDesc("Allow refinement prompts to request internet context").addToggle(
      (tg) => tg.setValue(this.plugin.settings.enableWebEnrichment).onChange(async (value) => {
        this.plugin.settings.enableWebEnrichment = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Retrieval lexical weight").setDesc("Weight for BM25-style keyword overlap").addSlider(
      (s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.retrievalLexicalWeight).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalLexicalWeight = Number(value.toFixed(2));
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Retrieval semantic weight").setDesc("Weight for local embedding cosine similarity").addSlider(
      (s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.retrievalSemanticWeight).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalSemanticWeight = Number(value.toFixed(2));
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Retrieval freshness weight").setDesc("Bias toward recently edited notes").addSlider(
      (s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.retrievalFreshnessWeight).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalFreshnessWeight = Number(value.toFixed(2));
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Graph expansion hops").setDesc("Boost notes connected by [[wikilinks]] from top results").addSlider(
      (s) => s.setLimits(0, 2, 1).setValue(this.plugin.settings.retrievalGraphExpandHops).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalGraphExpandHops = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Embedding model").setDesc("Remote embedding model for persistent vector index").addText(
      (t) => t.setValue(this.plugin.settings.embeddingModel).onChange(async (value) => {
        this.plugin.settings.embeddingModel = value.trim() || "text-embedding-3-large";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Preselect candidates").setDesc("Lexical top-N candidates before vector reranking").addSlider(
      (s) => s.setLimits(10, 200, 5).setValue(this.plugin.settings.preselectCandidateCount).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.preselectCandidateCount = value;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/main.ts
var AICopilotPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.intervalId = null;
    this.vectorIndex = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AICopilotSettingTab(this.app, this));
    this.initializeVectorIndex();
    this.registerView(AI_COPILOT_VIEW, (leaf) => new AICopilotChatView(leaf, this.app));
    this.addCommand({
      id: "ai-copilot-open-chat-panel",
      name: "AI Copilot: Open chat panel",
      callback: async () => {
        await this.activateChatView();
      }
    });
    this.addCommand({
      id: "ai-copilot-chat-active-note",
      name: "AI Copilot: Chat about active note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return void new import_obsidian3.Notice("No active note selected.");
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
        new import_obsidian3.Notice("AI Copilot: chat output saved to AI Copilot/Chat Output.md");
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
        await upsertChatOutput(this.app, `## Query
${query}

## Response
${output}`);
        new import_obsidian3.Notice("AI Copilot: query response saved.");
      }
    });
    this.addCommand({
      id: "ai-copilot-rebuild-vector-index",
      name: "AI Copilot: Rebuild persistent vector index",
      callback: async () => {
        const notes = await this.getAllNotes();
        if (!this.vectorIndex) this.initializeVectorIndex();
        const count = await this.vectorIndex.rebuild(
          notes.map((n) => ({ path: n.path, content: `${n.path}
${n.content}` })),
          this.settings.embeddingModel
        );
        new import_obsidian3.Notice(`AI Copilot: rebuilt vector index for ${count} notes.`);
      }
    });
    this.addCommand({
      id: "ai-copilot-run-refinement-now",
      name: "AI Copilot: Run refinement now",
      callback: async () => void this.runRefinementPass()
    });
    this.startRefinementLoop();
    new import_obsidian3.Notice("AI Copilot loaded.");
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
    this.initializeVectorIndex();
  }
  startRefinementLoop() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    const intervalMs = Math.max(15, this.settings.refinementIntervalMinutes) * 6e4;
    this.intervalId = window.setInterval(() => void this.runRefinementPass(), intervalMs);
    this.registerInterval(this.intervalId);
  }
  initializeVectorIndex() {
    const provider = this.settings.provider === "openai" ? new OpenAIEmbeddingProvider(this.settings) : new FallbackHashEmbeddingProvider();
    this.vectorIndex = new PersistentVectorIndex(new VaultVectorStorage(this.app), provider);
  }
  async getAllNotes() {
    const files = this.app.vault.getMarkdownFiles();
    return Promise.all(
      files.map(async (f) => ({ path: f.path, content: await this.app.vault.read(f), mtime: f.stat.mtime }))
    );
  }
  async activateChatView() {
    const { workspace } = this.app;
    let leaf = null;
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
      view.setSubmitHandler(async (query) => {
        const related = await this.getRelevantNotes(query, this.settings.chatMaxResults);
        const context = related.map((n) => `### ${n.path}
${n.content.slice(0, 1200)}`).join("\n\n");
        const prompt = `Question: ${query}

Use these notes:

${context}`;
        const output = await buildClient(this.settings).chat(prompt, "Answer using only note evidence.");
        await upsertChatOutput(this.app, `## Query
${query}

## Response
${output}`);
        return output;
      });
    }
  }
  async runRefinementPass() {
    const candidates = await this.getRecentNotes(this.settings.refinementLookbackDays);
    if (!candidates.length) return void new import_obsidian3.Notice("AI Copilot: no recent notes to refine.");
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
    if (this.settings.refinementAutoApply && candidates[0]) {
      const c = candidates[0];
      const patched = applyPatch(c.content, {
        path: c.path,
        find: "  ",
        replace: " ",
        reason: "normalize spacing"
      });
      if (patched.applied) {
        const file = this.app.vault.getAbstractFileByPath(c.path);
        if (file instanceof import_obsidian3.TFile) await this.app.vault.modify(file, patched.updatedContent);
      }
    }
    new import_obsidian3.Notice(`AI Copilot: scanned ${candidates.length} notes \xB7 TODOs ${todos.length}`);
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
    await this.app.vault.append(file, `${stamp}${redactSensitive(body)}
`);
  }
  async ensurePluginFile(name, initial) {
    const folderPath = "AI Copilot";
    const path = `${folderPath}/${name}`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian3.TFile) return existing;
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
    const notes = await this.getAllNotes();
    const queryTerms = tokenize(query);
    const pre = notes.map((n) => {
      const lex = lexicalScore(n, queryTerms);
      const fresh = freshnessScore(n.mtime);
      return { n, lex, fresh, preScore: lex + 0.25 * fresh };
    }).sort((a, b) => b.preScore - a.preScore).slice(0, Math.max(maxResults, this.settings.preselectCandidateCount));
    if (!this.vectorIndex) this.initializeVectorIndex();
    const queryVec = await this.vectorIndex.getOrCreate(
      "__query__",
      query,
      this.settings.embeddingModel
    );
    const ranked = [];
    for (const c of pre) {
      const docVec = await this.vectorIndex.getOrCreate(
        c.n.path,
        `${c.n.path}
${c.n.content}`,
        this.settings.embeddingModel
      );
      const sem = cosine(docVec, queryVec);
      const score = this.settings.retrievalLexicalWeight * c.lex + this.settings.retrievalSemanticWeight * sem + this.settings.retrievalFreshnessWeight * c.fresh;
      ranked.push({
        ...c.n,
        score,
        lexicalScore: c.lex,
        semanticScore: sem,
        freshnessScore: c.fresh,
        graphBoost: 0,
        metadata: extractMetadata(c.n.content)
      });
    }
    return applyGraphBoost(ranked, maxResults, this.settings.retrievalGraphExpandHops).sort((a, b) => b.score - a.score).slice(0, maxResults);
  }
};
