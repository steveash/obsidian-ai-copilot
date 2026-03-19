import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EnrichmentOrchestrator } from "../src/enrichment-orchestrator";
import { InMemoryVaultAdapter } from "../src/vault-adapter";
import type { AICopilotSettings } from "../src/settings";
import { loadEnrichmentState } from "../src/enrichment-state";
import type { IndexingOrchestrator } from "../src/indexing-orchestrator";

// Mock LLM and refinement modules to avoid real API calls
vi.mock("../src/llm", () => ({
  buildClient: () => ({
    chat: vi.fn().mockResolvedValue("No changes needed."),
  }),
}));

// ── helpers ──────────────────────────────────────────────────────────

const BASE_SETTINGS: AICopilotSettings = {
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
  agentTimeoutMs: 60000,
  allowRemoteModels: true,
  redactSensitiveLogs: true,
  maxPromptChars: 20000,
  strictConfigValidation: true,
  enrichmentConfidenceThreshold: 0.6,
  enrichmentDestructiveRewriteThreshold: 0.3,
  enrichmentPersistState: true,
  enrichmentEnabled: true,
  enrichmentDebounceSec: 1,
};

function makeSettings(overrides: Partial<AICopilotSettings> = {}): AICopilotSettings {
  return { ...BASE_SETTINGS, ...overrides };
}

function makeOrchestrator(opts: {
  vault?: InMemoryVaultAdapter;
  settings?: Partial<AICopilotSettings>;
} = {}) {
  const vault = opts.vault ?? new InMemoryVaultAdapter([
    { path: "notes/test.md", content: "# Test note\nSome content.", mtime: Date.now() },
  ]);
  const settings = makeSettings(opts.settings);
  const writeLog = vi.fn().mockResolvedValue(undefined);

  const orch = new EnrichmentOrchestrator({
    vault,
    getSettings: () => settings,
    indexing: {} as IndexingOrchestrator,
    writeAssistantOutput: writeLog,
  });

  return { orch, vault, settings, writeLog };
}

// ── tests ────────────────────────────────────────────────────────────

describe("EnrichmentOrchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("handleModify", () => {
    it("ignores non-markdown files", () => {
      const { orch } = makeOrchestrator();
      orch.handleModify({ path: "image.png", mtime: Date.now() });
      expect(orch.queue.stats().pending).toBe(0);
    });

    it("ignores AI Copilot internal files", () => {
      const { orch } = makeOrchestrator();
      orch.handleModify({ path: "AI Copilot/log.md", mtime: Date.now() });
      expect(orch.queue.stats().pending).toBe(0);
    });

    it("ignores events when enrichment is disabled", () => {
      const { orch } = makeOrchestrator({ settings: { enrichmentEnabled: false } });
      orch.handleModify({ path: "notes/test.md", mtime: Date.now() });
      vi.advanceTimersByTime(10_000);
      expect(orch.queue.stats().pending).toBe(0);
    });

    it("enqueues enrichment after debounce delay", () => {
      const { orch, settings } = makeOrchestrator();
      orch.handleModify({ path: "notes/test.md", mtime: Date.now() });
      // Before debounce expires
      expect(orch.queue.stats().pending).toBe(0);
      // Advance past debounce
      vi.advanceTimersByTime(settings.enrichmentDebounceSec * 1000 + 100);
      expect(orch.queue.stats().pending + (orch.queue.stats().running ? 1 : 0)).toBeGreaterThanOrEqual(1);
    });

    it("debounces rapid saves — only one job after multiple events", () => {
      const { orch, settings } = makeOrchestrator();
      for (let i = 0; i < 5; i++) {
        orch.handleModify({ path: "notes/test.md", mtime: Date.now() + i });
      }
      vi.advanceTimersByTime(settings.enrichmentDebounceSec * 1000 + 100);
      const stats = orch.queue.stats();
      expect(stats.pending + stats.processed + (stats.running ? 1 : 0)).toBe(1);
    });

    it("handles separate notes independently", () => {
      const vault = new InMemoryVaultAdapter([
        { path: "a.md", content: "Note A", mtime: Date.now() },
        { path: "b.md", content: "Note B", mtime: Date.now() },
      ]);
      const { orch, settings } = makeOrchestrator({ vault });
      orch.handleModify({ path: "a.md", mtime: Date.now() });
      orch.handleModify({ path: "b.md", mtime: Date.now() });
      vi.advanceTimersByTime(settings.enrichmentDebounceSec * 1000 + 100);
      const stats = orch.queue.stats();
      expect(stats.pending + stats.processed + (stats.running ? 1 : 0)).toBeGreaterThanOrEqual(2);
    });
  });

  describe("runEnrichmentForNote (via queue)", () => {
    it("transitions note to analyzing then back to unenriched when LLM returns no edits", async () => {
      const { orch, vault, settings } = makeOrchestrator();
      vi.useRealTimers();

      orch.handleModify({ path: "notes/test.md", mtime: Date.now() });

      // Wait for debounce and processing
      await new Promise((r) => setTimeout(r, settings.enrichmentDebounceSec * 1000 + 500));
      await new Promise((r) => setTimeout(r, 200));

      const state = await loadEnrichmentState(vault, "notes/test.md");
      expect(state.state).toBe("unenriched");
    });

    it("skips notes that no longer exist", async () => {
      const vault = new InMemoryVaultAdapter();
      const { orch } = makeOrchestrator({ vault });
      vi.useRealTimers();

      orch.handleModify({ path: "deleted.md", mtime: Date.now() });
      await new Promise((r) => setTimeout(r, 1500));

      expect(orch.queue.stats().failed).toBe(0);
    });

    it("does not re-enrich notes already in non-unenriched state", async () => {
      const noteContent = "# Test";
      const vault = new InMemoryVaultAdapter([
        { path: "notes/test.md", content: noteContent, mtime: Date.now() },
      ]);
      const { orch } = makeOrchestrator({ vault });
      vi.useRealTimers();

      const { transitionEnrichmentState, computeContentHash } = await import("../src/enrichment-state");
      const contentHash = await computeContentHash(noteContent);
      await transitionEnrichmentState(vault, "notes/test.md", "analyzing", { runId: "r1", contentHash });
      await transitionEnrichmentState(vault, "notes/test.md", "suggested", {});

      orch.handleModify({ path: "notes/test.md", mtime: Date.now() });
      await new Promise((r) => setTimeout(r, 1500));
      await new Promise((r) => setTimeout(r, 200));

      const state = await loadEnrichmentState(vault, "notes/test.md");
      expect(state.state).toBe("suggested");
    });
  });

  describe("dispose", () => {
    it("clears all debounce timers", () => {
      const { orch } = makeOrchestrator();
      orch.handleModify({ path: "notes/test.md", mtime: Date.now() });
      orch.dispose();
      vi.advanceTimersByTime(10_000);
      expect(orch.queue.stats().pending).toBe(0);
    });
  });
});
