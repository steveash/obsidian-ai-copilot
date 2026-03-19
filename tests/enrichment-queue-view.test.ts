import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryVaultAdapter, type VaultNote } from "../src/vault-adapter";
import {
  transitionEnrichmentState,
  computeContentHash,
  loadEnrichmentState,
  type EnrichmentStateRecord,
} from "../src/enrichment-state";
import type { PatchPlan } from "../src/patch-plan";

// ── helpers ──────────────────────────────────────────────────────────

async function setupVaultWithNote(
  content = "Hello world",
  notePath = "test.md"
): Promise<InMemoryVaultAdapter> {
  const vault = new InMemoryVaultAdapter([
    { path: notePath, content, mtime: Date.now() },
  ]);
  return vault;
}

async function transitionToState(
  vault: InMemoryVaultAdapter,
  notePath: string,
  targetState: "suggested" | "human-required" | "auto-enriched",
  plan?: PatchPlan
) {
  const content = await vault.read(notePath);
  const contentHash = await computeContentHash(content);

  // unenriched → analyzing
  await transitionEnrichmentState(vault, notePath, "analyzing", {
    runId: "test-run",
    contentHash,
  });

  // analyzing → target state
  await transitionEnrichmentState(vault, notePath, targetState, {
    avgConfidence: 0.7,
    triggers: targetState === "human-required" ? ["low-confidence"] : [],
    pendingPlan: plan ?? {
      path: notePath,
      edits: [{ find: "Hello", replace: "Hi", reason: "greeting style" }],
    },
    model: "test-model",
    contextNotes: [],
  });
}

// ── state transition tests for accept/reject flows ───────────────────

describe("enrichment queue accept flow", () => {
  let vault: InMemoryVaultAdapter;

  beforeEach(async () => {
    vault = await setupVaultWithNote("Hello world");
    await transitionToState(vault, "test.md", "suggested");
  });

  it("accept transitions suggested → approved → applied → unenriched", async () => {
    const record = await loadEnrichmentState(vault, "test.md");
    expect(record.state).toBe("suggested");

    // Simulate accept: transition to approved
    await transitionEnrichmentState(vault, "test.md", "approved", {
      editDecisions: { 0: "approved" },
    });
    const approved = await loadEnrichmentState(vault, "test.md");
    expect(approved.state).toBe("approved");

    // Apply the patch
    const content = await vault.read("test.md");
    const plan = record.pendingPlan as PatchPlan;
    const { applyPatchPlan } = await import("../src/patch-plan");
    const result = applyPatchPlan(content, plan);
    expect(result.transactions.some((t) => t.applied)).toBe(true);
    await vault.modify("test.md", result.finalContent);

    // Verify content was modified
    const updated = await vault.read("test.md");
    expect(updated).toBe("Hi world");

    // Transition to applied
    await transitionEnrichmentState(vault, "test.md", "applied", {
      preApplySnapshot: content,
    });
    const applied = await loadEnrichmentState(vault, "test.md");
    expect(applied.state).toBe("applied");

    // Transition to unenriched (cycle complete)
    await transitionEnrichmentState(vault, "test.md", "unenriched", {
      pendingPlan: null,
      editDecisions: null,
      preApplySnapshot: null,
      triggers: [],
    });
    const final = await loadEnrichmentState(vault, "test.md");
    expect(final.state).toBe("unenriched");
    expect(final.pendingPlan).toBeNull();
  });

  it("accept from human-required transitions via suggested first", async () => {
    const hrVault = await setupVaultWithNote("Hello world", "hr-note.md");
    await transitionToState(hrVault, "hr-note.md", "human-required");

    const record = await loadEnrichmentState(hrVault, "hr-note.md");
    expect(record.state).toBe("human-required");
    expect(record.triggers).toContain("low-confidence");

    // human-required can go to suggested (re-classify after review)
    // or directly to rejected. For accept, we go human-required → suggested → approved
    // But the view does: human-required → rejected directly, or
    // we can check: human-required allows "suggested" transition
    await transitionEnrichmentState(hrVault, "hr-note.md", "suggested", {});
    const suggested = await loadEnrichmentState(hrVault, "hr-note.md");
    expect(suggested.state).toBe("suggested");
  });
});

describe("enrichment queue reject flow", () => {
  let vault: InMemoryVaultAdapter;

  beforeEach(async () => {
    vault = await setupVaultWithNote("Hello world");
    await transitionToState(vault, "test.md", "suggested");
  });

  it("reject transitions suggested → rejected → unenriched", async () => {
    // Transition to rejected
    await transitionEnrichmentState(vault, "test.md", "rejected", {
      editDecisions: { 0: "rejected" },
    });
    const rejected = await loadEnrichmentState(vault, "test.md");
    expect(rejected.state).toBe("rejected");

    // Transition to unenriched
    await transitionEnrichmentState(vault, "test.md", "unenriched", {
      pendingPlan: null,
      editDecisions: null,
      preApplySnapshot: null,
      triggers: [],
    });
    const final = await loadEnrichmentState(vault, "test.md");
    expect(final.state).toBe("unenriched");
  });

  it("reject from human-required transitions directly", async () => {
    const hrVault = await setupVaultWithNote("Hello world", "hr-note.md");
    await transitionToState(hrVault, "hr-note.md", "human-required");

    await transitionEnrichmentState(hrVault, "hr-note.md", "rejected", {
      editDecisions: { 0: "rejected" },
    });
    const rejected = await loadEnrichmentState(hrVault, "hr-note.md");
    expect(rejected.state).toBe("rejected");

    // Content should be unchanged
    const content = await hrVault.read("hr-note.md");
    expect(content).toBe("Hello world");
  });
});

describe("enrichment queue record loading", () => {
  it("loads records in actionable states", async () => {
    const vault = await setupVaultWithNote("Hello world", "note1.md");
    // Create a second note
    await vault.create("note2.md", "Second note");
    await vault.create("note3.md", "Third note");

    await transitionToState(vault, "note1.md", "suggested");
    await transitionToState(vault, "note2.md", "human-required");

    // note3 stays unenriched — should not appear in queue

    const mdFiles = vault.listMarkdownFiles().filter(
      (f) => !f.path.startsWith("AI Copilot/")
    );

    const records: EnrichmentStateRecord[] = [];
    for (const file of mdFiles) {
      const record = await loadEnrichmentState(vault, file.path);
      if (
        record.state === "suggested" ||
        record.state === "human-required" ||
        record.state === "auto-enriched"
      ) {
        records.push(record);
      }
    }

    expect(records.length).toBe(2);
    const states = records.map((r) => r.state).sort();
    expect(states).toEqual(["human-required", "suggested"]);
  });

  it("counts pending items correctly", async () => {
    const vault = await setupVaultWithNote("Hello world", "note1.md");
    await vault.create("note2.md", "Second");

    await transitionToState(vault, "note1.md", "suggested");
    await transitionToState(vault, "note2.md", "auto-enriched", {
      path: "note2.md",
      edits: [{ find: "Second", replace: "2nd", reason: "abbreviation" }],
    });

    const mdFiles = vault.listMarkdownFiles().filter(
      (f) => !f.path.startsWith("AI Copilot/")
    );

    const records: EnrichmentStateRecord[] = [];
    for (const file of mdFiles) {
      const record = await loadEnrichmentState(vault, file.path);
      if (
        record.state === "suggested" ||
        record.state === "human-required" ||
        record.state === "auto-enriched"
      ) {
        records.push(record);
      }
    }

    const pendingCount = records.filter(
      (r) => r.state === "suggested" || r.state === "human-required"
    ).length;

    // note1 is suggested (pending), note2 is auto-enriched (not pending)
    expect(pendingCount).toBe(1);
    expect(records.length).toBe(2);
  });
});
