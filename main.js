"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// src/patcher.ts
function countOccurrences(content, find) {
  if (!find) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    idx = content.indexOf(find, idx);
    if (idx < 0) return count;
    count += 1;
    idx += find.length;
  }
}
function sampleAround(content, needle, radius = 50) {
  if (!needle) return content.slice(0, radius * 2);
  const idx = content.indexOf(needle);
  if (idx < 0) return content.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + needle.length + radius);
  return content.slice(start, end);
}
function applyPatch(content, patch) {
  if (!patch.find) {
    return { path: patch.path, applied: false, reason: "empty find", updatedContent: content, occurrences: 0 };
  }
  const occurrences = countOccurrences(content, patch.find);
  if (!occurrences) {
    return {
      path: patch.path,
      applied: false,
      reason: "find text not found",
      updatedContent: content,
      occurrences: 0
    };
  }
  const updatedContent = patch.replaceAll ? content.split(patch.find).join(patch.replace) : content.replace(patch.find, patch.replace);
  return {
    path: patch.path,
    applied: true,
    updatedContent,
    occurrences
  };
}
function previewPatch(content, patch) {
  const applied = applyPatch(content, patch);
  return {
    path: patch.path,
    reason: patch.reason,
    applied: applied.applied,
    beforeSample: sampleAround(content, patch.find),
    afterSample: sampleAround(applied.updatedContent, patch.replace || patch.find),
    occurrences: applied.occurrences ?? 0
  };
}
function applyPatchTransaction(content, patch) {
  const result = applyPatch(content, patch);
  return {
    patch,
    original: content,
    updated: result.updatedContent,
    applied: result.applied,
    rollbackPatch: result.applied ? buildRollbackPatch(content, result.updatedContent, patch.path) : null
  };
}
function applyPatchSet(content, patches) {
  let next = content;
  const transactions = [];
  for (const patch of patches) {
    const tx = applyPatchTransaction(next, patch);
    transactions.push(tx);
    next = tx.updated;
  }
  return { finalContent: next, transactions };
}
function rollbackTransactions(content, transactions) {
  let next = content;
  for (const tx of [...transactions].reverse()) {
    if (!tx.rollbackPatch) continue;
    const rolled = applyPatch(next, tx.rollbackPatch);
    next = rolled.updatedContent;
  }
  return next;
}
function buildRollbackPatch(original, updated, path) {
  if (original === updated) return null;
  return {
    path,
    find: updated,
    replace: original,
    reason: "rollback"
  };
}
var init_patcher = __esm({
  "src/patcher.ts"() {
    "use strict";
  }
});

// src/patch-safety.ts
function checkPathProtected(path, protectedPaths = DEFAULT_PROTECTED_PATHS) {
  const issues = [];
  for (const pp of protectedPaths) {
    if (path === pp || path.startsWith(pp)) {
      issues.push(`path "${path}" is protected (matches "${pp}")`);
    }
  }
  return { safe: issues.length === 0, issues };
}
function checkEditSize(find, replace, maxSize = DEFAULT_MAX_EDIT_SIZE) {
  const issues = [];
  if (find.length > maxSize) {
    issues.push(`find string exceeds max edit size (${find.length} > ${maxSize})`);
  }
  if (replace.length > maxSize) {
    issues.push(`replace string exceeds max edit size (${replace.length} > ${maxSize})`);
  }
  return { safe: issues.length === 0, issues };
}
function checkSecretTouching(find, replace) {
  const issues = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(find)) {
      issues.push("find string contains a potential secret/credential pattern");
      break;
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(replace)) {
      issues.push("replace string contains a potential secret/credential pattern");
      break;
    }
  }
  return { safe: issues.length === 0, issues };
}
function runSafetyChecks(path, find, replace, config = {}) {
  const allIssues = [];
  const pathCheck = checkPathProtected(path, config.protectedPaths);
  allIssues.push(...pathCheck.issues);
  const sizeCheck = checkEditSize(find, replace, config.maxEditSize);
  allIssues.push(...sizeCheck.issues);
  if (config.blockSecretTouching !== false) {
    const secretCheck = checkSecretTouching(find, replace);
    allIssues.push(...secretCheck.issues);
  }
  return { safe: allIssues.length === 0, issues: allIssues };
}
var SECRET_PATTERNS, DEFAULT_PROTECTED_PATHS, DEFAULT_MAX_EDIT_SIZE;
var init_patch_safety = __esm({
  "src/patch-safety.ts"() {
    "use strict";
    SECRET_PATTERNS = [
      /sk-ant-[A-Za-z0-9\-_]{20,}/,
      /sk-[A-Za-z0-9]{20,}/,
      /AKIA[A-Z0-9]{16}/,
      /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{12,}/i
    ];
    DEFAULT_PROTECTED_PATHS = [
      ".obsidian/",
      ".git/",
      "node_modules/",
      ".env"
    ];
    DEFAULT_MAX_EDIT_SIZE = 5e4;
  }
});

// src/patch-plan.ts
var patch_plan_exports = {};
__export(patch_plan_exports, {
  applyMultiFilePatchPlan: () => applyMultiFilePatchPlan,
  applyPatchPlan: () => applyPatchPlan,
  detectConflicts: () => detectConflicts,
  previewPatchPlan: () => previewPatchPlan,
  rollbackPatchPlan: () => rollbackPatchPlan,
  rollbackToSnapshot: () => rollbackToSnapshot,
  toMarkdownPatchPlanPreview: () => toMarkdownPatchPlanPreview,
  validateMultiFilePatchPlan: () => validateMultiFilePatchPlan,
  validatePatchPlan: () => validatePatchPlan
});
function validatePatchPlan(plan) {
  const issues = [];
  if (!plan.path.trim()) issues.push("path is required");
  if (!Array.isArray(plan.edits) || plan.edits.length === 0) {
    issues.push("at least one edit is required");
  }
  const seenEditKeys = /* @__PURE__ */ new Set();
  plan.edits.forEach((edit, idx) => {
    if (!edit.find) issues.push(`edit ${idx + 1}: find is required`);
    if (edit.find.length > 2e4) issues.push(`edit ${idx + 1}: find token is too large`);
    if (edit.find === edit.replace) issues.push(`edit ${idx + 1}: find and replace are identical`);
    if (!edit.reason?.trim()) issues.push(`edit ${idx + 1}: reason is required`);
    const dedupeKey = `${edit.find}\0${edit.replace}\0${Boolean(edit.replaceAll)}`;
    if (seenEditKeys.has(dedupeKey)) issues.push(`edit ${idx + 1}: duplicate edit`);
    seenEditKeys.add(dedupeKey);
  });
  return { valid: issues.length === 0, issues };
}
function validateMultiFilePatchPlan(plan) {
  const issues = [];
  if (!plan.files.length) issues.push("at least one file is required");
  for (const file of plan.files) {
    const fileValidation = validatePatchPlan(file);
    if (!fileValidation.valid) {
      issues.push(...fileValidation.issues.map((i) => `[${file.path}] ${i}`));
    }
  }
  return { valid: issues.length === 0, issues };
}
function detectConflicts(content, edits) {
  const conflicts = [];
  let simulated = content;
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const occurrences = countOccurrences2(simulated, edit.find);
    if (occurrences === 0) {
      conflicts.push({
        editIndex: i,
        reason: edit.reason,
        find: edit.find.slice(0, 100),
        conflict: "stale",
        detail: "find text not present in content (stale region)"
      });
    } else if (occurrences > 1 && !edit.replaceAll) {
      conflicts.push({
        editIndex: i,
        reason: edit.reason,
        find: edit.find.slice(0, 100),
        conflict: "ambiguous",
        detail: `find text matches ${occurrences} locations; consider replaceAll or a more specific find`
      });
    }
    if (occurrences > 0) {
      simulated = edit.replaceAll ? simulated.split(edit.find).join(edit.replace) : simulated.replace(edit.find, edit.replace);
    }
  }
  return conflicts;
}
function countOccurrences2(content, find) {
  if (!find) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    idx = content.indexOf(find, idx);
    if (idx < 0) return count;
    count += 1;
    idx += find.length;
  }
}
function previewPatchPlan(content, plan, safetyConfig) {
  let next = content;
  const edits = plan.edits.map((edit, idx) => {
    const v2 = edit;
    const safety = runSafetyChecks(plan.path, edit.find, edit.replace, safetyConfig);
    const p = previewPatch(next, {
      path: plan.path,
      find: edit.find,
      replace: edit.replace,
      reason: edit.reason,
      replaceAll: edit.replaceAll
    });
    if (p.applied) {
      next = edit.replaceAll ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, edit.replace);
    }
    return {
      index: idx + 1,
      reason: edit.reason,
      applied: p.applied,
      occurrences: p.occurrences,
      status: p.applied ? "applied" : "no-op (find text not found)",
      beforeSample: p.beforeSample,
      afterSample: p.afterSample,
      confidence: v2.confidence,
      risk: v2.risk,
      safetyIssues: safety.issues
    };
  });
  return {
    path: plan.path,
    title: plan.title,
    summary: {
      totalEdits: edits.length,
      appliedEdits: edits.filter((e) => e.applied).length,
      totalOccurrences: edits.reduce((sum, e) => sum + e.occurrences, 0),
      safeEdits: edits.filter((e) => (e.risk ?? "safe") === "safe" && e.safetyIssues.length === 0).length,
      unsafeEdits: edits.filter((e) => e.risk === "unsafe" || e.safetyIssues.length > 0).length
    },
    edits
  };
}
function applyPatchPlan(content, plan, options) {
  const snapshot = content;
  const selected = options?.selectedIndices;
  const editsToApply = selected ? plan.edits.filter((_, i) => selected.includes(i)) : plan.edits;
  const patches = editsToApply.map((edit) => ({
    path: plan.path,
    find: edit.find,
    replace: edit.replace,
    reason: edit.reason,
    replaceAll: edit.replaceAll
  }));
  const safePatchesAndTxs = patches.map((patch) => {
    if (!options?.safetyConfig) return { patch, safetyOk: true };
    const check = runSafetyChecks(patch.path, patch.find, patch.replace, options.safetyConfig);
    return { patch, safetyOk: check.safe };
  });
  const filteredPatches = safePatchesAndTxs.filter((p) => p.safetyOk).map((p) => p.patch);
  const applied = applyPatchSet(content, filteredPatches);
  const appliedCount = applied.transactions.filter((tx) => tx.applied).length;
  const skippedCount = safePatchesAndTxs.filter((p) => !p.safetyOk).length;
  let summary = `Applied ${appliedCount}/${patches.length} edit(s)`;
  if (skippedCount) summary += ` (${skippedCount} blocked by safety)`;
  if (selected) summary += ` [subset: ${selected.length}/${plan.edits.length} selected]`;
  return {
    finalContent: applied.finalContent,
    transactions: applied.transactions,
    snapshot,
    summary
  };
}
function applyMultiFilePatchPlan(fileContents, plan, options) {
  const results = [];
  for (const file of plan.files) {
    const content = fileContents.get(file.path);
    if (content === void 0) {
      results.push({
        path: file.path,
        applied: { finalContent: "", transactions: [], snapshot: "", summary: "file not found" },
        safetyCheck: { safe: false, issues: [`file "${file.path}" not found in provided contents`] },
        conflicts: [],
        skipped: true
      });
      continue;
    }
    const safetyCheck = runSafetyChecks(file.path, "", "", options?.safetyConfig);
    const conflicts = detectConflicts(content, file.edits);
    const staleConflicts = conflicts.filter((c) => c.conflict === "stale");
    if (!safetyCheck.safe) {
      results.push({
        path: file.path,
        applied: { finalContent: content, transactions: [], snapshot: content, summary: "blocked by safety" },
        safetyCheck,
        conflicts,
        skipped: true
      });
      continue;
    }
    const selectedIndices = options?.selectedEdits?.get(file.path);
    const applied = applyPatchPlan(content, file, {
      selectedIndices,
      safetyConfig: options?.safetyConfig
    });
    results.push({
      path: file.path,
      applied,
      safetyCheck,
      conflicts,
      skipped: false
    });
  }
  const totalApplied = results.filter((r) => !r.skipped).length;
  const totalSkipped = results.filter((r) => r.skipped).length;
  const summary = `Multi-file patch: ${totalApplied} file(s) processed, ${totalSkipped} skipped`;
  return { title: plan.title, results, summary };
}
function rollbackPatchPlan(content, transactions) {
  return rollbackTransactions(content, transactions);
}
function rollbackToSnapshot(snapshot) {
  return snapshot;
}
function toMarkdownPatchPlanPreview(preview) {
  const lines = [
    "## Patch Plan Preview",
    preview.title ? `Title: ${preview.title}` : null,
    `Path: ${preview.path}`,
    `Summary: ${preview.summary.appliedEdits}/${preview.summary.totalEdits} edits apply \xB7 ${preview.summary.totalOccurrences} total occurrences`,
    preview.summary.unsafeEdits ? `\u26A0 ${preview.summary.unsafeEdits} edit(s) flagged unsafe` : null,
    ""
  ].filter(Boolean);
  for (const edit of preview.edits) {
    lines.push(`### Edit ${edit.index}: ${edit.reason}`);
    lines.push(`- Applied: ${edit.applied ? "yes" : "no"}`);
    lines.push(`- Status: ${edit.status}`);
    lines.push(`- Occurrences: ${edit.occurrences}`);
    if (edit.confidence !== void 0) lines.push(`- Confidence: ${(edit.confidence * 100).toFixed(0)}%`);
    if (edit.risk) lines.push(`- Risk: ${edit.risk}`);
    if (edit.safetyIssues.length) {
      lines.push(`- Safety issues: ${edit.safetyIssues.join("; ")}`);
    }
    lines.push("- Before sample:");
    lines.push("```md");
    lines.push(edit.beforeSample);
    lines.push("```");
    lines.push("- After sample:");
    lines.push("```md");
    lines.push(edit.afterSample);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}
var init_patch_plan = __esm({
  "src/patch-plan.ts"() {
    "use strict";
    init_patcher();
    init_patch_safety();
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AICopilotPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");
init_patch_plan();

// src/safety.ts
var API_KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /(?:aws_?secret_?access_?key|secret_?key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}["']?/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
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
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  provider: "none",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-6",
  bedrockAccessKeyId: "",
  bedrockSecretAccessKey: "",
  bedrockRegion: "us-west-2",
  bedrockModel: "us.anthropic.claude-sonnet-4-20250514-v1:0",
  chatMaxResults: 6,
  refinementIntervalMinutes: 120,
  refinementLookbackDays: 3,
  refinementAutoApply: false,
  enableWebEnrichment: false,
  retrievalLexicalWeight: 0.45,
  retrievalSemanticWeight: 0.45,
  retrievalFreshnessWeight: 0.1,
  retrievalGraphExpandHops: 1,
  embeddingProvider: "fallback-hash",
  embeddingModel: "text-embedding-3-large",
  bedrockEmbeddingModel: "amazon.titan-embed-text-v2:0",
  preselectCandidateCount: 40,
  retrievalChunkSize: 1200,
  rerankerEnabled: true,
  rerankerTopK: 8,
  rerankerType: "openai",
  rerankerModel: "gpt-4.1-mini",
  agentMaxToolCalls: 10,
  agentTimeoutMs: 6e4,
  allowRemoteModels: true,
  redactSensitiveLogs: true,
  maxPromptChars: 2e4,
  strictConfigValidation: true,
  enrichmentConfidenceThreshold: 0.6,
  enrichmentDestructiveRewriteThreshold: 0.3,
  enrichmentPersistState: true
};
function parseProvider(value) {
  if (value === "openai" || value === "anthropic" || value === "bedrock") return value;
  return "none";
}
function parseEmbeddingProvider(value) {
  if (value === "openai" || value === "bedrock") return value;
  return "fallback-hash";
}
function parseRerankerType(value) {
  return value === "openai" ? "openai" : "heuristic";
}
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
      (d) => d.addOption("none", "None (dry-run)").addOption("openai", "OpenAI").addOption("anthropic", "Anthropic").addOption("bedrock", "AWS Bedrock").setValue(this.plugin.settings.provider).onChange(async (value) => {
        this.plugin.settings.provider = parseProvider(value);
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
    new import_obsidian.Setting(containerEl).setName("Anthropic API key").setDesc("Stored locally in Obsidian plugin data.").addText(
      (t) => t.setPlaceholder("sk-ant-...").setValue(this.plugin.settings.anthropicApiKey).onChange(async (value) => {
        this.plugin.settings.anthropicApiKey = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Anthropic model").setDesc("Model used when provider is Anthropic").addText(
      (t) => t.setValue(this.plugin.settings.anthropicModel).onChange(async (value) => {
        this.plugin.settings.anthropicModel = value.trim() || "claude-sonnet-4-6";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Bedrock AWS access key ID").setDesc("AWS access key for Bedrock API calls").addText(
      (t) => t.setPlaceholder("AKIA...").setValue(this.plugin.settings.bedrockAccessKeyId).onChange(async (value) => {
        this.plugin.settings.bedrockAccessKeyId = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Bedrock AWS secret access key").setDesc("Stored locally in Obsidian plugin data.").addText(
      (t) => t.setPlaceholder("secret...").setValue(this.plugin.settings.bedrockSecretAccessKey).onChange(async (value) => {
        this.plugin.settings.bedrockSecretAccessKey = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Bedrock AWS region").setDesc("AWS region for Bedrock runtime endpoint").addText(
      (t) => t.setValue(this.plugin.settings.bedrockRegion).onChange(async (value) => {
        this.plugin.settings.bedrockRegion = value.trim() || "us-west-2";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Bedrock model").setDesc("Bedrock model ID (e.g. us.anthropic.claude-sonnet-4-20250514-v1:0)").addText(
      (t) => t.setValue(this.plugin.settings.bedrockModel).onChange(async (value) => {
        this.plugin.settings.bedrockModel = value.trim() || "us.anthropic.claude-sonnet-4-20250514-v1:0";
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
    new import_obsidian.Setting(containerEl).setName("Retrieval lexical weight").setDesc("Weight for BM25-style keyword overlap").addSlider(
      (s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.retrievalLexicalWeight).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalLexicalWeight = Number(value.toFixed(2));
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Retrieval semantic weight").setDesc("Weight for local embedding cosine similarity").addSlider(
      (s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.retrievalSemanticWeight).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalSemanticWeight = Number(value.toFixed(2));
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Retrieval freshness weight").setDesc("Bias toward recently edited notes").addSlider(
      (s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.retrievalFreshnessWeight).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalFreshnessWeight = Number(value.toFixed(2));
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Graph expansion hops").setDesc("Boost notes connected by [[wikilinks]] from top results").addSlider(
      (s) => s.setLimits(0, 2, 1).setValue(this.plugin.settings.retrievalGraphExpandHops).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalGraphExpandHops = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Embedding provider").setDesc("Provider for vector embeddings (switching triggers index rebuild)").addDropdown(
      (d) => d.addOption("fallback-hash", "Local hash (no API)").addOption("openai", "OpenAI").addOption("bedrock", "AWS Bedrock (Titan)").setValue(this.plugin.settings.embeddingProvider).onChange(async (value) => {
        this.plugin.settings.embeddingProvider = parseEmbeddingProvider(value);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Embedding model (OpenAI)").setDesc("OpenAI embedding model for persistent vector index").addText(
      (t) => t.setValue(this.plugin.settings.embeddingModel).onChange(async (value) => {
        this.plugin.settings.embeddingModel = value.trim() || "text-embedding-3-large";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Embedding model (Bedrock)").setDesc("Bedrock Titan embedding model ID").addText(
      (t) => t.setValue(this.plugin.settings.bedrockEmbeddingModel).onChange(async (value) => {
        this.plugin.settings.bedrockEmbeddingModel = value.trim() || "amazon.titan-embed-text-v2:0";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Preselect candidates").setDesc("Lexical top-N candidates before vector reranking").addSlider(
      (s) => s.setLimits(10, 200, 5).setValue(this.plugin.settings.preselectCandidateCount).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.preselectCandidateCount = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Chunk size (chars)").setDesc("Approximate section chunk size for vector indexing").addSlider(
      (s) => s.setLimits(400, 3e3, 100).setValue(this.plugin.settings.retrievalChunkSize).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.retrievalChunkSize = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Enable reranker").setDesc("Second-pass rerank on top retrieved chunks").addToggle(
      (tg) => tg.setValue(this.plugin.settings.rerankerEnabled).onChange(async (value) => {
        this.plugin.settings.rerankerEnabled = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Reranker top-k").setDesc("How many results get reranker pass").addSlider(
      (s) => s.setLimits(3, 20, 1).setValue(this.plugin.settings.rerankerTopK).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.rerankerTopK = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Reranker engine").setDesc("Best quality: OpenAI LLM reranker").addDropdown(
      (d) => d.addOption("openai", "OpenAI (best quality)").addOption("heuristic", "Heuristic (local fallback)").setValue(this.plugin.settings.rerankerType).onChange(async (value) => {
        this.plugin.settings.rerankerType = parseRerankerType(value);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Reranker model").setDesc("OpenAI model used for reranking").addText(
      (t) => t.setValue(this.plugin.settings.rerankerModel).onChange(async (value) => {
        this.plugin.settings.rerankerModel = value.trim() || "gpt-4.1-mini";
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Agent Behavior" });
    new import_obsidian.Setting(containerEl).setName("Max tool calls per query").setDesc("Maximum number of tool invocations the agent can make per chat query").addSlider(
      (s) => s.setLimits(1, 30, 1).setValue(this.plugin.settings.agentMaxToolCalls).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.agentMaxToolCalls = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Agent timeout (seconds)").setDesc("Maximum time for the agent loop before aborting").addSlider(
      (s) => s.setLimits(10, 300, 10).setValue(Math.round(this.plugin.settings.agentTimeoutMs / 1e3)).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.agentTimeoutMs = value * 1e3;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Security + Validation" });
    new import_obsidian.Setting(containerEl).setName("Allow remote models").setDesc("Disable to force local/dry-run behavior only").addToggle(
      (tg) => tg.setValue(this.plugin.settings.allowRemoteModels).onChange(async (value) => {
        this.plugin.settings.allowRemoteModels = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Redact sensitive logs").setDesc("Mask API keys and likely secrets in plugin output files").addToggle(
      (tg) => tg.setValue(this.plugin.settings.redactSensitiveLogs).onChange(async (value) => {
        this.plugin.settings.redactSensitiveLogs = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Max prompt chars").setDesc("Hard cap on prompt size sent to model APIs").addText(
      (t) => t.setValue(String(this.plugin.settings.maxPromptChars)).onChange(async (value) => {
        const n = Number(value);
        if (Number.isFinite(n)) {
          this.plugin.settings.maxPromptChars = Math.max(2e3, Math.floor(n));
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Strict config validation").setDesc("Warn on invalid config and block unsafe remote calls").addToggle(
      (tg) => tg.setValue(this.plugin.settings.strictConfigValidation).onChange(async (value) => {
        this.plugin.settings.strictConfigValidation = value;
        await this.plugin.saveSettings();
      })
    );
    containerEl.createEl("h3", { text: "Enrichment State" });
    new import_obsidian.Setting(containerEl).setName("Persist enrichment state").setDesc("Track per-note enrichment state in sidecar files").addToggle(
      (tg) => tg.setValue(this.plugin.settings.enrichmentPersistState).onChange(async (value) => {
        this.plugin.settings.enrichmentPersistState = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Enrichment confidence threshold").setDesc("Below this average confidence, notes require human review (0.0\u20131.0)").addText(
      (t) => t.setValue(String(this.plugin.settings.enrichmentConfidenceThreshold)).onChange(async (value) => {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0 && n <= 1) {
          this.plugin.settings.enrichmentConfidenceThreshold = n;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Destructive rewrite threshold").setDesc("Above this content-change ratio, notes require human review (0.0\u20131.0)").addText(
      (t) => t.setValue(String(this.plugin.settings.enrichmentDestructiveRewriteThreshold)).onChange(async (value) => {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0 && n <= 1) {
          this.plugin.settings.enrichmentDestructiveRewriteThreshold = n;
          await this.plugin.saveSettings();
        }
      })
    );
  }
};

// src/config-validation.ts
function validateSettings(input) {
  const issues = [];
  if (input.provider === "openai" && !input.openaiApiKey) issues.push("OpenAI provider requires an API key.");
  if (input.provider === "anthropic" && !input.anthropicApiKey) issues.push("Anthropic provider requires an API key.");
  if (input.provider === "bedrock" && (!input.bedrockAccessKeyId || !input.bedrockSecretAccessKey)) {
    issues.push("Bedrock provider requires AWS access key ID and secret access key.");
  }
  if (input.provider === "bedrock" && !input.bedrockRegion) issues.push("Bedrock provider requires an AWS region.");
  if (input.embeddingProvider === "openai" && !input.openaiApiKey) {
    issues.push("OpenAI embedding provider requires an API key.");
  }
  if (input.embeddingProvider === "bedrock" && (!input.bedrockAccessKeyId || !input.bedrockSecretAccessKey)) {
    issues.push("Bedrock embedding provider requires AWS access key ID and secret access key.");
  }
  if (input.embeddingProvider === "bedrock" && !input.bedrockRegion) {
    issues.push("Bedrock embedding provider requires an AWS region.");
  }
  const weights = input.retrievalLexicalWeight + input.retrievalSemanticWeight + input.retrievalFreshnessWeight;
  if (weights > 1.5) issues.push("Retrieval weight sum is too high; expected <= 1.5.");
  if (input.maxPromptChars < 2e3 || input.maxPromptChars > 1e5) {
    issues.push("maxPromptChars must be between 2000 and 100000.");
  }
  if (input.rerankerTopK < 1) issues.push("rerankerTopK must be >= 1.");
  return issues;
}

// src/semantic-retrieval.ts
var FILTER_KEYS = /* @__PURE__ */ new Set(["folder", "tag", "link", "before", "after"]);
function tokenizeQueryPreservingQuotes(query) {
  const out = [];
  let i = 0;
  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i])) i += 1;
    if (i >= query.length) break;
    let token = "";
    while (i < query.length && !/\s/.test(query[i])) {
      if ((query[i] === '"' || query[i] === "'") && token.endsWith(":")) {
        const quote = query[i++];
        while (i < query.length && query[i] !== quote) {
          if (query[i] === "\\" && i + 1 < query.length) {
            token += query[i + 1];
            i += 2;
            continue;
          }
          token += query[i++];
        }
        if (query[i] === quote) i += 1;
        continue;
      }
      token += query[i++];
    }
    if (token) out.push(token);
  }
  return out;
}
function normalizeFolder(folder) {
  const cleaned = folder.trim().replace(/^\.?\/+/, "").replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!cleaned || cleaned.includes("..")) return null;
  return cleaned.toLowerCase();
}
function normalizeTag(tag) {
  const cleaned = tag.trim().replace(/^#/, "").toLowerCase();
  if (!cleaned || !/^[a-z0-9_\/-]+$/.test(cleaned)) return null;
  return cleaned;
}
function normalizeLink(link) {
  const cleaned = link.trim().replace(/\.md$/i, "").replace(/^\[\[|\]\]$/g, "");
  if (!cleaned || cleaned.includes("\n")) return null;
  return cleaned;
}
function parseDateMs(input) {
  const ts = Date.parse(input.trim());
  return Number.isFinite(ts) ? ts : null;
}
function parseQueryConstraints(query) {
  const terms = [];
  const warnings = [];
  const out = { terms, warnings };
  const tokens = tokenizeQueryPreservingQuotes(query);
  for (const token of tokens) {
    const sepIdx = token.indexOf(":");
    if (sepIdx <= 0) {
      terms.push(token);
      continue;
    }
    const key = token.slice(0, sepIdx).toLowerCase();
    const rawValue = token.slice(sepIdx + 1).trim();
    if (!FILTER_KEYS.has(key) || !rawValue) {
      terms.push(token);
      continue;
    }
    if (key === "folder") {
      const value = normalizeFolder(rawValue);
      if (value) out.folder = value;
      else {
        warnings.push(`Invalid folder filter: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }
    if (key === "tag") {
      const value = normalizeTag(rawValue);
      if (value) out.tag = value;
      else {
        warnings.push(`Invalid tag filter: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }
    if (key === "link") {
      const value = normalizeLink(rawValue);
      if (value) out.link = value;
      else {
        warnings.push(`Invalid link filter: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }
    if (key === "before") {
      const value = parseDateMs(rawValue);
      if (value !== null) out.before = value;
      else {
        warnings.push(`Invalid before date: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }
    if (key === "after") {
      const value = parseDateMs(rawValue);
      if (value !== null) out.after = value;
      else {
        warnings.push(`Invalid after date: ${rawValue}`);
        terms.push(token);
      }
      continue;
    }
  }
  if (out.before && out.after && out.before < out.after) {
    warnings.push("before date is earlier than after date; date filters ignored");
    delete out.before;
    delete out.after;
  }
  if (!out.warnings?.length) delete out.warnings;
  return out;
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
  const matches = queryTerms.filter((t) => hay.includes(t.toLowerCase()));
  const coverage = matches.length / queryTerms.length;
  const phrase = hay.includes(queryTerms.join(" ").toLowerCase()) ? 0.5 : 0;
  return coverage + phrase;
}
function freshnessScore(mtime) {
  if (!mtime) return 0;
  const ageDays = (Date.now() - mtime) / (1e3 * 60 * 60 * 24);
  return 1 / (1 + Math.max(0, ageDays));
}
function passesQueryConstraints(doc, metadata, q) {
  if (q.folder && !doc.path.toLowerCase().startsWith(q.folder.toLowerCase())) return false;
  if (q.tag && !metadata.tags.includes(q.tag.toLowerCase())) return false;
  if (q.link) {
    const needle = q.link.toLowerCase();
    const has = metadata.links.some((l) => l.toLowerCase() === needle || l.toLowerCase() === `${needle}.md`);
    if (!has) return false;
  }
  if (q.before && doc.mtime && doc.mtime > q.before) return false;
  if (q.after && doc.mtime && doc.mtime < q.after) return false;
  return true;
}
function metadataBoost(doc, metadata, q) {
  let boost = 0;
  if (q.folder && doc.path.toLowerCase().startsWith(q.folder.toLowerCase())) boost += 0.18;
  if (q.tag && metadata.tags.includes(q.tag.toLowerCase())) boost += 0.2;
  if (q.link) {
    const needle = q.link.toLowerCase();
    if (metadata.links.some((l) => l.toLowerCase() === needle || l.toLowerCase() === `${needle}.md`)) boost += 0.2;
  }
  if (q.terms.length && metadata.headings.some((h) => q.terms.some((t) => h.toLowerCase().includes(t.toLowerCase())))) {
    boost += 0.08;
  }
  return boost;
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

// src/chunker.ts
function normalizeHeading(line) {
  return line.replace(/^#{1,6}\s+/, "").trim() || "(untitled section)";
}
function chunkMarkdownByHeading(path, markdown, maxChars = 1200) {
  const lines = markdown.split(/\r?\n/);
  const chunks = [];
  let currentHeading = "Document";
  let buffer = [];
  let order = 0;
  const flush = () => {
    if (!buffer.length) return;
    const raw = buffer.join("\n").trim();
    buffer = [];
    if (!raw) return;
    if (raw.length <= maxChars) {
      chunks.push({
        chunkId: `${path}#${order++}`,
        path,
        heading: currentHeading,
        text: raw,
        order
      });
      return;
    }
    for (let i = 0; i < raw.length; i += maxChars) {
      chunks.push({
        chunkId: `${path}#${order++}`,
        path,
        heading: currentHeading,
        text: raw.slice(i, i + maxChars),
        order
      });
    }
  };
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      currentHeading = normalizeHeading(line);
      continue;
    }
    buffer.push(line);
  }
  flush();
  if (!chunks.length) {
    chunks.push({ chunkId: `${path}#0`, path, heading: "Document", text: markdown.slice(0, maxChars), order: 0 });
  }
  return chunks;
}

// src/retrieval-context.ts
function formatChunkContent(path, heading, text) {
  return [path, heading, text].join("\n");
}
function formatChunkPreview(heading, text) {
  return [`# ${heading}`, text].join("\n");
}
function mergeChunkResultsToFullNotes(results, sectionsPerNote = 2) {
  const grouped = /* @__PURE__ */ new Map();
  for (const result of results) {
    const items = grouped.get(result.path) ?? [];
    items.push(result);
    grouped.set(result.path, items);
  }
  const merged = [];
  for (const [path, chunks] of grouped.entries()) {
    const ranked = [...chunks].sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const sectionContext = ranked.slice(0, sectionsPerNote).map((chunk, i) => `## Relevant Section ${i + 1}
${chunk.content}`).join("\n\n");
    const fullNote = top.metadata.fullContent ?? top.content;
    merged.push({
      ...top,
      content: `${sectionContext}

## Full Note (${path})
${fullNote}`
    });
  }
  return merged.sort((a, b) => b.score - a.score);
}

// src/reranker.ts
var HeuristicReranker = class {
  async rerank(query, candidates) {
    const q = query.toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    return [...candidates].map((c) => {
      const t = c.text.toLowerCase();
      const termHits = terms.reduce((acc, term) => t.includes(term) ? acc + 1 : acc, 0);
      const phraseBonus = t.includes(q) ? 0.5 : 0;
      const headingBonus = /(^|\n)#{1,6}\s/.test(c.text) ? 0.1 : 0;
      return { ...c, score: c.score + termHits * 0.08 + phraseBonus + headingBonus };
    }).sort((a, b) => b.score - a.score);
  }
};
var OpenAIReranker = class {
  constructor(settings) {
    this.settings = settings;
  }
  async rerank(query, candidates) {
    if (!this.settings.openaiApiKey) throw new Error("Missing OpenAI API key");
    const compact = candidates.map((c, i) => ({ idx: i, id: c.id, text: c.text.slice(0, 2500) }));
    const prompt = [
      "Rank candidate passages by relevance to the user query.",
      "Return strict JSON only in this format:",
      '{"ranked":[{"idx":number,"relevance":number}]}',
      "Relevance must be 0..1.",
      `Query: ${query}`,
      `Candidates: ${JSON.stringify(compact)}`
    ].join("\n\n");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.openaiApiKey}`
      },
      body: JSON.stringify({
        model: this.settings.rerankerModel || "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a precise ranking engine." },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!res.ok) {
      throw new Error(`OpenAI rerank failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Reranker returned invalid JSON: ${content.slice(0, 200)}`);
    }
    const scored = [...candidates];
    for (const r of parsed.ranked ?? []) {
      if (r.idx >= 0 && r.idx < scored.length) {
        scored[r.idx] = { ...scored[r.idx], score: scored[r.idx].score + Math.max(0, Math.min(1, r.relevance)) };
      }
    }
    return scored.sort((a, b) => b.score - a.score);
  }
};
function createReranker(settings) {
  if (settings.rerankerType === "openai") return new OpenAIReranker(settings);
  return new HeuristicReranker();
}

// src/retrieval-orchestrator.ts
var RetrievalOrchestrator = class {
  constructor(deps) {
    this.deps = deps;
  }
  async getRelevantNotes(query, maxResults) {
    const notes = await this.deps.getAllNotes();
    const settings = this.deps.getSettings();
    const constraints = parseQueryConstraints(query);
    const pre = notes.map((n) => {
      const metadata = extractMetadata(n.content);
      if (!passesQueryConstraints(n, metadata, constraints)) {
        return { n, lex: 0, fresh: 0, metaBoost: 0, metadata, preScore: -1 };
      }
      const lex = lexicalScore(n, constraints.terms);
      const fresh = freshnessScore(n.mtime);
      const metaBoost = metadataBoost(n, metadata, constraints);
      return { n, lex, fresh, metaBoost, metadata, preScore: lex + 0.25 * fresh + metaBoost };
    }).filter((x) => x.preScore >= 0).sort((a, b) => b.preScore - a.preScore).slice(0, Math.max(maxResults, settings.preselectCandidateCount));
    const vectorIndex = this.deps.getVectorIndex();
    const queryVec = await vectorIndex.getOrCreate("__query__", "__query__", query, settings.embeddingModel);
    const ranked = [];
    for (const c of pre) {
      const chunks = chunkMarkdownByHeading(c.n.path, c.n.content, settings.retrievalChunkSize);
      for (const ch of chunks) {
        const chunkContent = formatChunkContent(c.n.path, ch.heading, ch.text);
        const docVec = await vectorIndex.getOrCreate(
          ch.chunkId,
          c.n.path,
          chunkContent,
          settings.embeddingModel,
          c.n.mtime
        );
        const sem = cosine(docVec, queryVec);
        const score = settings.retrievalLexicalWeight * c.lex + settings.retrievalSemanticWeight * sem + settings.retrievalFreshnessWeight * c.fresh + c.metaBoost;
        ranked.push({
          path: c.n.path,
          content: formatChunkPreview(ch.heading, ch.text),
          mtime: c.n.mtime,
          score,
          lexicalScore: c.lex,
          semanticScore: sem,
          freshnessScore: c.fresh,
          graphBoost: c.metaBoost,
          metadata: { ...c.metadata, fullContent: c.n.content }
        });
      }
    }
    let final = applyGraphBoost(ranked, Math.max(maxResults, settings.rerankerTopK), settings.retrievalGraphExpandHops).sort((a, b) => b.score - a.score).slice(0, Math.max(maxResults, settings.rerankerTopK));
    if (settings.rerankerEnabled) {
      let reranker = createReranker(settings);
      let reranked;
      try {
        reranked = await reranker.rerank(
          query,
          final.slice(0, settings.rerankerTopK).map((x, i) => ({ id: `${i}:${x.path}`, text: `${x.path}
${x.content}`, score: x.score }))
        );
      } catch (err) {
        console.warn("AI Copilot: reranker failed, falling back to heuristic:", err);
        reranker = new HeuristicReranker();
        reranked = await reranker.rerank(
          query,
          final.slice(0, settings.rerankerTopK).map((x, i) => ({ id: `${i}:${x.path}`, text: `${x.path}
${x.content}`, score: x.score }))
        );
      }
      const map = new Map(final.map((x) => [`${x.path}
${x.content}`, x]));
      final = reranked.map((r) => map.get(r.text)).filter((x) => Boolean(x)).concat(final).slice(0, maxResults);
    } else {
      final = final.slice(0, maxResults);
    }
    return mergeChunkResultsToFullNotes(final).slice(0, maxResults);
  }
};

// src/bedrock-signing.ts
async function signBedrockRequest(method, url, body, timestamp, region, accessKey, secretKey) {
  const service = "bedrock";
  const dateStamp = timestamp.slice(0, 8);
  const enc = new TextEncoder();
  async function hmac(key, data) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key instanceof ArrayBuffer ? new Uint8Array(key) : key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  }
  async function sha256(data) {
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(data));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const payloadHash = await sha256(body);
  const host = url.hostname;
  const canonicalUri = "/" + url.pathname.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const canonicalQuerystring = "";
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalHeaders = `content-type:application/json
host:${host}
x-amz-date:${timestamp}
`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    await sha256(canonicalRequest)
  ].join("\n");
  const kDate = await hmac(enc.encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signatureBuffer = await hmac(kSigning, stringToSign);
  const signature = [...new Uint8Array(signatureBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    "Content-Type": "application/json",
    "X-Amz-Date": timestamp,
    Authorization: authorization
  };
}

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
var BedrockEmbeddingProvider = class {
  constructor(settings) {
    this.settings = settings;
  }
  async embed(text, model) {
    if (!this.settings.bedrockAccessKeyId || !this.settings.bedrockSecretAccessKey) {
      throw new Error("AWS Bedrock credentials missing for embedding");
    }
    const region = this.settings.bedrockRegion;
    const body = JSON.stringify({
      inputText: text.slice(0, 2e4),
      dimensions: 1024,
      normalize: true
    });
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const encodedPath = `/model/${encodeURIComponent(model)}/invoke`;
    const url = new URL(`https://${host}${encodedPath}`);
    const now = /* @__PURE__ */ new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const headers = await signBedrockRequest(
      "POST",
      url,
      body,
      timestamp,
      region,
      this.settings.bedrockAccessKeyId,
      this.settings.bedrockSecretAccessKey
    );
    const res = await fetch(`https://${host}${encodedPath}`, {
      method: "POST",
      headers,
      body
    });
    if (!res.ok) throw new Error(`Bedrock embedding request failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    return json.embedding ?? [];
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

// src/indexing-queue.ts
var BackgroundIndexingQueue = class {
  constructor() {
    this.queue = [];
    this.running = false;
    this.processed = 0;
    this.failed = 0;
  }
  enqueue(job) {
    this.queue.push(job);
    void this.drain();
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      if (!job) break;
      try {
        await job();
        this.processed += 1;
      } catch (err) {
        this.failed += 1;
        this.lastError = err instanceof Error ? err.message : String(err);
      } finally {
        this.lastRunAt = Date.now();
      }
    }
    this.running = false;
  }
  stats() {
    return {
      pending: this.queue.length,
      running: this.running,
      processed: this.processed,
      failed: this.failed,
      lastError: this.lastError,
      lastRunAt: this.lastRunAt
    };
  }
};

// src/indexing-sync.ts
function toIndexedChunks(note, chunkSize) {
  return chunkMarkdownByHeading(note.path, note.content, chunkSize).map((chunk) => ({
    id: chunk.chunkId,
    path: chunk.path,
    content: formatChunkContent(chunk.path, chunk.heading, chunk.text),
    mtime: note.mtime
  }));
}
async function syncIndexedNote(index, note, model, chunkSize) {
  const chunks = toIndexedChunks(note, chunkSize);
  return index.indexChunks(chunks, model);
}
async function removeIndexedNote(index, path) {
  await index.removePath(path);
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
  normalizeLoadedData(loaded) {
    if (loaded.version === 2 && loaded.records) {
      return { version: 2, records: loaded.records };
    }
    return { version: 2, records: loaded.records ?? {} };
  }
  async ensureLoaded() {
    if (!this.cache) {
      const loaded = await this.storage.load();
      this.cache = this.normalizeLoadedData(loaded);
    }
  }
  async getOrCreate(id, path, content, model, mtime) {
    await this.ensureLoaded();
    if (!this.cache) throw new Error("Vector cache failed to initialize");
    const hash = contentHash(content);
    const rec = this.cache.records[id];
    if (rec && rec.contentHash === hash && rec.model === model) return rec.vector;
    const vector = await this.provider.embed(content, model);
    this.cache.records[id] = {
      id,
      path,
      chunkId: id.includes("#") ? id : void 0,
      contentHash: hash,
      model,
      vector,
      updatedAt: Date.now(),
      mtime,
      textPreview: content.slice(0, 180)
    };
    await this.storage.save(this.cache);
    return vector;
  }
  async indexChunks(chunks, model) {
    await this.ensureLoaded();
    for (const c of chunks) {
      await this.getOrCreate(c.id, c.path, c.content, model, c.mtime);
    }
    return chunks.length;
  }
  async removePath(path) {
    await this.ensureLoaded();
    if (!this.cache) throw new Error("Vector cache failed to initialize");
    for (const key of Object.keys(this.cache.records)) {
      if (this.cache.records[key].path === path) delete this.cache.records[key];
    }
    await this.storage.save(this.cache);
  }
  async rebuild(chunks, model) {
    this.cache = { version: 2, embeddingProvider: this.cache?.embeddingProvider, records: {} };
    await this.storage.save(this.cache);
    return this.indexChunks(chunks, model);
  }
  async getStoredProvider() {
    await this.ensureLoaded();
    return this.cache?.embeddingProvider;
  }
  async setProvider(provider) {
    await this.ensureLoaded();
    if (!this.cache) throw new Error("Vector cache failed to initialize");
    this.cache.embeddingProvider = provider;
    await this.storage.save(this.cache);
  }
};

// src/vault-vector-storage.ts
var INDEX_PATH = "AI Copilot/.index/vectors.json";
function getParsedRecords(value) {
  if (!value || typeof value !== "object") return null;
  const maybe = value;
  if (!maybe.records || typeof maybe.records !== "object") return null;
  return maybe.records;
}
var VaultVectorStorage = class {
  constructor(vault) {
    this.vault = vault;
  }
  async load() {
    if (!this.vault.exists(INDEX_PATH)) return { version: 2, records: {} };
    const text = await this.vault.read(INDEX_PATH);
    try {
      const parsed = JSON.parse(text);
      const records = getParsedRecords(parsed);
      if (records) {
        return { version: 2, records };
      }
      return { version: 2, records: {} };
    } catch {
      return { version: 2, records: {} };
    }
  }
  async save(data) {
    if (!this.vault.exists("AI Copilot")) await this.vault.createFolder("AI Copilot");
    if (!this.vault.exists("AI Copilot/.index")) await this.vault.createFolder("AI Copilot/.index");
    const content = JSON.stringify(data);
    if (this.vault.exists(INDEX_PATH)) await this.vault.modify(INDEX_PATH, content);
    else await this.vault.create(INDEX_PATH, content);
  }
};

// src/indexing-orchestrator.ts
var IndexingOrchestrator = class {
  constructor(vault, getSettings) {
    this.vault = vault;
    this.getSettings = getSettings;
    this.vectorIndex = null;
    this.queue = new BackgroundIndexingQueue();
  }
  initializeVectorIndex() {
    const settings = this.getSettings();
    const provider = this.buildEmbeddingProvider(settings);
    this.vectorIndex = new PersistentVectorIndex(new VaultVectorStorage(this.vault), provider);
  }
  buildEmbeddingProvider(settings) {
    switch (settings.embeddingProvider) {
      case "openai":
        return new OpenAIEmbeddingProvider(settings);
      case "bedrock":
        return new BedrockEmbeddingProvider(settings);
      default:
        return new FallbackHashEmbeddingProvider();
    }
  }
  getVectorIndex() {
    if (!this.vectorIndex) this.initializeVectorIndex();
    return this.vectorIndex;
  }
  async getAllNotes() {
    const files = this.vault.listMarkdownFiles();
    return Promise.all(
      files.map(async (f) => ({ path: f.path, content: await this.vault.read(f.path), mtime: f.mtime }))
    );
  }
  async getRecentNotes(lookbackDays) {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1e3;
    const files = this.vault.listMarkdownFiles().filter((f) => f.mtime >= cutoff);
    return Promise.all(files.map(async (f) => ({ path: f.path, content: await this.vault.read(f.path) })));
  }
  async rebuildPersistentIndex() {
    const settings = this.getSettings();
    const idx = this.getVectorIndex();
    const notes = await this.getAllNotes();
    const model = this.activeEmbeddingModel(settings);
    const count = await idx.rebuild(
      notes.map((n) => ({
        id: `${n.path}#full`,
        path: n.path,
        content: `${n.path}
${n.content}`,
        mtime: n.mtime
      })),
      model
    );
    await idx.setProvider(settings.embeddingProvider);
    return count;
  }
  /** Returns the active embedding model name based on provider selection. */
  activeEmbeddingModel(settings) {
    return settings.embeddingProvider === "bedrock" ? settings.bedrockEmbeddingModel : settings.embeddingModel;
  }
  /** Check if the embedding provider has changed since last index build. */
  async needsProviderRebuild() {
    const idx = this.getVectorIndex();
    const stored = await idx.getStoredProvider();
    return stored !== void 0 && stored !== this.getSettings().embeddingProvider;
  }
  registerVaultSyncEvents(registerEvent) {
    registerEvent(
      this.vault.on("modify", async (file) => {
        if (!file.path.endsWith(".md")) return;
        this.queue.enqueue(async () => {
          const content = await this.vault.read(file.path);
          const settings = this.getSettings();
          await syncIndexedNote(
            this.getVectorIndex(),
            { path: file.path, content, mtime: file.mtime },
            this.activeEmbeddingModel(settings),
            settings.retrievalChunkSize
          );
        });
      })
    );
    registerEvent(
      this.vault.on("delete", async (file) => {
        if (!file.path.endsWith(".md")) return;
        this.queue.enqueue(async () => {
          await removeIndexedNote(this.getVectorIndex(), file.path);
        });
      })
    );
  }
};

// src/chat-orchestrator.ts
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
    if (!this.settings.allowRemoteModels) {
      throw new Error("Remote model calls are disabled in settings");
    }
    if (!this.settings.openaiApiKey) {
      throw new Error("OpenAI API key missing in plugin settings");
    }
    const boundedPrompt = prompt.slice(0, this.settings.maxPromptChars);
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
          { role: "user", content: boundedPrompt }
        ]
      })
    });
    if (!response.ok) {
      const detail = redactSensitive(await response.text());
      throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
    }
    const json = await response.json();
    return json.choices?.[0]?.message?.content?.trim() || "";
  }
};
var AnthropicClient = class {
  constructor(settings) {
    this.settings = settings;
  }
  async chat(prompt, system = "You are a helpful note assistant.") {
    if (!this.settings.allowRemoteModels) {
      throw new Error("Remote model calls are disabled in settings");
    }
    if (!this.settings.anthropicApiKey) {
      throw new Error("Anthropic API key missing in plugin settings");
    }
    const boundedPrompt = prompt.slice(0, this.settings.maxPromptChars);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.settings.anthropicApiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.settings.anthropicModel,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: boundedPrompt }]
      })
    });
    if (!response.ok) {
      const detail = redactSensitive(await response.text());
      throw new Error(`Anthropic request failed: ${response.status} ${detail}`);
    }
    const json = await response.json();
    return json.content?.find((b) => b.type === "text")?.text?.trim() || "";
  }
  async chatMessages(messages, system, tools, maxTokens) {
    if (!this.settings.allowRemoteModels) {
      throw new Error("Remote model calls are disabled in settings");
    }
    if (!this.settings.anthropicApiKey) {
      throw new Error("Anthropic API key missing in plugin settings");
    }
    const body = {
      model: this.settings.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages
    };
    if (tools.length > 0) {
      body.tools = tools;
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.settings.anthropicApiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = redactSensitive(await response.text());
      throw new Error(`Anthropic request failed: ${response.status} ${detail}`);
    }
    const json = await response.json();
    return {
      content: json.content ?? [],
      stop_reason: json.stop_reason ?? "end_turn"
    };
  }
};
var BedrockClient = class {
  constructor(settings) {
    this.settings = settings;
  }
  async chat(prompt, system = "You are a helpful note assistant.") {
    if (!this.settings.allowRemoteModels) {
      throw new Error("Remote model calls are disabled in settings");
    }
    if (!this.settings.bedrockAccessKeyId || !this.settings.bedrockSecretAccessKey) {
      throw new Error("AWS Bedrock credentials missing in plugin settings");
    }
    const boundedPrompt = prompt.slice(0, this.settings.maxPromptChars);
    const region = this.settings.bedrockRegion;
    const model = this.settings.bedrockModel;
    const body = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: boundedPrompt }]
    });
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const encodedPath = `/model/${encodeURIComponent(model)}/invoke`;
    const url = new URL(`https://${host}${encodedPath}`);
    const now = /* @__PURE__ */ new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const headers = await signBedrockRequest(
      "POST",
      url,
      body,
      timestamp,
      region,
      this.settings.bedrockAccessKeyId,
      this.settings.bedrockSecretAccessKey
    );
    const response = await fetch(`https://${host}${encodedPath}`, {
      method: "POST",
      headers,
      body
    });
    if (!response.ok) {
      const detail = redactSensitive(await response.text());
      throw new Error(`Bedrock request failed: ${response.status} ${detail}`);
    }
    const json = await response.json();
    return json.content?.find((b) => b.type === "text")?.text?.trim() || "";
  }
  async chatMessages(messages, system, tools, maxTokens) {
    if (!this.settings.allowRemoteModels) {
      throw new Error("Remote model calls are disabled in settings");
    }
    if (!this.settings.bedrockAccessKeyId || !this.settings.bedrockSecretAccessKey) {
      throw new Error("AWS Bedrock credentials missing in plugin settings");
    }
    const region = this.settings.bedrockRegion;
    const model = this.settings.bedrockModel;
    const requestBody = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: maxTokens,
      system,
      messages
    };
    if (tools.length > 0) {
      requestBody.tools = tools;
    }
    const body = JSON.stringify(requestBody);
    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const encodedPath = `/model/${encodeURIComponent(model)}/invoke`;
    const url = new URL(`https://${host}${encodedPath}`);
    const now = /* @__PURE__ */ new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const headers = await signBedrockRequest(
      "POST",
      url,
      body,
      timestamp,
      region,
      this.settings.bedrockAccessKeyId,
      this.settings.bedrockSecretAccessKey
    );
    const response = await fetch(`https://${host}${encodedPath}`, {
      method: "POST",
      headers,
      body
    });
    if (!response.ok) {
      const detail = redactSensitive(await response.text());
      throw new Error(`Bedrock request failed: ${response.status} ${detail}`);
    }
    const json = await response.json();
    return {
      content: json.content ?? [],
      stop_reason: json.stop_reason ?? "end_turn"
    };
  }
};
function buildClient(settings) {
  if (!settings.allowRemoteModels) return new DryRunClient();
  switch (settings.provider) {
    case "openai":
      return new OpenAIClient(settings);
    case "anthropic":
      return new AnthropicClient(settings);
    case "bedrock":
      return new BedrockClient(settings);
    default:
      return new DryRunClient();
  }
}
function buildAgentClient(settings) {
  if (!settings.allowRemoteModels) return null;
  switch (settings.provider) {
    case "anthropic":
      return new AnthropicClient(settings);
    case "bedrock":
      return new BedrockClient(settings);
    default:
      return null;
  }
}

// src/chat.ts
var import_obsidian2 = require("obsidian");
var AI_COPILOT_VIEW = "ai-copilot-chat-view";
var TOOL_LABELS = {
  search_notes: "Searching vault...",
  read_note: "Reading note...",
  list_notes: "Listing notes..."
};
var AICopilotChatView = class extends import_obsidian2.ItemView {
  constructor(leaf) {
    super(leaf);
    this.messages = [];
    this.onSubmit = null;
    this.toolProgressEl = null;
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
  showToolProgress(toolName) {
    if (!this.toolProgressEl) return;
    const label = TOOL_LABELS[toolName] ?? `Running ${toolName}...`;
    this.toolProgressEl.setText(label);
    this.toolProgressEl.style.display = "block";
  }
  clearToolProgress() {
    if (!this.toolProgressEl) return;
    this.toolProgressEl.style.display = "none";
    this.toolProgressEl.setText("");
  }
  async onOpen() {
    this.render();
  }
  async openCitation(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && "path" in file) {
      await this.app.workspace.getLeaf(true).openFile(file);
      return;
    }
    new import_obsidian2.Notice(`AI Copilot: source not found (${path})`);
  }
  render() {
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
    this.toolProgressEl = root.createDiv({ cls: "ai-copilot-tool-progress" });
    this.toolProgressEl.style.display = "none";
    this.toolProgressEl.style.padding = "4px 8px";
    this.toolProgressEl.style.fontStyle = "italic";
    this.toolProgressEl.style.opacity = "0.7";
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
};
async function upsertChatOutput(vault, text) {
  const path = "AI Copilot/Chat Output.md";
  if (!vault.exists(path)) {
    if (!vault.exists("AI Copilot")) {
      await vault.createFolder("AI Copilot");
    }
    await vault.create(path, "# Chat Output\n");
  }
  await vault.append(path, `

---
${(/* @__PURE__ */ new Date()).toISOString()}
${text}
`);
}

// src/agent-tools.ts
var AGENT_TOOLS = [
  {
    name: "search_notes",
    description: "Search the vault for notes relevant to a query. Returns note paths, scores, and content previews. Use this to find information across the vault.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant notes"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "read_note",
    description: "Read the full content of a specific note by its file path. Use this after search_notes to get the complete text of a relevant note.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path of the note to read (e.g. 'Projects/my-note.md')"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "list_notes",
    description: "List all markdown files in the vault. Returns file paths and modification times. Optionally filter by folder prefix.",
    input_schema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Optional folder prefix to filter results (e.g. 'Projects/')"
        }
      }
    }
  }
];
async function executeTool(name, input, ctx) {
  switch (name) {
    case "search_notes":
      return executeSearchNotes(input, ctx);
    case "read_note":
      return executeReadNote(input, ctx);
    case "list_notes":
      return executeListNotes(input, ctx);
    default:
      return { content: `Unknown tool: ${name}`, is_error: true };
  }
}
async function executeSearchNotes(input, ctx) {
  const query = String(input.query ?? "");
  if (!query) return { content: "Error: query is required", is_error: true };
  const results = await ctx.searchNotes(query, ctx.maxSearchResults);
  if (results.length === 0) {
    return { content: "No matching notes found." };
  }
  const formatted = results.map((n) => {
    const preview = n.content.slice(0, 500).replace(/\n{3,}/g, "\n\n");
    return `### ${n.path} (score: ${n.score.toFixed(2)})
${preview}`;
  });
  return { content: formatted.join("\n\n---\n\n") };
}
async function executeReadNote(input, ctx) {
  const path = String(input.path ?? "");
  if (!path) return { content: "Error: path is required", is_error: true };
  if (!ctx.vault.exists(path)) {
    return { content: `Note not found: ${path}`, is_error: true };
  }
  const content = await ctx.vault.read(path);
  return { content };
}
async function executeListNotes(input, ctx) {
  const folder = input.folder ? String(input.folder) : void 0;
  let files = ctx.vault.listMarkdownFiles();
  if (folder) {
    files = files.filter((f) => f.path.startsWith(folder));
  }
  if (files.length === 0) {
    return { content: folder ? `No notes found in folder: ${folder}` : "No notes in vault." };
  }
  const lines = files.sort((a, b) => b.mtime - a.mtime).slice(0, 100).map((f) => `- ${f.path} (modified: ${new Date(f.mtime).toISOString().slice(0, 10)})`);
  if (files.length > 100) {
    lines.push(`
... and ${files.length - 100} more files`);
  }
  return { content: lines.join("\n") };
}

// src/agent-loop.ts
var AGENT_SYSTEM_PROMPT = "You are an AI assistant integrated into an Obsidian vault. You help users understand, search, and navigate their notes.\n\nYou have tools to search, read, and list notes in the vault. Use them to find relevant information before answering. Always ground your answers in the actual note content.\n\nWhen citing information, mention the note path so the user can find it. If you cannot find relevant information in the vault, say so honestly.\n\nBe concise and helpful. Focus on answering the user's question using vault content.";
async function runAgentLoop(client, query, toolCtx, settings, callbacks) {
  const maxToolCalls = settings.agentMaxToolCalls;
  const messages = [{ role: "user", content: query }];
  const citedPaths = /* @__PURE__ */ new Map();
  let toolCallCount = 0;
  for (let i = 0; i < maxToolCalls + 1; i++) {
    const response = await client.chatMessages(
      messages,
      AGENT_SYSTEM_PROMPT,
      AGENT_TOOLS,
      4096
    );
    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const text2 = extractText(response.content);
      callbacks?.onText?.(text2);
      return {
        text: text2,
        citations: buildCitations(citedPaths),
        toolCallCount
      };
    }
    if (response.stop_reason !== "tool_use") {
      const text2 = extractText(response.content);
      callbacks?.onText?.(text2);
      return { text: text2, citations: buildCitations(citedPaths), toolCallCount };
    }
    messages.push({ role: "assistant", content: response.content });
    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use" && !!b.id && !!b.name
    );
    const resultBlocks = [];
    for (const block of toolUseBlocks) {
      toolCallCount++;
      callbacks?.onToolCall?.(block.name, block.input);
      const result = await executeTool(block.name, block.input, toolCtx);
      callbacks?.onToolResult?.(block.name, result);
      trackCitations(block.name, block.input, citedPaths);
      resultBlocks.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.is_error
      });
    }
    messages.push({ role: "user", content: resultBlocks });
  }
  const finalResponse = await client.chatMessages(
    messages,
    AGENT_SYSTEM_PROMPT,
    AGENT_TOOLS,
    4096
  );
  const text = extractText(finalResponse.content);
  callbacks?.onText?.(text);
  return { text, citations: buildCitations(citedPaths), toolCallCount };
}
function extractText(content) {
  return content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");
}
function trackCitations(toolName, input, citedPaths) {
  if (toolName === "read_note" && typeof input.path === "string") {
    const current = citedPaths.get(input.path) ?? 0;
    citedPaths.set(input.path, current + 1);
  }
}
function buildCitations(citedPaths) {
  return [...citedPaths.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => ({ path }));
}

// src/chat-orchestrator.ts
var ChatOrchestrator = class {
  constructor(app, vault, getSettings, getRelevantNotes, writeAssistantOutput) {
    this.app = app;
    this.vault = vault;
    this.getSettings = getSettings;
    this.getRelevantNotes = getRelevantNotes;
    this.writeAssistantOutput = writeAssistantOutput;
  }
  registerView(registerView) {
    registerView(AI_COPILOT_VIEW, (leaf) => new AICopilotChatView(leaf));
  }
  buildToolContext(settings) {
    return {
      vault: this.vault,
      searchNotes: (query, maxResults) => this.getRelevantNotes(query, maxResults),
      maxSearchResults: settings.chatMaxResults
    };
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
            `## Query
${query}

## Response
${result.text}`
          );
          return {
            role: "assistant",
            text: result.text,
            citations: result.citations
          };
        }
        const related = await this.getRelevantNotes(query, settings.chatMaxResults);
        const context = related.map((n) => `### ${n.path}
${n.content.slice(0, 1200)}`).join("\n\n");
        const prompt = `Question: ${query}

Use these notes:

${context}`;
        const output = await buildClient(settings).chat(prompt, "Answer using only note evidence.");
        await upsertChatOutput(this.vault, `## Query
${query}

## Response
${output}`);
        return {
          role: "assistant",
          text: output,
          citations: related.map((n) => ({ path: n.path, score: n.score })).slice(0, 5)
        };
      });
    }
  }
  async chatActiveNote(file) {
    const content = await this.vault.read(file.path);
    const settings = this.getSettings();
    const related = await this.getRelevantNotes(file.basename, settings.chatMaxResults);
    const prompt = [
      `ACTIVE NOTE (${file.path}):`,
      content,
      "\nRELATED CONTEXT:",
      ...related.map((n) => `- ${n.path} (score ${n.score.toFixed(2)})
${n.content.slice(0, 500)}`),
      "\nTask: summarize note, suggest improvements, and list TODOs."
    ].join("\n\n");
    const output = await buildClient(settings).chat(prompt, "You are an Obsidian assistant.");
    await this.writeAssistantOutput("Chat Output", output);
    new import_obsidian3.Notice("AI Copilot: chat output saved to AI Copilot/Chat Output.md");
  }
  async chatQuery(query) {
    const settings = this.getSettings();
    const agentClient = buildAgentClient(settings);
    if (agentClient) {
      const toolCtx = this.buildToolContext(settings);
      const result = await runAgentLoop(agentClient, query, toolCtx, settings);
      await upsertChatOutput(
        this.vault,
        `## Query
${query}

## Response
${result.text}`
      );
      new import_obsidian3.Notice("AI Copilot: query response saved.");
      return;
    }
    const related = await this.getRelevantNotes(query, settings.chatMaxResults);
    const context = related.map((n) => `### ${n.path}
${n.content.slice(0, 1200)}`).join("\n\n");
    const prompt = `Question: ${query}

Use these notes:

${context}`;
    const output = await buildClient(settings).chat(prompt, "Answer using only note evidence.");
    await upsertChatOutput(this.vault, `## Query
${query}

## Response
${output}`);
    new import_obsidian3.Notice("AI Copilot: query response saved.");
  }
};

// src/command-registration.ts
var import_obsidian4 = require("obsidian");

// src/refinement.ts
function extractTodos(markdown) {
  const lines = markdown.split(/\r?\n/);
  return lines.filter((l) => /^\s*[-*]\s+\[\s\]\s+/i.test(l) || /^\s*TODO[:\s]/i.test(l)).map((l) => l.trim());
}
function detectDuplicateTitleClusters(notes) {
  const groups = /* @__PURE__ */ new Map();
  for (const n of notes) {
    const parts = n.path.split("/");
    const leaf = parts.length ? parts[parts.length - 1] : n.path;
    const base = leaf.replace(/\.md$/i, "").toLowerCase();
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

// src/patch-plan-parser.ts
function extractJsonBlocks(text) {
  const blocks = [];
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = fenced.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  if (blocks.length === 0) {
    const bare = /(?:^|\n)\s*(\{[\s\S]*?\})\s*(?:\n|$)/g;
    while ((match = bare.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }
    const bareArr = /(?:^|\n)\s*(\[[\s\S]*?\])\s*(?:\n|$)/g;
    while ((match = bareArr.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }
  }
  return blocks;
}
function isPatchPlanShape(obj) {
  if (!obj || typeof obj !== "object") return false;
  const o = obj;
  return typeof o.path === "string" && Array.isArray(o.edits);
}
function isMultiFilePatchPlanShape(obj) {
  if (!obj || typeof obj !== "object") return false;
  const o = obj;
  return Array.isArray(o.files) && o.files.every(
    (f) => isPatchPlanShape(f)
  );
}
function normalizeEdit(raw, index) {
  const find = typeof raw.find === "string" ? raw.find : "";
  const replace = typeof raw.replace === "string" ? raw.replace : "";
  const reason = typeof raw.reason === "string" ? raw.reason : `edit ${index + 1}`;
  const replaceAll = raw.replaceAll === true;
  if (!find) {
    return { edit: { find, replace, reason, replaceAll }, error: `edit ${index + 1}: missing find string` };
  }
  const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : void 0;
  const risk = raw.risk === "safe" || raw.risk === "moderate" || raw.risk === "unsafe" ? raw.risk : void 0;
  return {
    edit: { find, replace, reason, replaceAll, confidence, risk }
  };
}
function parseSinglePlan(obj) {
  const errors = [];
  const path = typeof obj.path === "string" ? obj.path : "";
  const title = typeof obj.title === "string" ? obj.title : void 0;
  if (!path) errors.push("missing path field");
  const rawEdits = Array.isArray(obj.edits) ? obj.edits : [];
  if (rawEdits.length === 0) errors.push("no edits provided");
  const edits = [];
  for (let i = 0; i < rawEdits.length; i++) {
    const raw = rawEdits[i];
    if (!raw || typeof raw !== "object") {
      errors.push(`edit ${i + 1}: not an object`);
      continue;
    }
    const { edit, error } = normalizeEdit(raw, i);
    if (error) errors.push(error);
    else edits.push(edit);
  }
  return { plan: { path, title, edits }, errors };
}
function parseLLMPatchResponse(text) {
  const result = { plans: [], multiFilePlans: [], errors: [] };
  const blocks = extractJsonBlocks(text);
  if (blocks.length === 0) {
    result.errors.push("no JSON blocks found in LLM response");
    return result;
  }
  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block);
    } catch (e) {
      result.errors.push(`invalid JSON: ${e.message}`);
      continue;
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isPatchPlanShape(item)) {
          const { plan, errors } = parseSinglePlan(item);
          result.plans.push(plan);
          result.errors.push(...errors);
        }
      }
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      result.errors.push("JSON block is not an object or array");
      continue;
    }
    if (isMultiFilePatchPlanShape(parsed)) {
      const multi = parsed;
      const title = typeof multi.title === "string" ? multi.title : void 0;
      const files = [];
      for (const f of multi.files) {
        const { plan, errors } = parseSinglePlan(f);
        files.push(plan);
        result.errors.push(...errors);
      }
      result.multiFilePlans.push({ title, files });
      continue;
    }
    if (isPatchPlanShape(parsed)) {
      const { plan, errors } = parseSinglePlan(parsed);
      result.plans.push(plan);
      result.errors.push(...errors);
      continue;
    }
    result.errors.push("JSON block does not match PatchPlan or MultiFilePatchPlan shape");
  }
  return result;
}
function buildPatchPlanSystemPrompt() {
  return [
    "You are an Obsidian note refinement assistant that produces structured edits.",
    "For each note that needs changes, output a JSON patch plan inside a ```json code block.",
    "",
    "Single-file format:",
    "```json",
    "{",
    '  "path": "folder/note.md",',
    '  "title": "Brief description of changes",',
    '  "edits": [',
    "    {",
    '      "find": "exact text to find",',
    '      "replace": "replacement text",',
    '      "reason": "why this change",',
    '      "confidence": 0.95,',
    '      "risk": "safe"',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "Multi-file format:",
    "```json",
    "{",
    '  "title": "Bulk refinement",',
    '  "files": [',
    '    { "path": "note1.md", "edits": [...] },',
    '    { "path": "note2.md", "edits": [...] }',
    "  ]",
    "}",
    "```",
    "",
    "Rules:",
    "- find must be an exact substring of the note content (not a regex)",
    "- keep find strings short but unique enough to match exactly once",
    "- set replaceAll: true only when ALL occurrences should be replaced",
    "- confidence: 0.0-1.0 indicating how certain the edit is correct",
    '- risk: "safe" for formatting/typo fixes, "moderate" for content changes, "unsafe" for structural changes',
    "- Preserve the author's intent \u2014 suggest, don't rewrite",
    "- If no edits are needed for a note, omit it entirely"
  ].join("\n");
}

// src/smart-refinement.ts
init_patch_plan();
function buildRefinementPreview(llmOutput, fileContents, candidates, safetyConfig) {
  const parseResult = parseLLMPatchResponse(llmOutput);
  const todoCount = candidates.flatMap((c) => extractTodos(c.content)).length;
  const singleFilePreviews = parseResult.plans.map((plan) => {
    const content = fileContents.get(plan.path) ?? "";
    const preview = previewPatchPlan(content, plan, safetyConfig);
    const conflicts = content ? detectConflicts(content, plan.edits) : [];
    return { plan, preview, conflicts };
  });
  const multiFilePreviews = parseResult.multiFilePlans.map((plan) => {
    const filePreviews = plan.files.map((file) => {
      const content = fileContents.get(file.path) ?? "";
      const preview = previewPatchPlan(content, file, safetyConfig);
      const conflicts = content ? detectConflicts(content, file.edits) : [];
      return { path: file.path, preview, conflicts };
    });
    return { plan, filePreviews };
  });
  return { parseResult, singleFilePreviews, multiFilePreviews, todoCount, rawLLMOutput: llmOutput };
}
function applyRefinementDecision(preview, decision, fileContents, safetyConfig) {
  const snapshotMap = /* @__PURE__ */ new Map();
  const singleFileResults = [];
  const multiFileResults = [];
  if (decision.singleFileSelections) {
    for (const sel of decision.singleFileSelections) {
      const entry = preview.singleFilePreviews[sel.planIndex];
      if (!entry) continue;
      const content = fileContents.get(entry.plan.path);
      if (content === void 0) continue;
      snapshotMap.set(entry.plan.path, content);
      const applied = applyPatchPlan(content, entry.plan, {
        selectedIndices: sel.selectedEditIndices,
        safetyConfig
      });
      const conflicts = detectConflicts(content, entry.plan.edits);
      singleFileResults.push({
        path: entry.plan.path,
        applied,
        conflicts
      });
    }
  }
  if (decision.multiFileSelections) {
    for (const sel of decision.multiFileSelections) {
      const entry = preview.multiFilePreviews[sel.planIndex];
      if (!entry) continue;
      for (const file of entry.plan.files) {
        const content = fileContents.get(file.path);
        if (content !== void 0) snapshotMap.set(file.path, content);
      }
      const result = applyMultiFilePatchPlan(fileContents, entry.plan, {
        selectedEdits: sel.selectedEdits,
        safetyConfig
      });
      multiFileResults.push(result);
    }
  }
  const totalApplied = singleFileResults.filter((r) => r.applied.transactions.some((t) => t.applied)).length + multiFileResults.reduce((sum, r) => sum + r.results.filter((fr) => !fr.skipped).length, 0);
  const summary = `Smart refinement: ${totalApplied} file(s) modified`;
  return {
    result: { singleFileResults, multiFileResults, summary },
    snapshot: { snapshots: snapshotMap, appliedAt: Date.now() }
  };
}
function buildRollbackContents(snapshot) {
  return new Map(snapshot.snapshots);
}
function buildSafeAutoApplyDecision(preview) {
  const singleFileSelections = [];
  for (let i = 0; i < preview.singleFilePreviews.length; i++) {
    const entry = preview.singleFilePreviews[i];
    const conflictIndices = new Set(entry.conflicts.map((c) => c.editIndex));
    const safeIndices = [];
    for (let j = 0; j < entry.plan.edits.length; j++) {
      const edit = entry.plan.edits[j];
      const risk = edit.risk ?? "safe";
      const confidence = edit.confidence ?? 1;
      const isSafe = risk === "safe" && confidence >= 0.8 && !conflictIndices.has(j);
      const previewEdit = entry.preview.edits[j];
      const hasSafetyIssues = previewEdit?.safetyIssues?.length > 0;
      if (isSafe && !hasSafetyIssues) safeIndices.push(j);
    }
    if (safeIndices.length > 0) {
      singleFileSelections.push({ planIndex: i, selectedEditIndices: safeIndices });
    }
  }
  const multiFileSelections = [];
  for (let i = 0; i < preview.multiFilePreviews.length; i++) {
    const entry = preview.multiFilePreviews[i];
    const selectedEdits = /* @__PURE__ */ new Map();
    let hasAny = false;
    for (const fp of entry.filePreviews) {
      const conflictIndices = new Set(fp.conflicts.map((c) => c.editIndex));
      const fileInPlan = entry.plan.files.find((f) => f.path === fp.path);
      if (!fileInPlan) continue;
      const safeIndices = [];
      for (let j = 0; j < fileInPlan.edits.length; j++) {
        const edit = fileInPlan.edits[j];
        const risk = edit.risk ?? "safe";
        const confidence = edit.confidence ?? 1;
        const isSafe = risk === "safe" && confidence >= 0.8 && !conflictIndices.has(j);
        const hasSafetyIssues = fp.preview.edits[j]?.safetyIssues?.length > 0;
        if (isSafe && !hasSafetyIssues) safeIndices.push(j);
      }
      if (safeIndices.length > 0) {
        selectedEdits.set(fp.path, safeIndices);
        hasAny = true;
      }
    }
    if (hasAny) {
      multiFileSelections.push({ planIndex: i, selectedEdits });
    }
  }
  return { singleFileSelections, multiFileSelections };
}
function toMarkdownRefinementPreview(preview) {
  const lines = ["# Refinement Preview"];
  if (preview.parseResult.errors.length) {
    lines.push(`
## Parse Warnings`);
    for (const err of preview.parseResult.errors) {
      lines.push(`- ${err}`);
    }
  }
  lines.push(`
TODOs found: ${preview.todoCount}`);
  for (const entry of preview.singleFilePreviews) {
    lines.push("");
    lines.push(toMarkdownPatchPlanPreview(entry.preview));
    if (entry.conflicts.length) {
      lines.push(`
### Conflicts`);
      for (const c of entry.conflicts) {
        lines.push(`- Edit ${c.editIndex + 1} (${c.conflict}): ${c.detail}`);
      }
    }
  }
  for (const entry of preview.multiFilePreviews) {
    lines.push(`
## Multi-File Plan: ${entry.plan.title ?? "(untitled)"}`);
    for (const fp of entry.filePreviews) {
      lines.push("");
      lines.push(toMarkdownPatchPlanPreview(fp.preview));
      if (fp.conflicts.length) {
        lines.push(`
### Conflicts`);
        for (const c of fp.conflicts) {
          lines.push(`- Edit ${c.editIndex + 1} (${c.conflict}): ${c.detail}`);
        }
      }
    }
  }
  return lines.join("\n");
}

// src/command-registration.ts
function registerPluginCommands(ctx, chat, indexing) {
  ctx.addCommand({
    id: "ai-copilot-open-chat-panel",
    name: "AI Copilot: Open chat panel",
    callback: async () => {
      await chat.activateChatView();
    }
  });
  ctx.addCommand({
    id: "ai-copilot-chat-active-note",
    name: "AI Copilot: Chat about active note",
    callback: async () => {
      const file = ctx.app.workspace.getActiveFile();
      if (!file) return void new import_obsidian4.Notice("No active note selected.");
      await chat.chatActiveNote(file);
    }
  });
  ctx.addCommand({
    id: "ai-copilot-chat-query",
    name: "AI Copilot: Chat using vault query",
    callback: async () => {
      const query = window.prompt("Ask a question about your notes:");
      if (!query?.trim()) return;
      await chat.chatQuery(query);
    }
  });
  ctx.addCommand({
    id: "ai-copilot-rebuild-vector-index",
    name: "AI Copilot: Rebuild persistent vector index",
    callback: async () => {
      const count = await indexing.rebuildPersistentIndex();
      new import_obsidian4.Notice(`AI Copilot: rebuilt vector index for ${count} notes.`);
    }
  });
  ctx.addCommand({
    id: "ai-copilot-run-refinement-now",
    name: "AI Copilot: Run refinement now",
    callback: async () => void ctx.runRefinementPass()
  });
  ctx.addCommand({
    id: "ai-copilot-preview-refinement-patch",
    name: "AI Copilot: Preview structured refinement patch",
    callback: async () => {
      const file = ctx.app.workspace.getActiveFile();
      if (!file) return void new import_obsidian4.Notice("No active note selected.");
      const content = await ctx.vault.read(file.path);
      const settings = ctx.getSettings();
      new import_obsidian4.Notice("AI Copilot: generating refinement preview\u2026");
      const candidates = [{ path: file.path, content }];
      const prompt = buildRefinementPrompt(candidates, {
        enableWebEnrichment: settings.enableWebEnrichment
      });
      const plan = buildRefinementPlan(candidates);
      const llmOutput = await buildClient(settings).chat(
        `${toMarkdownPlan(plan)}

${prompt}`,
        buildPatchPlanSystemPrompt()
      );
      const fileContents = /* @__PURE__ */ new Map([[file.path, content]]);
      const preview = buildRefinementPreview(llmOutput, fileContents, candidates);
      const md = toMarkdownRefinementPreview(preview);
      await ctx.writeAssistantOutput("Refinement Log", md);
      const editCount = preview.singleFilePreviews.reduce(
        (sum, p) => sum + p.preview.summary.totalEdits,
        0
      );
      new import_obsidian4.Notice(`AI Copilot: preview logged \u2014 ${editCount} edit(s) proposed.`);
    }
  });
  ctx.addCommand({
    id: "ai-copilot-smart-apply-safe",
    name: "AI Copilot: Auto-apply safe refinement edits",
    callback: async () => {
      const file = ctx.app.workspace.getActiveFile();
      if (!file) return void new import_obsidian4.Notice("No active note selected.");
      const content = await ctx.vault.read(file.path);
      const settings = ctx.getSettings();
      new import_obsidian4.Notice("AI Copilot: analyzing note for safe edits\u2026");
      const candidates = [{ path: file.path, content }];
      const prompt = buildRefinementPrompt(candidates, {
        enableWebEnrichment: settings.enableWebEnrichment
      });
      const plan = buildRefinementPlan(candidates);
      const llmOutput = await buildClient(settings).chat(
        `${toMarkdownPlan(plan)}

${prompt}`,
        buildPatchPlanSystemPrompt()
      );
      const fileContents = /* @__PURE__ */ new Map([[file.path, content]]);
      const preview = buildRefinementPreview(llmOutput, fileContents, candidates);
      const decision = buildSafeAutoApplyDecision(preview);
      const totalSafe = (decision.singleFileSelections ?? []).reduce(
        (sum, s) => sum + (s.selectedEditIndices?.length ?? 0),
        0
      );
      if (totalSafe === 0) {
        await ctx.writeAssistantOutput("Refinement Log", toMarkdownRefinementPreview(preview));
        return void new import_obsidian4.Notice("AI Copilot: no safe edits to apply. Preview logged.");
      }
      const { result, snapshot } = applyRefinementDecision(preview, decision, fileContents);
      for (const sr of result.singleFileResults) {
        if (sr.applied.transactions.some((t) => t.applied)) {
          await ctx.vault.modify(sr.path, sr.applied.finalContent);
        }
      }
      ctx.setLastRefinementSnapshot(snapshot);
      await ctx.writeAssistantOutput(
        "Refinement Log",
        `## Smart Apply (safe only)
${result.summary}

${toMarkdownRefinementPreview(preview)}`
      );
      new import_obsidian4.Notice(`AI Copilot: applied ${totalSafe} safe edit(s).`);
    }
  });
  ctx.addCommand({
    id: "ai-copilot-rollback-smart-refinement",
    name: "AI Copilot: Roll back last smart refinement",
    callback: async () => {
      const snapshot = ctx.getLastRefinementSnapshot();
      if (!snapshot) return void new import_obsidian4.Notice("No smart refinement snapshot available for rollback.");
      const rollbackContents = buildRollbackContents(snapshot);
      let restored = 0;
      for (const [path, original] of rollbackContents) {
        if (ctx.vault.exists(path)) {
          await ctx.vault.modify(path, original);
          restored++;
        }
      }
      ctx.clearLastRefinementSnapshot();
      new import_obsidian4.Notice(`AI Copilot: rolled back ${restored} file(s) to pre-refinement state.`);
    }
  });
  ctx.addCommand({
    id: "ai-copilot-rollback-last-refinement-patch",
    name: "AI Copilot: Roll back last refinement patch",
    callback: async () => {
      const { transactions, path } = ctx.getLastPatchState();
      if (!transactions.length || !path) {
        return void new import_obsidian4.Notice("No patch transaction available for rollback.");
      }
      if (!ctx.vault.exists(path)) return void new import_obsidian4.Notice("Original note not found for rollback.");
      const current = await ctx.vault.read(path);
      const { rollbackPatchPlan: rollbackPatchPlan2 } = await Promise.resolve().then(() => (init_patch_plan(), patch_plan_exports));
      const rolled = rollbackPatchPlan2(current, transactions);
      await ctx.vault.modify(path, rolled);
      ctx.clearLastPatchState();
      new import_obsidian4.Notice("AI Copilot: rolled back last structured patch.");
    }
  });
  ctx.addCommand({
    id: "ai-copilot-indexing-status",
    name: "AI Copilot: Show indexing queue status",
    callback: async () => {
      const stats = indexing.queue.stats();
      const summary = [
        `pending=${stats.pending}`,
        `running=${stats.running}`,
        `processed=${stats.processed}`,
        `failed=${stats.failed}`,
        stats.lastRunAt ? `lastRun=${new Date(stats.lastRunAt).toISOString()}` : "lastRun=n/a",
        stats.lastError ? `error=${stats.lastError}` : "error=none"
      ].join(" \xB7 ");
      await ctx.writeAssistantOutput("Refinement Log", `## Indexing Queue Diagnostics
${summary}`);
      new import_obsidian4.Notice(`AI Copilot indexing: ${summary}`);
    }
  });
}
async function runRefinementFlow(candidates, settings, setLastPatchState, vault, writeAssistantOutput, setLastRefinementSnapshot) {
  if (!candidates.length) return void new import_obsidian4.Notice("AI Copilot: no recent notes to refine.");
  const plan = buildRefinementPlan(candidates);
  const prompt = buildRefinementPrompt(candidates, {
    enableWebEnrichment: settings.enableWebEnrichment
  });
  const output = await buildClient(settings).chat(
    `${toMarkdownPlan(plan)}

${prompt}`,
    buildPatchPlanSystemPrompt()
  );
  const fileContents = new Map(candidates.map((c) => [c.path, c.content]));
  const preview = buildRefinementPreview(output, fileContents, candidates);
  if (settings.refinementAutoApply) {
    const decision = buildSafeAutoApplyDecision(preview);
    const totalSafe = (decision.singleFileSelections ?? []).reduce(
      (sum, s) => sum + (s.selectedEditIndices?.length ?? 0),
      0
    );
    if (totalSafe > 0) {
      const { result, snapshot } = applyRefinementDecision(preview, decision, fileContents);
      for (const sr of result.singleFileResults) {
        if (sr.applied.transactions.some((t) => t.applied)) {
          await vault.modify(sr.path, sr.applied.finalContent);
          setLastPatchState(sr.applied.transactions, sr.path);
        }
      }
      if (setLastRefinementSnapshot) setLastRefinementSnapshot(snapshot);
    }
  }
  const md = toMarkdownRefinementPreview(preview);
  new import_obsidian4.Notice(`AI Copilot: scanned ${candidates.length} notes \xB7 TODOs ${preview.todoCount}`);
  await writeAssistantOutput("Refinement Log", `${toMarkdownPlan(plan)}

${md}

## Raw LLM Output
${output}`);
}

// src/obsidian-vault-adapter.ts
var import_obsidian5 = require("obsidian");
var ObsidianVaultAdapter = class {
  constructor(app) {
    this.app = app;
  }
  listMarkdownFiles() {
    return this.app.vault.getMarkdownFiles().map((f) => ({
      path: f.path,
      mtime: f.stat.mtime
    }));
  }
  async read(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) throw new Error(`File not found: ${path}`);
    return this.app.vault.read(file);
  }
  exists(path) {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }
  async create(path, content) {
    await this.app.vault.create(path, content);
  }
  async modify(path, content) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) throw new Error(`File not found: ${path}`);
    await this.app.vault.modify(file, content);
  }
  async append(path, content) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) throw new Error(`File not found: ${path}`);
    await this.app.vault.append(file, content);
  }
  async createFolder(path) {
    await this.app.vault.createFolder(path);
  }
  on(event, callback) {
    if (event === "modify") {
      return this.app.vault.on("modify", (f) => {
        if (f instanceof import_obsidian5.TFile) {
          callback({ path: f.path, mtime: f.stat.mtime });
        }
      });
    }
    return this.app.vault.on("delete", (f) => {
      if ("path" in f) {
        const mtime = f instanceof import_obsidian5.TFile ? f.stat.mtime : 0;
        callback({ path: f.path, mtime });
      }
    });
  }
};

// src/main.ts
var AICopilotPlugin = class extends import_obsidian6.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.intervalId = null;
    this.lastPatchTransactions = [];
    this.lastPatchTargetPath = null;
    this.lastRefinementSnapshot = null;
    this.vault_ = new ObsidianVaultAdapter(this.app);
    this.indexing = new IndexingOrchestrator(this.vault_, () => this.settings);
    this.retrieval = new RetrievalOrchestrator({
      getAllNotes: () => this.indexing.getAllNotes(),
      getVectorIndex: () => this.indexing.getVectorIndex(),
      getSettings: () => this.settings
    });
    this.chat = new ChatOrchestrator(
      this.app,
      this.vault_,
      () => this.settings,
      (query, max) => this.retrieval.getRelevantNotes(query, max),
      (name, body) => this.writeAssistantOutput(name, body)
    );
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AICopilotSettingTab(this.app, this));
    if (this.settings.strictConfigValidation) {
      const issues = validateSettings(this.settings);
      if (issues.length) new import_obsidian6.Notice(`AI Copilot settings warnings: ${issues.join(" | ")}`);
    }
    this.indexing.initializeVectorIndex();
    this.chat.registerView((type, cb) => this.registerView(type, cb));
    registerPluginCommands(
      {
        addCommand: (cmd) => this.addCommand(cmd),
        app: this.app,
        vault: this.vault_,
        getSettings: () => this.settings,
        setLastPatchState: (transactions, path) => {
          this.lastPatchTransactions = transactions;
          this.lastPatchTargetPath = path;
        },
        clearLastPatchState: () => {
          this.lastPatchTransactions = [];
          this.lastPatchTargetPath = null;
        },
        getLastPatchState: () => ({ transactions: this.lastPatchTransactions, path: this.lastPatchTargetPath }),
        setLastRefinementSnapshot: (snapshot) => {
          this.lastRefinementSnapshot = snapshot;
        },
        clearLastRefinementSnapshot: () => {
          this.lastRefinementSnapshot = null;
        },
        getLastRefinementSnapshot: () => this.lastRefinementSnapshot,
        writeAssistantOutput: (name, body) => this.writeAssistantOutput(name, body),
        runRefinementPass: () => this.runRefinementPass()
      },
      this.chat,
      this.indexing
    );
    this.startRefinementLoop();
    this.indexing.registerVaultSyncEvents((evt) => this.registerEvent(evt));
    new import_obsidian6.Notice("AI Copilot loaded.");
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
    this.indexing.initializeVectorIndex();
  }
  startRefinementLoop() {
    if (this.intervalId) window.clearInterval(this.intervalId);
    const intervalMs = Math.max(15, this.settings.refinementIntervalMinutes) * 6e4;
    this.intervalId = window.setInterval(() => {
      this.runRefinementPass().catch((err) => {
        console.error("AI Copilot refinement pass failed:", err);
      });
    }, intervalMs);
    this.registerInterval(this.intervalId);
  }
  async runRefinementPass() {
    const candidates = await this.indexing.getRecentNotes(this.settings.refinementLookbackDays);
    await runRefinementFlow(
      candidates,
      this.settings,
      (transactions, path) => {
        this.lastPatchTransactions = transactions;
        this.lastPatchTargetPath = path;
      },
      this.vault_,
      (name, body) => this.writeAssistantOutput(name, body),
      (snapshot) => {
        this.lastRefinementSnapshot = snapshot;
      }
    );
  }
  async rollbackLastPatchFromCurrentContent(current) {
    return rollbackPatchPlan(current, this.lastPatchTransactions);
  }
  async writeAssistantOutput(name, body) {
    await this.ensurePluginFile(`${name}.md`, `# ${name}
`);
    const path = `AI Copilot/${name}.md`;
    const stamp = `

---
${(/* @__PURE__ */ new Date()).toISOString()}
`;
    const out = this.settings.redactSensitiveLogs ? redactSensitive(body) : body;
    await this.vault_.append(path, `${stamp}${out}
`);
  }
  async ensurePluginFile(name, initial) {
    const folderPath = "AI Copilot";
    const path = `${folderPath}/${name}`;
    if (this.vault_.exists(path)) return;
    if (!this.vault_.exists(folderPath)) {
      await this.vault_.createFolder(folderPath);
    }
    await this.vault_.create(path, initial);
  }
};
