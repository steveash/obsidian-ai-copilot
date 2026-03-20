/**
 * Integration test harness for plugin components.
 *
 * Exercises the full plugin flow: settings → indexing → chat → enrichment → review.
 * Runs in CI without external API calls (all LLM responses are mocked).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

// ── vault & fixtures ────────────────────────────────────────────────
import { InMemoryVaultAdapter } from "../src/vault-adapter";
import {
  createFixtureVault,
  createSmallFixtureVault,
  ALL_FIXTURE_NOTES,
} from "./fixtures/vault-fixture";

// ── agent loop & tools ──────────────────────────────────────────────
import { runAgentLoop } from "../src/agent-loop";
import type { AgentLoopCallbacks } from "../src/agent-loop";
import { executeTool, AGENT_TOOLS } from "../src/agent-tools";
import type { AgentToolContext, NoteSearchFn } from "../src/agent-tools";

// ── enrichment state machine ────────────────────────────────────────
import {
  isValidTransition,
  loadEnrichmentState,
  transitionEnrichmentState,
  classifyEnrichmentResult,
  evaluateInterventionTriggers,
  invalidateIfContentChanged,
  computeContentHash,
  enrichmentStatePath,
  type EnrichmentState,
  type EnrichmentStateRecord,
} from "../src/enrichment-state";

// ── patch plan & refinement ─────────────────────────────────────────
import {
  detectConflicts,
  previewPatchPlan,
  applyPatchPlan,
  rollbackPatchPlan,
  type PatchPlan,
  type PatchPlanEditV2,
  type PatchPlanPreview,
  type ConflictInfo,
} from "../src/patch-plan";
import {
  buildRefinementPreview,
  applyRefinementDecision,
  buildSafeAutoApplyDecision,
  buildRollbackContents,
  type ApplyDecision,
} from "../src/smart-refinement";

// ── settings ────────────────────────────────────────────────────────
import type { AICopilotSettings } from "../src/settings";

// ── mock clients ────────────────────────────────────────────────────
import {
  ScriptedAgentClient,
  directAnswerClient,
  searchThenReadClient,
  listThenAnswerClient,
  infiniteToolClient,
} from "./fixtures/mock-agent-client";

// ── shared helpers ──────────────────────────────────────────────────

const BASE_SETTINGS: AICopilotSettings = {
  provider: "anthropic",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  anthropicApiKey: "sk-ant-test",
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
  agentMode: "auto-apply" as const,
  agentMaxToolCalls: 10,
  agentTimeoutMs: 60000,
  allowRemoteModels: true,
  redactSensitiveLogs: true,
  maxPromptChars: 20000,
  strictConfigValidation: true,
  enrichmentConfidenceThreshold: 0.6,
  enrichmentDestructiveRewriteThreshold: 0.3,
  enrichmentPersistState: true,
  enrichmentEnabled: false,
  enrichmentDebounceSec: 5,
  crossNoteEnrichment: false,
  requireApprovalForNewFiles: true,
};

function makeSettings(overrides: Partial<AICopilotSettings> = {}): AICopilotSettings {
  return { ...BASE_SETTINGS, ...overrides };
}

function makeSearchFn(vault: InMemoryVaultAdapter): NoteSearchFn {
  return async (query: string, maxResults: number) => {
    const files = vault.listMarkdownFiles();
    const results = [];
    for (const f of files) {
      const content = await vault.read(f.path);
      const lowerQuery = query.toLowerCase();
      const lowerContent = content.toLowerCase();
      if (lowerContent.includes(lowerQuery) || f.path.toLowerCase().includes(lowerQuery)) {
        results.push({
          path: f.path,
          content,
          score: lowerContent.includes(lowerQuery) ? 0.9 : 0.5,
          lexicalScore: 0.5,
          semanticScore: 0.5,
          freshnessScore: 0.5,
          graphBoost: 0,
          metadata: { tags: [], links: [], headings: [] },
        });
      }
      if (results.length >= maxResults) break;
    }
    return results;
  };
}

function makeToolCtx(vault: InMemoryVaultAdapter): AgentToolContext {
  return {
    vault,
    searchNotes: makeSearchFn(vault),
    maxSearchResults: 6,
  };
}

function makeEdits(overrides: Partial<PatchPlanEditV2>[] = []): PatchPlanEditV2[] {
  return overrides.map((o) => ({
    find: "old text",
    replace: "new text",
    reason: "test",
    confidence: 0.9,
    risk: "safe" as const,
    ...o,
  }));
}

function makePreview(
  edits: PatchPlanEditV2[],
  options: { safetyIssues?: string[][] } = {}
): PatchPlanPreview {
  return {
    path: "test.md",
    summary: {
      totalEdits: edits.length,
      appliedEdits: edits.length,
      totalOccurrences: edits.length,
      safeEdits: edits.length,
      unsafeEdits: 0,
    },
    edits: edits.map((e, i) => ({
      index: i + 1,
      reason: e.reason,
      applied: true,
      occurrences: 1,
      status: "applied",
      beforeSample: "...",
      afterSample: "...",
      confidence: e.confidence,
      risk: e.risk,
      safetyIssues: options.safetyIssues?.[i] ?? [],
    })),
  };
}

// ═════════════════════════════════════════════════════════════════════
// 1. VAULT FIXTURE VALIDATION
// ═════════════════════════════════════════════════════════════════════

describe("Vault Fixture", () => {
  it("creates 50+ notes", () => {
    expect(ALL_FIXTURE_NOTES.length).toBeGreaterThanOrEqual(50);
  });

  it("creates a working InMemoryVaultAdapter", () => {
    const vault = createFixtureVault();
    const files = vault.listMarkdownFiles();
    expect(files.length).toBeGreaterThanOrEqual(50);
  });

  it("has notes in diverse folders", () => {
    const folders = new Set(ALL_FIXTURE_NOTES.map((n) => n.path.split("/")[0]));
    expect(folders.size).toBeGreaterThanOrEqual(7);
    expect(folders).toContain("Projects");
    expect(folders).toContain("Daily");
    expect(folders).toContain("Reference");
    expect(folders).toContain("Research");
  });

  it("has notes of varying sizes", () => {
    const sizes = ALL_FIXTURE_NOTES.map((n) => n.content.length);
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    expect(minSize).toBeLessThan(300);
    expect(maxSize).toBeGreaterThan(800);
  });

  it("has notes with wikilinks", () => {
    const linked = ALL_FIXTURE_NOTES.filter((n) => n.content.includes("[["));
    expect(linked.length).toBeGreaterThan(5);
  });

  it("has notes with TODO items", () => {
    const withTodos = ALL_FIXTURE_NOTES.filter((n) => n.content.includes("- [ ]"));
    expect(withTodos.length).toBeGreaterThan(5);
  });

  it("has notes with tables", () => {
    const withTables = ALL_FIXTURE_NOTES.filter((n) => n.content.includes("| "));
    expect(withTables.length).toBeGreaterThan(3);
  });

  it("has notes with code blocks", () => {
    const withCode = ALL_FIXTURE_NOTES.filter((n) => n.content.includes("```"));
    expect(withCode.length).toBeGreaterThanOrEqual(2);
  });

  it("has varying modification times", () => {
    const mtimes = ALL_FIXTURE_NOTES.map((n) => n.mtime);
    const range = Math.max(...mtimes) - Math.min(...mtimes);
    const DAY = 86_400_000;
    expect(range).toBeGreaterThan(30 * DAY);
  });

  it("all notes are readable from the vault", async () => {
    const vault = createFixtureVault();
    for (const note of ALL_FIXTURE_NOTES) {
      const content = await vault.read(note.path);
      expect(content).toBe(note.content);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. AGENT TOOL EXECUTION (read/write with guardrails)
// ═════════════════════════════════════════════════════════════════════

describe("Agent Tool Execution on Fixture Vault", () => {
  let vault: InMemoryVaultAdapter;
  let ctx: AgentToolContext;

  beforeEach(() => {
    vault = createFixtureVault();
    ctx = makeToolCtx(vault);
  });

  describe("search_notes", () => {
    it("finds project notes by keyword", async () => {
      const result = await executeTool("search_notes", { query: "redesign" }, ctx);
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("webapp-redesign");
    });

    it("finds notes across multiple folders", async () => {
      const result = await executeTool("search_notes", { query: "component" }, ctx);
      expect(result.content).toContain("component");
    });

    it("returns empty for unmatched queries", async () => {
      const result = await executeTool(
        "search_notes",
        { query: "xyznonexistenttopic123" },
        ctx
      );
      expect(result.content).toContain("No matching notes");
    });

    it("rejects empty query", async () => {
      const result = await executeTool("search_notes", { query: "" }, ctx);
      expect(result.is_error).toBe(true);
    });
  });

  describe("read_note", () => {
    it("reads a project note", async () => {
      const result = await executeTool(
        "read_note",
        { path: "Projects/webapp-redesign.md" },
        ctx
      );
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Web App Redesign");
      expect(result.content).toContain("React");
    });

    it("reads daily notes", async () => {
      const files = vault.listMarkdownFiles();
      const daily = files.find((f) => f.path.startsWith("Daily/"));
      expect(daily).toBeDefined();
      const result = await executeTool("read_note", { path: daily!.path }, ctx);
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Daily Note");
    });

    it("returns error for nonexistent note", async () => {
      const result = await executeTool(
        "read_note",
        { path: "Nonexistent/note.md" },
        ctx
      );
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Note not found");
    });

    it("returns error for empty path", async () => {
      const result = await executeTool("read_note", { path: "" }, ctx);
      expect(result.is_error).toBe(true);
    });
  });

  describe("list_notes", () => {
    it("lists all notes without filter", async () => {
      const result = await executeTool("list_notes", {}, ctx);
      expect(result.content).toContain("Projects/webapp-redesign.md");
      expect(result.content).toContain("Daily/");
    });

    it("filters by folder", async () => {
      const result = await executeTool("list_notes", { folder: "Projects/" }, ctx);
      expect(result.content).toContain("Projects/");
      expect(result.content).not.toContain("Daily/");
      expect(result.content).not.toContain("Reference/");
    });

    it("returns empty for nonexistent folder", async () => {
      const result = await executeTool(
        "list_notes",
        { folder: "Nonexistent/" },
        ctx
      );
      expect(result.content).toContain("No notes found");
    });

    it("lists notes sorted by modification time", async () => {
      const result = await executeTool("list_notes", { folder: "Projects/" }, ctx);
      const lines = result.content.split("\n").filter((l) => l.startsWith("- "));
      expect(lines.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("tool guardrails", () => {
    it("rejects unknown tool names", async () => {
      const result = await executeTool("delete_note", {}, ctx);
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Unknown tool");
    });

    it("write_note blocks protected paths", async () => {
      const result = await executeTool(
        "write_note",
        { path: ".obsidian/config.json", content: "hack" },
        ctx
      );
      expect(result.is_error).toBe(true);
    });

    it("write_note blocks path traversal", async () => {
      const result = await executeTool(
        "write_note",
        { path: "../outside-vault.md", content: "escape" },
        ctx
      );
      expect(result.is_error).toBe(true);
    });

    it("edit_note blocks edits on nonexistent notes", async () => {
      const result = await executeTool(
        "edit_note",
        { path: "nonexistent.md", find: "a", replace: "b" },
        ctx
      );
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("not found");
    });

    it("write_note creates new notes successfully", async () => {
      const result = await executeTool(
        "write_note",
        { path: "NewFolder/test-note.md", content: "# Test\nNew content." },
        ctx
      );
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("created");

      const content = await vault.read("NewFolder/test-note.md");
      expect(content).toBe("# Test\nNew content.");
    });

    it("edit_note applies targeted edits with guardrails", async () => {
      const result = await executeTool(
        "edit_note",
        {
          path: "Projects/webapp-redesign.md",
          find: "Complete redesign",
          replace: "Full redesign",
        },
        ctx
      );
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("edited");

      const content = await vault.read("Projects/webapp-redesign.md");
      expect(content).toContain("Full redesign");
      expect(content).not.toContain("Complete redesign");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. AGENT LOOP INTEGRATION (chat with mocked LLM)
// ═════════════════════════════════════════════════════════════════════

describe("Agent Loop Integration", () => {
  let vault: InMemoryVaultAdapter;
  let ctx: AgentToolContext;
  let settings: AICopilotSettings;

  beforeEach(() => {
    vault = createFixtureVault();
    ctx = makeToolCtx(vault);
    settings = makeSettings();
  });

  it("handles direct answer (no tool calls)", async () => {
    const client = directAnswerClient("The vault has notes about web development.");
    const result = await runAgentLoop(client, "What is this vault about?", ctx, settings);

    expect(result.text).toBe("The vault has notes about web development.");
    expect(result.toolCallCount).toBe(0);
    expect(result.citations).toEqual([]);
  });

  it("handles search → read → answer flow", async () => {
    const client = searchThenReadClient(
      "redesign",
      "Projects/webapp-redesign.md",
      "The web app redesign involves migrating from jQuery to React."
    );

    const toolCalls: string[] = [];
    const callbacks: AgentLoopCallbacks = {
      onToolCall: (name) => toolCalls.push(name),
    };

    const result = await runAgentLoop(client, "Tell me about the redesign", ctx, settings, callbacks);

    expect(result.text).toContain("React");
    expect(result.toolCallCount).toBe(2);
    expect(toolCalls).toEqual(["search_notes", "read_note"]);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].path).toBe("Projects/webapp-redesign.md");
  });

  it("handles list → answer flow", async () => {
    const client = listThenAnswerClient(
      "Projects/",
      "There are 5 project notes covering the redesign, API, mobile app, component library, and data pipeline."
    );

    const result = await runAgentLoop(client, "What projects exist?", ctx, settings);

    expect(result.text).toContain("5 project notes");
    expect(result.toolCallCount).toBe(1);
  });

  it("respects maxToolCalls limit", async () => {
    const client = infiniteToolClient();
    const limitedSettings = makeSettings({ agentMaxToolCalls: 3 });

    const result = await runAgentLoop(client, "keep listing", ctx, limitedSettings);

    expect(result.toolCallCount).toBeLessThanOrEqual(4);
  });

  it("tracks multiple citations from read_note calls", async () => {
    const client = new ScriptedAgentClient([
      {
        content: [
          {
            type: "tool_use",
            id: "c1",
            name: "read_note",
            input: { path: "Projects/webapp-redesign.md" },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [
          {
            type: "tool_use",
            id: "c2",
            name: "read_note",
            input: { path: "Projects/api-v2.md" },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "Both projects are related." }],
        stop_reason: "end_turn",
      },
    ]);

    const result = await runAgentLoop(client, "compare projects", ctx, settings);

    expect(result.citations).toHaveLength(2);
    const citedPaths = result.citations.map((c) => c.path);
    expect(citedPaths).toContain("Projects/webapp-redesign.md");
    expect(citedPaths).toContain("Projects/api-v2.md");
  });

  it("handles tool errors gracefully (nonexistent note)", async () => {
    const client = new ScriptedAgentClient([
      {
        content: [
          {
            type: "tool_use",
            id: "c1",
            name: "read_note",
            input: { path: "does-not-exist.md" },
          },
        ],
        stop_reason: "tool_use",
      },
      {
        content: [{ type: "text", text: "I could not find that note." }],
        stop_reason: "end_turn",
      },
    ]);

    const result = await runAgentLoop(client, "read missing note", ctx, settings);
    expect(result.text).toContain("could not find");
    expect(result.toolCallCount).toBe(1);
  });

  it("feeds tool results back to the model correctly", async () => {
    const client = searchThenReadClient(
      "API",
      "Projects/api-v2.md",
      "API v2 uses Bearer tokens."
    );

    await runAgentLoop(client, "how does auth work?", ctx, settings);

    // Verify the second call received tool results
    expect(client.calls.length).toBe(3);
    const secondCallMessages = client.calls[1];
    // Should have: user msg, assistant (tool_use), user (tool_result)
    expect(secondCallMessages).toHaveLength(3);
    const toolResultMsg = secondCallMessages[2];
    expect(toolResultMsg.role).toBe("user");
    const content = toolResultMsg.content as Array<{ type: string; tool_use_id?: string }>;
    expect(content[0].type).toBe("tool_result");
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. ENRICHMENT STATE TRANSITIONS
//    (save → enqueue → classify → review)
// ═════════════════════════════════════════════════════════════════════

describe("Enrichment State Transitions (Integration)", () => {
  let vault: InMemoryVaultAdapter;

  beforeEach(() => {
    vault = createFixtureVault();
  });

  describe("full enrichment lifecycle: unenriched → analyzing → suggested → approved → applied", () => {
    it("walks through the happy path", async () => {
      const notePath = "Projects/webapp-redesign.md";
      const content = await vault.read(notePath);
      const hash = await computeContentHash(content);

      // Step 1: unenriched → analyzing (save)
      const s1 = await transitionEnrichmentState(vault, notePath, "analyzing", {
        runId: "run-001",
        contentHash: hash,
        model: "claude-sonnet-4-6",
        contextNotes: ["Projects/component-library.md"],
      });
      expect(s1.state).toBe("analyzing");
      expect(s1.runId).toBe("run-001");

      // Step 2: analyzing → suggested (enqueue/classify)
      const edits = makeEdits([
        { find: "teh", replace: "the", confidence: 0.95, risk: "safe" },
      ]);
      const s2 = await transitionEnrichmentState(vault, notePath, "suggested", {
        pendingPlan: { path: notePath, edits },
        avgConfidence: 0.95,
      });
      expect(s2.state).toBe("suggested");
      expect(s2.pendingPlan).toBeDefined();

      // Step 3: suggested → approved (review)
      const s3 = await transitionEnrichmentState(vault, notePath, "approved", {
        editDecisions: { 0: "approved" },
      });
      expect(s3.state).toBe("approved");
      expect(s3.editDecisions).toEqual({ 0: "approved" });

      // Step 4: approved → applied
      const s4 = await transitionEnrichmentState(vault, notePath, "applied", {
        preApplySnapshot: content,
      });
      expect(s4.state).toBe("applied");
      expect(s4.preApplySnapshot).toBe(content);

      // Verify persisted state matches
      const loaded = await loadEnrichmentState(vault, notePath);
      expect(loaded.state).toBe("applied");
      expect(loaded.runId).toBe("run-001");
    });
  });

  describe("human-required path", () => {
    it("routes to human-required when triggers are met", async () => {
      const notePath = "Projects/api-v2.md";
      const content = await vault.read(notePath);
      const hash = await computeContentHash(content);

      // Start analyzing
      await transitionEnrichmentState(vault, notePath, "analyzing", {
        contentHash: hash,
        runId: "run-002",
      });

      // Classify with low-confidence edits → human-required
      const edits = makeEdits([
        { find: "RESTful", replace: "REST-based", confidence: 0.3, risk: "safe" },
      ]);
      const classification = classifyEnrichmentResult({
        edits,
        originalContent: content,
        preview: makePreview(edits),
        conflicts: [],
        autoApplyEnabled: true,
      });
      expect(classification.state).toBe("human-required");
      expect(classification.triggers).toContain("low-confidence");

      // Transition to human-required
      const s = await transitionEnrichmentState(vault, notePath, "human-required", {
        triggers: classification.triggers,
        pendingPlan: { path: notePath, edits },
        avgConfidence: classification.avgConfidence,
      });
      expect(s.state).toBe("human-required");
      expect(s.triggers).toContain("low-confidence");
    });

    it("allows human-required → suggested after revision", async () => {
      const notePath = "Research/embedding-models-2026.md";

      await transitionEnrichmentState(vault, notePath, "analyzing", { runId: "run-003" });
      await transitionEnrichmentState(vault, notePath, "human-required", {
        triggers: ["ambiguous-intent"],
      });

      // After human provides guidance, move to suggested
      const s = await transitionEnrichmentState(vault, notePath, "suggested", {
        triggers: [],
      });
      expect(s.state).toBe("suggested");
    });

    it("allows human-required → rejected", async () => {
      const notePath = "Research/embedding-models-2026.md";

      await transitionEnrichmentState(vault, notePath, "analyzing", { runId: "run-004" });
      await transitionEnrichmentState(vault, notePath, "human-required", {
        triggers: ["destructive-rewrite"],
      });

      const s = await transitionEnrichmentState(vault, notePath, "rejected", {});
      expect(s.state).toBe("rejected");
    });
  });

  describe("auto-enrichment path", () => {
    it("classifies safe high-confidence edits as auto-enriched", async () => {
      const notePath = "Daily/" + new Date().toISOString().slice(0, 10) + ".md";
      // Use a note that exists in the fixture vault
      const existingDaily = vault.listMarkdownFiles().find((f) => f.path.startsWith("Daily/"));
      if (!existingDaily) return;

      const content = await vault.read(existingDaily.path);
      const hash = await computeContentHash(content);

      await transitionEnrichmentState(vault, existingDaily.path, "analyzing", {
        contentHash: hash,
        runId: "run-005",
      });

      const edits = makeEdits([
        { find: "documentation", replace: "docs", confidence: 0.95, risk: "safe" },
      ]);
      const classification = classifyEnrichmentResult({
        edits,
        originalContent: content,
        preview: makePreview(edits),
        conflicts: [],
        autoApplyEnabled: true,
      });
      expect(classification.state).toBe("auto-enriched");

      const s = await transitionEnrichmentState(vault, existingDaily.path, "auto-enriched", {
        avgConfidence: classification.avgConfidence,
      });
      expect(s.state).toBe("auto-enriched");
    });

    it("classifies same edits as suggested when auto-apply is disabled", () => {
      const edits = makeEdits([
        { find: "old", replace: "new", confidence: 0.95, risk: "safe" },
      ]);
      const classification = classifyEnrichmentResult({
        edits,
        originalContent: "This is a very long note with old content that should not trigger destructive rewrite.",
        preview: makePreview(edits),
        conflicts: [],
        autoApplyEnabled: false,
      });
      expect(classification.state).toBe("suggested");
    });
  });

  describe("content hash invalidation", () => {
    it("invalidates enrichment when note content changes", async () => {
      const notePath = "Projects/component-library.md";
      const content = await vault.read(notePath);
      const hash = await computeContentHash(content);

      // Set up enrichment state
      await transitionEnrichmentState(vault, notePath, "analyzing", {
        contentHash: hash,
        runId: "run-006",
      });
      await transitionEnrichmentState(vault, notePath, "suggested", {
        pendingPlan: { path: notePath, edits: [{ find: "old", replace: "new", reason: "test" }] },
      });

      // Simulate user editing the note
      const modifiedContent = content + "\n## New Section\nAdded by user.";
      const invalidated = await invalidateIfContentChanged(vault, notePath, modifiedContent);
      expect(invalidated).toBe(true);

      // Verify state reset
      const state = await loadEnrichmentState(vault, notePath);
      expect(state.state).toBe("unenriched");
      expect(state.pendingPlan).toBeNull();
    });

    it("does not invalidate when content is unchanged", async () => {
      const notePath = "Projects/component-library.md";
      const content = await vault.read(notePath);
      const hash = await computeContentHash(content);

      await transitionEnrichmentState(vault, notePath, "analyzing", {
        contentHash: hash,
        runId: "run-007",
      });
      await transitionEnrichmentState(vault, notePath, "suggested", {});

      const invalidated = await invalidateIfContentChanged(vault, notePath, content);
      expect(invalidated).toBe(false);

      const state = await loadEnrichmentState(vault, notePath);
      expect(state.state).toBe("suggested");
    });
  });

  describe("multiple notes tracked independently", () => {
    it("tracks enrichment state for multiple notes simultaneously", async () => {
      const notes = [
        "Projects/webapp-redesign.md",
        "Projects/api-v2.md",
        "Research/offline-sync-strategies.md",
      ];

      // Put each note in a different state
      await transitionEnrichmentState(vault, notes[0], "analyzing", { runId: "r1" });
      await transitionEnrichmentState(vault, notes[1], "analyzing", { runId: "r2" });
      await transitionEnrichmentState(vault, notes[2], "analyzing", { runId: "r3" });

      await transitionEnrichmentState(vault, notes[0], "suggested", {});
      await transitionEnrichmentState(vault, notes[1], "auto-enriched", {});
      await transitionEnrichmentState(vault, notes[2], "human-required", {
        triggers: ["low-confidence"],
      });

      // Verify each has independent state
      const s0 = await loadEnrichmentState(vault, notes[0]);
      const s1 = await loadEnrichmentState(vault, notes[1]);
      const s2 = await loadEnrichmentState(vault, notes[2]);

      expect(s0.state).toBe("suggested");
      expect(s1.state).toBe("auto-enriched");
      expect(s2.state).toBe("human-required");
      expect(s2.triggers).toContain("low-confidence");
    });
  });

  describe("invalid transitions are rejected", () => {
    it("rejects unenriched → approved", async () => {
      await expect(
        transitionEnrichmentState(vault, "Projects/api-v2.md", "approved", {})
      ).rejects.toThrow("Invalid enrichment transition");
    });

    it("rejects suggested → applied (must go through approved)", async () => {
      await transitionEnrichmentState(vault, "Projects/api-v2.md", "analyzing", { runId: "r" });
      await transitionEnrichmentState(vault, "Projects/api-v2.md", "suggested", {});

      await expect(
        transitionEnrichmentState(vault, "Projects/api-v2.md", "applied", {})
      ).rejects.toThrow("Invalid enrichment transition");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. APPROVAL FLOW (propose → accept/reject)
// ═════════════════════════════════════════════════════════════════════

describe("Approval Flow Integration", () => {
  let vault: InMemoryVaultAdapter;

  beforeEach(() => {
    vault = createFixtureVault();
  });

  describe("propose → preview → accept → apply → rollback", () => {
    it("full refinement flow on fixture vault note", async () => {
      const notePath = "Projects/webapp-redesign.md";
      const originalContent = await vault.read(notePath);

      // Step 1: LLM proposes edits (mocked)
      const llmOutput =
        "```json\n" +
        JSON.stringify({
          path: notePath,
          title: "Improve project note",
          edits: [
            {
              find: "Complete redesign",
              replace: "Full redesign",
              reason: "more concise",
              confidence: 0.92,
              risk: "safe",
            },
            {
              find: "Improve load time by 60%",
              replace: "Reduce load time by 60%",
              reason: "clearer verb",
              confidence: 0.88,
              risk: "safe",
            },
          ],
        }) +
        "\n```";

      const fileContents = new Map([[notePath, originalContent]]);
      const candidates = [{ path: notePath, content: originalContent }];

      // Step 2: Preview
      const preview = buildRefinementPreview(llmOutput, fileContents, candidates);
      expect(preview.singleFilePreviews).toHaveLength(1);
      expect(preview.singleFilePreviews[0].conflicts).toHaveLength(0);
      expect(preview.singleFilePreviews[0].preview.summary.appliedEdits).toBe(2);

      // Step 3: Accept all edits
      const decision: ApplyDecision = {
        singleFileSelections: [{ planIndex: 0 }],
      };

      const { result, snapshot } = applyRefinementDecision(
        preview,
        decision,
        fileContents
      );

      expect(result.singleFileResults).toHaveLength(1);
      const applied = result.singleFileResults[0].applied;
      expect(applied.finalContent).toContain("Full redesign");
      expect(applied.finalContent).toContain("Reduce load time");
      expect(applied.finalContent).not.toContain("Complete redesign");

      // Step 4: Verify snapshot for rollback
      expect(snapshot.snapshots.get(notePath)).toBe(originalContent);

      // Step 5: Rollback
      const rollback = buildRollbackContents(snapshot);
      expect(rollback.get(notePath)).toBe(originalContent);
    });
  });

  describe("propose → partial accept", () => {
    it("accepts some edits and rejects others", async () => {
      const notePath = "Reference/coding-standards.md";
      const content = await vault.read(notePath);

      const llmOutput =
        "```json\n" +
        JSON.stringify({
          path: notePath,
          edits: [
            {
              find: "Strict mode enabled",
              replace: "Strict mode is mandatory",
              reason: "stronger language",
              confidence: 0.9,
              risk: "safe",
            },
            {
              find: "Functional components only",
              replace: "Only functional components allowed",
              reason: "rephrasing",
              confidence: 0.85,
              risk: "safe",
            },
            {
              find: "Minimum 80% code coverage",
              replace: "Minimum 90% code coverage",
              reason: "higher bar",
              confidence: 0.4,
              risk: "moderate",
            },
          ],
        }) +
        "\n```";

      const fileContents = new Map([[notePath, content]]);
      const preview = buildRefinementPreview(llmOutput, fileContents, []);

      // Accept only the first two edits (indices 0, 1)
      const decision: ApplyDecision = {
        singleFileSelections: [{ planIndex: 0, selectedEditIndices: [0, 1] }],
      };

      const { result } = applyRefinementDecision(preview, decision, fileContents);
      const final = result.singleFileResults[0].applied.finalContent;

      expect(final).toContain("Strict mode is mandatory");
      expect(final).toContain("Only functional components allowed");
      expect(final).toContain("Minimum 80% code coverage"); // unchanged
      expect(final).not.toContain("90%");
    });
  });

  describe("propose → reject all", () => {
    it("rejecting all edits preserves original content", () => {
      const content = "Original content stays.";
      const plan: PatchPlan = {
        path: "test.md",
        edits: [{ find: "Original", replace: "Modified", reason: "test" }],
      };

      // Apply with empty selection = no changes
      const applied = applyPatchPlan(content, plan, { selectedIndices: [] });
      expect(applied.finalContent).toBe(content);
      expect(applied.transactions).toHaveLength(0);
    });
  });

  describe("conflict detection in approval flow", () => {
    it("detects stale edits", async () => {
      const notePath = "Projects/mobile-app.md";
      const content = await vault.read(notePath);

      const llmOutput =
        "```json\n" +
        JSON.stringify({
          path: notePath,
          edits: [
            {
              find: "text that does not exist in the note",
              replace: "replacement",
              reason: "stale",
              confidence: 0.9,
              risk: "safe",
            },
            {
              find: "React Native",
              replace: "React Native (Expo)",
              reason: "specify tooling",
              confidence: 0.88,
              risk: "safe",
            },
          ],
        }) +
        "\n```";

      const fileContents = new Map([[notePath, content]]);
      const preview = buildRefinementPreview(llmOutput, fileContents, []);

      const conflicts = preview.singleFilePreviews[0].conflicts;
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      const staleConflicts = conflicts.filter((c) => c.conflict === "stale");
      expect(staleConflicts).toHaveLength(1);
      expect(staleConflicts[0].editIndex).toBe(0);
    });

    it("safe auto-apply skips conflicting edits", async () => {
      const notePath = "Projects/data-pipeline.md";
      const content = await vault.read(notePath);

      const llmOutput =
        "```json\n" +
        JSON.stringify({
          path: notePath,
          edits: [
            {
              find: "nonexistent text",
              replace: "replacement",
              reason: "stale",
              confidence: 0.99,
              risk: "safe",
            },
            {
              find: "ETL pipeline",
              replace: "ELT pipeline",
              reason: "modernize",
              confidence: 0.92,
              risk: "safe",
            },
          ],
        }) +
        "\n```";

      const fileContents = new Map([[notePath, content]]);
      const preview = buildRefinementPreview(llmOutput, fileContents, []);
      const decision = buildSafeAutoApplyDecision(preview);

      // Only the non-stale, safe edit should be selected
      expect(decision.singleFileSelections).toHaveLength(1);
      expect(decision.singleFileSelections![0].selectedEditIndices).toEqual([1]);
    });
  });

  describe("enrichment classification drives approval path", () => {
    it("human-required classification → triggers listed → user reviews", async () => {
      const notePath = "Projects/webapp-redesign.md";
      const content = await vault.read(notePath);

      // Simulate LLM producing destructive rewrite
      const bigFind = content.slice(0, Math.floor(content.length * 0.5));
      const edits = makeEdits([{ find: bigFind, replace: "Entirely new content.", confidence: 0.9 }]);

      const triggerResult = evaluateInterventionTriggers({
        edits,
        originalContent: content,
        preview: makePreview(edits),
        conflicts: [],
      });

      expect(triggerResult).toContain("destructive-rewrite");

      const classification = classifyEnrichmentResult({
        edits,
        originalContent: content,
        preview: makePreview(edits),
        conflicts: [],
        autoApplyEnabled: true,
      });
      expect(classification.state).toBe("human-required");
    });

    it("safe edits with auto-apply → auto-enriched (no user review)", () => {
      const edits = makeEdits([{ find: "x", replace: "y", confidence: 0.95, risk: "safe" }]);
      const classification = classifyEnrichmentResult({
        edits,
        originalContent: "This is long content with x in it and much more text to prevent destructive-rewrite trigger.",
        preview: makePreview(edits),
        conflicts: [],
        autoApplyEnabled: true,
      });
      expect(classification.state).toBe("auto-enriched");
      expect(classification.triggers).toEqual([]);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6. END-TO-END: settings → chat → enrichment → review
// ═════════════════════════════════════════════════════════════════════

describe("End-to-End Plugin Flow", () => {
  let vault: InMemoryVaultAdapter;

  beforeEach(() => {
    vault = createFixtureVault();
  });

  it("settings drive chat behavior → agent searches vault → enrichment classifies → approval applies", async () => {
    const settings = makeSettings({ agentMaxToolCalls: 5, chatMaxResults: 4 });

    // 1. Chat phase: agent searches and reads
    const ctx = makeToolCtx(vault);
    const client = searchThenReadClient(
      "security",
      "Reference/security-checklist.md",
      "The vault has a security checklist covering auth, authorization, and data protection."
    );

    const chatResult = await runAgentLoop(client, "What security measures exist?", ctx, settings);
    expect(chatResult.text).toContain("security checklist");
    expect(chatResult.citations[0].path).toBe("Reference/security-checklist.md");

    // 2. Enrichment phase: classify edits for the cited note
    const notePath = chatResult.citations[0].path;
    const content = await vault.read(notePath);
    const hash = await computeContentHash(content);

    await transitionEnrichmentState(vault, notePath, "analyzing", {
      contentHash: hash,
      runId: "e2e-run-001",
      model: settings.anthropicModel,
      contextNotes: [],
    });

    // Simulate LLM enrichment output
    const enrichmentEdits = makeEdits([
      { find: "api_key should never appear in notes", replace: "API keys must never appear in notes", confidence: 0.93, risk: "safe" },
    ]);

    const classification = classifyEnrichmentResult({
      edits: enrichmentEdits,
      originalContent: content,
      preview: makePreview(enrichmentEdits),
      conflicts: [],
      autoApplyEnabled: settings.refinementAutoApply,
    });

    // With autoApply disabled (default), goes to suggested
    expect(classification.state).toBe("suggested");

    await transitionEnrichmentState(vault, notePath, "suggested", {
      pendingPlan: { path: notePath, edits: enrichmentEdits },
      avgConfidence: classification.avgConfidence,
    });

    // 3. Review phase: user approves
    await transitionEnrichmentState(vault, notePath, "approved", {
      editDecisions: { 0: "approved" },
    });

    // 4. Apply phase
    const plan: PatchPlan = { path: notePath, edits: enrichmentEdits };
    const applied = applyPatchPlan(content, plan);
    expect(applied.finalContent).toContain("API keys must never appear in notes");

    // Write back to vault
    await vault.modify(notePath, applied.finalContent);

    await transitionEnrichmentState(vault, notePath, "applied", {
      preApplySnapshot: content,
    });

    // Verify final state
    const finalState = await loadEnrichmentState(vault, notePath);
    expect(finalState.state).toBe("applied");
    expect(finalState.preApplySnapshot).toBe(content);

    const finalContent = await vault.read(notePath);
    expect(finalContent).toContain("API keys must never appear");
  });

  it("end-to-end with auto-apply enabled", async () => {
    const settings = makeSettings({ refinementAutoApply: true });
    const notePath = "Areas/team-processes.md";
    const content = await vault.read(notePath);
    const hash = await computeContentHash(content);

    // 1. Start enrichment
    await transitionEnrichmentState(vault, notePath, "analyzing", {
      contentHash: hash,
      runId: "e2e-auto-001",
    });

    // 2. Classify as auto-enriched (safe + high confidence)
    const edits = makeEdits([
      { find: "Respond to reviews within 24 hours", replace: "Respond to reviews within 24h", confidence: 0.96, risk: "safe" },
    ]);

    const classification = classifyEnrichmentResult({
      edits,
      originalContent: content,
      preview: makePreview(edits),
      conflicts: [],
      autoApplyEnabled: settings.refinementAutoApply,
    });
    expect(classification.state).toBe("auto-enriched");

    // 3. Auto-apply (no user review needed)
    await transitionEnrichmentState(vault, notePath, "auto-enriched", {
      avgConfidence: classification.avgConfidence,
    });

    const plan: PatchPlan = { path: notePath, edits };
    const applied = applyPatchPlan(content, plan);
    await vault.modify(notePath, applied.finalContent);

    // 4. Reset to unenriched
    await transitionEnrichmentState(vault, notePath, "unenriched", {
      pendingPlan: null,
    });

    const finalState = await loadEnrichmentState(vault, notePath);
    expect(finalState.state).toBe("unenriched");
  });

  it("end-to-end rejection flow", async () => {
    const notePath = "Research/llm-structured-output.md";
    const content = await vault.read(notePath);
    const hash = await computeContentHash(content);

    await transitionEnrichmentState(vault, notePath, "analyzing", {
      contentHash: hash,
      runId: "e2e-reject-001",
    });

    // Low-confidence edits → human-required
    const edits = makeEdits([
      { find: "JSON in code fences", replace: "Structured JSON output", confidence: 0.3, risk: "moderate" },
    ]);

    const classification = classifyEnrichmentResult({
      edits,
      originalContent: content,
      preview: makePreview(edits),
      conflicts: [],
      autoApplyEnabled: true,
    });
    expect(classification.state).toBe("human-required");

    await transitionEnrichmentState(vault, notePath, "human-required", {
      triggers: classification.triggers,
    });

    // User rejects
    await transitionEnrichmentState(vault, notePath, "rejected", {});

    // Reset
    await transitionEnrichmentState(vault, notePath, "unenriched", {
      pendingPlan: null,
      triggers: [],
    });

    const finalState = await loadEnrichmentState(vault, notePath);
    expect(finalState.state).toBe("unenriched");
  });

  it("enrichment state survives vault note modification detection", async () => {
    const notePath = "Projects/data-pipeline.md";
    const content = await vault.read(notePath);
    const hash = await computeContentHash(content);

    // Set up suggested state
    await transitionEnrichmentState(vault, notePath, "analyzing", {
      contentHash: hash,
      runId: "e2e-invalidate-001",
    });
    await transitionEnrichmentState(vault, notePath, "suggested", {
      pendingPlan: { path: notePath, edits: [{ find: "ETL", replace: "ELT", reason: "test" }] },
    });

    // User edits the note
    const newContent = content + "\n## Added by user\nNew section.";
    await vault.modify(notePath, newContent);

    // Check invalidation
    const invalidated = await invalidateIfContentChanged(vault, notePath, newContent);
    expect(invalidated).toBe(true);

    const state = await loadEnrichmentState(vault, notePath);
    expect(state.state).toBe("unenriched");
    expect(state.pendingPlan).toBeNull();
  });
});
