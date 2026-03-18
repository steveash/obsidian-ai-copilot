import { describe, expect, it, beforeEach } from "vitest";
import {
  isValidTransition,
  computeContentHash,
  enrichmentStatePath,
  loadEnrichmentState,
  transitionEnrichmentState,
  evaluateInterventionTriggers,
  classifyEnrichmentResult,
  invalidateIfContentChanged,
  DEFAULT_ENRICHMENT_THRESHOLDS,
  type EnrichmentState,
  type EnrichmentStateRecord,
  type TriggerEvaluationInput,
} from "../src/enrichment-state";
import { InMemoryVaultAdapter, type VaultNote } from "../src/vault-adapter";
import type { PatchPlanEditV2, PatchPlanPreview, ConflictInfo } from "../src/patch-plan";

// ── helpers ──────────────────────────────────────────────────────────

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

function makeTriggerInput(overrides: Partial<TriggerEvaluationInput> = {}): TriggerEvaluationInput {
  const edits = overrides.edits ?? makeEdits([{ confidence: 0.9 }]);
  return {
    edits,
    originalContent: "Some original content that is long enough for ratio calculations to work properly.",
    preview: makePreview(edits),
    conflicts: [],
    ...overrides,
  };
}

// ── isValidTransition ────────────────────────────────────────────────

describe("isValidTransition", () => {
  const validTransitions: [EnrichmentState, EnrichmentState][] = [
    ["unenriched", "analyzing"],
    ["analyzing", "auto-enriched"],
    ["analyzing", "suggested"],
    ["analyzing", "human-required"],
    ["analyzing", "unenriched"],
    ["auto-enriched", "unenriched"],
    ["suggested", "approved"],
    ["suggested", "rejected"],
    ["suggested", "human-required"],
    ["suggested", "unenriched"],
    ["human-required", "suggested"],
    ["human-required", "rejected"],
    ["human-required", "unenriched"],
    ["approved", "applied"],
    ["approved", "unenriched"],
    ["applied", "unenriched"],
    ["rejected", "unenriched"],
  ];

  for (const [from, to] of validTransitions) {
    it(`allows ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(true);
    });
  }

  const invalidTransitions: [EnrichmentState, EnrichmentState][] = [
    ["unenriched", "approved"],
    ["unenriched", "applied"],
    ["unenriched", "rejected"],
    ["unenriched", "suggested"],
    ["unenriched", "human-required"],
    ["analyzing", "approved"],
    ["analyzing", "applied"],
    ["analyzing", "rejected"],
    ["auto-enriched", "suggested"],
    ["auto-enriched", "approved"],
    ["suggested", "applied"],
    ["suggested", "auto-enriched"],
    ["human-required", "approved"],
    ["human-required", "applied"],
    ["human-required", "auto-enriched"],
    ["approved", "suggested"],
    ["approved", "rejected"],
    ["applied", "approved"],
    ["applied", "suggested"],
    ["rejected", "approved"],
    ["rejected", "suggested"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`rejects ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  }
});

// ── computeContentHash ──────────────────────────────────────────────

describe("computeContentHash", () => {
  it("returns a hex string", async () => {
    const hash = await computeContentHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for the same input", async () => {
    const h1 = await computeContentHash("test content");
    const h2 = await computeContentHash("test content");
    expect(h1).toBe(h2);
  });

  it("returns different hashes for different inputs", async () => {
    const h1 = await computeContentHash("content A");
    const h2 = await computeContentHash("content B");
    expect(h1).not.toBe(h2);
  });
});

// ── enrichmentStatePath ─────────────────────────────────────────────

describe("enrichmentStatePath", () => {
  it("returns a path under AI Copilot/.enrichment/", async () => {
    const path = await enrichmentStatePath("notes/my-note.md");
    expect(path).toMatch(/^AI Copilot\/\.enrichment\/[0-9a-f]{8}-.*\.json$/);
  });

  it("strips .md extension from slug", async () => {
    const path = await enrichmentStatePath("daily/2026-03-18.md");
    expect(path).not.toContain(".md-");
    expect(path).toContain("2026-03-18");
  });

  it("returns different paths for different notes", async () => {
    const p1 = await enrichmentStatePath("a.md");
    const p2 = await enrichmentStatePath("b.md");
    expect(p1).not.toBe(p2);
  });

  it("returns the same path for the same note", async () => {
    const p1 = await enrichmentStatePath("notes/test.md");
    const p2 = await enrichmentStatePath("notes/test.md");
    expect(p1).toBe(p2);
  });
});

// ── loadEnrichmentState ─────────────────────────────────────────────

describe("loadEnrichmentState", () => {
  it("returns default unenriched state when no sidecar exists", async () => {
    const vault = new InMemoryVaultAdapter();
    const state = await loadEnrichmentState(vault, "test.md");
    expect(state.state).toBe("unenriched");
    expect(state.notePath).toBe("test.md");
    expect(state.version).toBe(1);
  });

  it("loads existing state from sidecar file", async () => {
    const vault = new InMemoryVaultAdapter();
    const record: EnrichmentStateRecord = {
      version: 1,
      notePath: "test.md",
      contentHash: "abc123",
      state: "suggested",
      updatedAt: "2026-03-18T00:00:00.000Z",
      runId: "run-1",
      triggers: [],
      pendingPlan: null,
      editDecisions: null,
      preApplySnapshot: null,
      model: "claude-sonnet-4-6",
      avgConfidence: 0.85,
      contextNotes: ["other.md"],
    };
    const path = await enrichmentStatePath("test.md");
    // Create parent directory
    await vault.createFolder("AI Copilot/.enrichment");
    await vault.create(path, JSON.stringify(record));

    const loaded = await loadEnrichmentState(vault, "test.md");
    expect(loaded.state).toBe("suggested");
    expect(loaded.runId).toBe("run-1");
    expect(loaded.model).toBe("claude-sonnet-4-6");
  });

  it("returns default state on corrupted JSON", async () => {
    const vault = new InMemoryVaultAdapter();
    const path = await enrichmentStatePath("test.md");
    await vault.createFolder("AI Copilot/.enrichment");
    await vault.create(path, "not valid json {{{");

    const loaded = await loadEnrichmentState(vault, "test.md");
    expect(loaded.state).toBe("unenriched");
  });
});

// ── transitionEnrichmentState ───────────────────────────────────────

describe("transitionEnrichmentState", () => {
  let vault: InMemoryVaultAdapter;

  beforeEach(() => {
    vault = new InMemoryVaultAdapter();
  });

  it("transitions from unenriched to analyzing", async () => {
    const result = await transitionEnrichmentState(vault, "test.md", "analyzing", {
      runId: "run-1",
      contentHash: "hash-abc",
    });
    expect(result.state).toBe("analyzing");
    expect(result.runId).toBe("run-1");
  });

  it("persists state to sidecar file", async () => {
    await transitionEnrichmentState(vault, "test.md", "analyzing", {
      runId: "run-1",
    });
    const path = await enrichmentStatePath("test.md");
    const raw = await vault.read(path);
    const parsed = JSON.parse(raw);
    expect(parsed.state).toBe("analyzing");
  });

  it("rejects invalid transitions", async () => {
    await expect(
      transitionEnrichmentState(vault, "test.md", "approved", {})
    ).rejects.toThrow("Invalid enrichment transition: unenriched → approved");
  });

  it("supports multi-step transitions", async () => {
    await transitionEnrichmentState(vault, "test.md", "analyzing", { runId: "r1" });
    await transitionEnrichmentState(vault, "test.md", "suggested", {});
    await transitionEnrichmentState(vault, "test.md", "approved", {});
    const result = await transitionEnrichmentState(vault, "test.md", "applied", {});
    expect(result.state).toBe("applied");
  });

  it("can transition applied back to unenriched (invalidation)", async () => {
    await transitionEnrichmentState(vault, "test.md", "analyzing", {});
    await transitionEnrichmentState(vault, "test.md", "auto-enriched", {});
    const result = await transitionEnrichmentState(vault, "test.md", "unenriched", {
      pendingPlan: null,
      triggers: [],
    });
    expect(result.state).toBe("unenriched");
  });

  it("sets updatedAt as ISO timestamp on transition", async () => {
    const before = new Date().toISOString();
    const r1 = await transitionEnrichmentState(vault, "test.md", "analyzing", {});
    expect(r1.updatedAt).toBeDefined();
    expect(new Date(r1.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});

// ── evaluateInterventionTriggers ────────────────────────────────────

describe("evaluateInterventionTriggers", () => {
  it("returns empty for safe edits", () => {
    const triggers = evaluateInterventionTriggers(makeTriggerInput());
    expect(triggers).toEqual([]);
  });

  it("triggers low-confidence when avg < threshold", () => {
    const edits = makeEdits([{ confidence: 0.3 }, { confidence: 0.4 }]);
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ edits, preview: makePreview(edits) })
    );
    expect(triggers).toContain("low-confidence");
  });

  it("does not trigger low-confidence when avg >= threshold", () => {
    const edits = makeEdits([{ confidence: 0.7 }, { confidence: 0.8 }]);
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ edits, preview: makePreview(edits) })
    );
    expect(triggers).not.toContain("low-confidence");
  });

  it("triggers conflicting-evidence from parse flags", () => {
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ parseFlags: ["conflicting-evidence"] })
    );
    expect(triggers).toContain("conflicting-evidence");
  });

  it("triggers ambiguous-intent from parse flags", () => {
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ parseFlags: ["ambiguous-intent"] })
    );
    expect(triggers).toContain("ambiguous-intent");
  });

  it("triggers destructive-rewrite when change ratio > threshold", () => {
    // Original content is short, edits replace most of it
    const edits = makeEdits([{ find: "This is my entire note content that I wrote" }]);
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({
        edits,
        originalContent: "This is my entire note content that I wrote",
        preview: makePreview(edits),
      })
    );
    expect(triggers).toContain("destructive-rewrite");
  });

  it("does not trigger destructive-rewrite for small changes", () => {
    const edits = makeEdits([{ find: "old" }]);
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({
        edits,
        originalContent: "This is a very long note with lots of content. The old text is just a small part of it all and should not trigger the threshold.",
        preview: makePreview(edits),
      })
    );
    expect(triggers).not.toContain("destructive-rewrite");
  });

  it("triggers safety-failure when preview has safety issues", () => {
    const edits = makeEdits([{}]);
    const preview = makePreview(edits, { safetyIssues: [["path protection: .obsidian/"]] });
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ edits, preview })
    );
    expect(triggers).toContain("safety-failure");
  });

  it("triggers all-conflicting when all edits conflict", () => {
    const edits = makeEdits([{}, {}]);
    const conflicts: ConflictInfo[] = [
      { editIndex: 0, reason: "test", find: "a", conflict: "stale", detail: "not found" },
      { editIndex: 1, reason: "test", find: "b", conflict: "stale", detail: "not found" },
    ];
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ edits, conflicts, preview: makePreview(edits) })
    );
    expect(triggers).toContain("all-conflicting");
  });

  it("does not trigger all-conflicting when some edits are clean", () => {
    const edits = makeEdits([{}, {}]);
    const conflicts: ConflictInfo[] = [
      { editIndex: 0, reason: "test", find: "a", conflict: "stale", detail: "not found" },
    ];
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ edits, conflicts, preview: makePreview(edits) })
    );
    expect(triggers).not.toContain("all-conflicting");
  });

  it("returns empty for empty edits array", () => {
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ edits: [], preview: makePreview([]) })
    );
    expect(triggers).toEqual([]);
  });

  it("supports custom thresholds", () => {
    const edits = makeEdits([{ confidence: 0.75 }]);
    // Default threshold 0.6 would NOT trigger, but 0.8 WILL
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({ edits, preview: makePreview(edits) }),
      { confidenceThreshold: 0.8, destructiveRewriteThreshold: 0.3 }
    );
    expect(triggers).toContain("low-confidence");
  });

  it("can trigger multiple triggers simultaneously", () => {
    const edits = makeEdits([{ confidence: 0.3, find: "This is the entire note" }]);
    const conflicts: ConflictInfo[] = [
      { editIndex: 0, reason: "test", find: "a", conflict: "stale", detail: "not found" },
    ];
    const preview = makePreview(edits, { safetyIssues: [["secret detected"]] });
    const triggers = evaluateInterventionTriggers(
      makeTriggerInput({
        edits,
        originalContent: "This is the entire note",
        preview,
        conflicts,
        parseFlags: ["conflicting-evidence", "ambiguous-intent"],
      })
    );
    expect(triggers).toContain("low-confidence");
    expect(triggers).toContain("conflicting-evidence");
    expect(triggers).toContain("ambiguous-intent");
    expect(triggers).toContain("destructive-rewrite");
    expect(triggers).toContain("safety-failure");
    expect(triggers).toContain("all-conflicting");
    expect(triggers).toHaveLength(6);
  });
});

// ── classifyEnrichmentResult ────────────────────────────────────────

describe("classifyEnrichmentResult", () => {
  it("returns unenriched when no edits", () => {
    const result = classifyEnrichmentResult({
      edits: [],
      originalContent: "content",
      preview: makePreview([]),
      conflicts: [],
      autoApplyEnabled: true,
    });
    expect(result.state).toBe("unenriched");
    expect(result.avgConfidence).toBeNull();
  });

  it("returns human-required when intervention triggers are met", () => {
    const edits = makeEdits([{ confidence: 0.3 }]);
    const result = classifyEnrichmentResult({
      edits,
      originalContent: "content",
      preview: makePreview(edits),
      conflicts: [],
      autoApplyEnabled: true,
    });
    expect(result.state).toBe("human-required");
    expect(result.triggers).toContain("low-confidence");
  });

  it("returns auto-enriched when all safe and auto-apply enabled", () => {
    const edits = makeEdits([
      { confidence: 0.95, risk: "safe" },
      { confidence: 0.85, risk: "safe" },
    ]);
    const result = classifyEnrichmentResult({
      edits,
      originalContent: "Long content that does not trigger destructive rewrite threshold at all because it is very long.",
      preview: makePreview(edits),
      conflicts: [],
      autoApplyEnabled: true,
    });
    expect(result.state).toBe("auto-enriched");
    expect(result.triggers).toEqual([]);
  });

  it("returns suggested when safe but auto-apply disabled", () => {
    const edits = makeEdits([{ confidence: 0.95, risk: "safe" }]);
    const result = classifyEnrichmentResult({
      edits,
      originalContent: "Long content that does not trigger destructive rewrite threshold at all because it is very long.",
      preview: makePreview(edits),
      conflicts: [],
      autoApplyEnabled: false,
    });
    expect(result.state).toBe("suggested");
  });

  it("returns suggested when some edits are not safe", () => {
    const edits = makeEdits([
      { confidence: 0.95, risk: "safe" },
      { confidence: 0.85, risk: "moderate" },
    ]);
    const result = classifyEnrichmentResult({
      edits,
      originalContent: "Long content that does not trigger destructive rewrite threshold at all because it is very long.",
      preview: makePreview(edits),
      conflicts: [],
      autoApplyEnabled: true,
    });
    expect(result.state).toBe("suggested");
  });

  it("returns suggested when confidence is below 0.8 but above intervention threshold", () => {
    const edits = makeEdits([{ confidence: 0.7, risk: "safe" }]);
    const result = classifyEnrichmentResult({
      edits,
      originalContent: "Long content that does not trigger destructive rewrite threshold at all because it is very long.",
      preview: makePreview(edits),
      conflicts: [],
      autoApplyEnabled: true,
    });
    expect(result.state).toBe("suggested");
  });

  it("populates avgConfidence", () => {
    const edits = makeEdits([{ confidence: 0.8 }, { confidence: 0.6 }]);
    const result = classifyEnrichmentResult({
      edits,
      originalContent: "Long content that does not trigger destructive rewrite threshold at all because it is very long.",
      preview: makePreview(edits),
      conflicts: [],
      autoApplyEnabled: true,
    });
    expect(result.avgConfidence).toBe(0.7);
  });
});

// ── invalidateIfContentChanged ──────────────────────────────────────

describe("invalidateIfContentChanged", () => {
  it("returns false for unenriched notes", async () => {
    const vault = new InMemoryVaultAdapter();
    const result = await invalidateIfContentChanged(vault, "test.md", "any content");
    expect(result).toBe(false);
  });

  it("returns false when content hash matches", async () => {
    const vault = new InMemoryVaultAdapter();
    const content = "original content";
    const hash = await computeContentHash(content);

    await transitionEnrichmentState(vault, "test.md", "analyzing", {
      contentHash: hash,
    });
    await transitionEnrichmentState(vault, "test.md", "suggested", {});

    const result = await invalidateIfContentChanged(vault, "test.md", content);
    expect(result).toBe(false);
  });

  it("invalidates when content hash differs", async () => {
    const vault = new InMemoryVaultAdapter();
    const originalHash = await computeContentHash("original content");

    await transitionEnrichmentState(vault, "test.md", "analyzing", {
      contentHash: originalHash,
    });
    await transitionEnrichmentState(vault, "test.md", "suggested", {
      pendingPlan: { path: "test.md", edits: [] },
    });

    const result = await invalidateIfContentChanged(vault, "test.md", "modified content");
    expect(result).toBe(true);

    const state = await loadEnrichmentState(vault, "test.md");
    expect(state.state).toBe("unenriched");
    expect(state.pendingPlan).toBeNull();
    expect(state.triggers).toEqual([]);
  });

  it("invalidates auto-enriched state on content change", async () => {
    const vault = new InMemoryVaultAdapter();
    const hash = await computeContentHash("original");

    await transitionEnrichmentState(vault, "test.md", "analyzing", { contentHash: hash });
    await transitionEnrichmentState(vault, "test.md", "auto-enriched", {});

    const result = await invalidateIfContentChanged(vault, "test.md", "edited by user");
    expect(result).toBe(true);

    const state = await loadEnrichmentState(vault, "test.md");
    expect(state.state).toBe("unenriched");
  });

  it("invalidates applied state on content change", async () => {
    const vault = new InMemoryVaultAdapter();
    const hash = await computeContentHash("original");

    await transitionEnrichmentState(vault, "test.md", "analyzing", { contentHash: hash });
    await transitionEnrichmentState(vault, "test.md", "suggested", {});
    await transitionEnrichmentState(vault, "test.md", "approved", {});
    await transitionEnrichmentState(vault, "test.md", "applied", {
      preApplySnapshot: "original",
    });

    const result = await invalidateIfContentChanged(vault, "test.md", "user edit after apply");
    expect(result).toBe(true);

    const state = await loadEnrichmentState(vault, "test.md");
    expect(state.state).toBe("unenriched");
    expect(state.preApplySnapshot).toBeNull();
  });
});
