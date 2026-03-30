import { BackgroundIndexingQueue } from "./indexing-queue";
import {
  invalidateIfContentChanged,
  transitionEnrichmentState,
  classifyEnrichmentResult,
  computeContentHash,
  loadEnrichmentState,
  type ClassifyEnrichmentInput,
} from "./enrichment-state";
import type { VaultAdapter, VaultEventRef, VaultFile } from "./vault-adapter";
import type { AICopilotSettings } from "./settings";
import type { IndexingOrchestrator } from "./indexing-orchestrator";
import { buildRefinementPlan, toMarkdownPlan } from "./planner";
import { buildRefinementPrompt } from "./refinement";
import { buildClient } from "./llm-adapter";
import { buildPatchPlanSystemPrompt } from "./patch-plan-parser";
import {
  buildRefinementPreview,
  buildSafeAutoApplyDecision,
  applyRefinementDecision,
  toMarkdownRefinementPreview,
} from "./smart-refinement";

export interface EnrichmentOrchestratorDeps {
  vault: VaultAdapter;
  getSettings: () => AICopilotSettings;
  indexing: IndexingOrchestrator;
  writeAssistantOutput: (name: string, body: string) => Promise<void>;
}

export class EnrichmentOrchestrator {
  readonly queue = new BackgroundIndexingQueue();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly vault: VaultAdapter;
  private readonly getSettings: () => AICopilotSettings;
  private readonly indexing: IndexingOrchestrator;
  private readonly writeAssistantOutput: (name: string, body: string) => Promise<void>;

  constructor(deps: EnrichmentOrchestratorDeps) {
    this.vault = deps.vault;
    this.getSettings = deps.getSettings;
    this.indexing = deps.indexing;
    this.writeAssistantOutput = deps.writeAssistantOutput;
  }

  registerVaultEvents(registerEvent: (evt: VaultEventRef) => void) {
    registerEvent(
      this.vault.on("modify", (file) => {
        this.handleModify(file);
      })
    );
  }

  /** Visible for testing — handle a modify event with debounce + enqueue. */
  handleModify(file: VaultFile) {
    if (!file.path.endsWith(".md")) return;
    if (file.path.startsWith("AI Copilot/")) return;

    const settings = this.getSettings();
    if (!settings.enrichmentEnabled) return;

    const existing = this.debounceTimers.get(file.path);
    if (existing) clearTimeout(existing);

    const delayMs = Math.max(1, settings.enrichmentDebounceSec) * 1000;
    const timer = setTimeout(() => {
      this.debounceTimers.delete(file.path);
      this.enqueueEnrichment(file.path);
    }, delayMs);

    this.debounceTimers.set(file.path, timer);
  }

  private enqueueEnrichment(notePath: string) {
    this.queue.enqueue(async () => {
      await this.runEnrichmentForNote(notePath);
    });
  }

  /** Run the full enrichment pipeline for a single note. */
  private async runEnrichmentForNote(notePath: string): Promise<void> {
    const settings = this.getSettings();

    if (!this.vault.exists(notePath)) return;
    const content = await this.vault.read(notePath);

    // Step 1: Invalidate stale enrichment state if content changed
    if (settings.enrichmentPersistState) {
      await invalidateIfContentChanged(this.vault, notePath, content);
    }

    // Step 2: Check current state — only enrich unenriched notes
    const currentState = await loadEnrichmentState(this.vault, notePath);
    if (currentState.state !== "unenriched") return;

    // Step 3: Transition to analyzing
    const runId = `enrich-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const contentHash = await computeContentHash(content);
    await transitionEnrichmentState(this.vault, notePath, "analyzing", {
      runId,
      contentHash,
    });

    try {
      // Step 4: Run refinement planner for this note
      const candidates = [{ path: notePath, content }];
      const plan = buildRefinementPlan(candidates);
      const prompt = buildRefinementPrompt(candidates, {
        enableWebEnrichment: settings.enableWebEnrichment,
      });
      const llmOutput = await buildClient(settings).chat(
        `${toMarkdownPlan(plan)}\n\n${prompt}`,
        buildPatchPlanSystemPrompt()
      );

      // Step 5: Build preview and classify result
      const fileContents = new Map([[notePath, content]]);
      const preview = buildRefinementPreview(llmOutput, fileContents, candidates);

      const singlePreview = preview.singleFilePreviews.find((p) => p.plan.path === notePath);
      if (!singlePreview || singlePreview.plan.edits.length === 0) {
        // No edits generated — transition back to unenriched
        await transitionEnrichmentState(this.vault, notePath, "unenriched", {});
        return;
      }

      const edits = singlePreview.plan.edits as import("./patch-plan").PatchPlanEditV2[];
      const patchPreview = singlePreview.preview;
      const conflicts = singlePreview.conflicts;

      const classifyInput: ClassifyEnrichmentInput = {
        edits,
        originalContent: content,
        preview: patchPreview,
        conflicts,
        autoApplyEnabled: settings.refinementAutoApply,
        thresholds: {
          confidenceThreshold: settings.enrichmentConfidenceThreshold,
          destructiveRewriteThreshold: settings.enrichmentDestructiveRewriteThreshold,
        },
      };
      const classification = classifyEnrichmentResult(classifyInput);

      // Step 6: Apply result based on classification
      if (classification.state === "unenriched") {
        await transitionEnrichmentState(this.vault, notePath, "unenriched", {});
        return;
      }

      if (classification.state === "auto-enriched") {
        // Auto-apply safe edits
        const decision = buildSafeAutoApplyDecision(preview);
        const { result } = applyRefinementDecision(preview, decision, fileContents);

        for (const sr of result.singleFileResults) {
          if (sr.applied.transactions.some((t) => t.applied)) {
            await this.vault.modify(sr.path, sr.applied.finalContent);
          }
        }

        await transitionEnrichmentState(this.vault, notePath, "auto-enriched", {
          avgConfidence: classification.avgConfidence,
          pendingPlan: null,
          model: this.getActiveModel(settings),
          contextNotes: [],
        });

        await this.writeAssistantOutput(
          "Enrichment Log",
          `## Auto-enriched: ${notePath}\n${toMarkdownRefinementPreview(preview)}`
        );
      } else {
        // "suggested" or "human-required" — store pending plan for review
        await transitionEnrichmentState(this.vault, notePath, classification.state, {
          avgConfidence: classification.avgConfidence,
          triggers: classification.triggers,
          pendingPlan: singlePreview.plan,
          model: this.getActiveModel(settings),
          contextNotes: [],
        });

        await this.writeAssistantOutput(
          "Enrichment Log",
          `## ${classification.state}: ${notePath}\n${toMarkdownRefinementPreview(preview)}`
        );
      }
    } catch (err) {
      // On error, transition back to unenriched so it can be retried
      try {
        await transitionEnrichmentState(this.vault, notePath, "unenriched", {});
      } catch {
        // Ignore transition errors during error recovery
      }
      console.error(`AI Copilot enrichment failed for ${notePath}:`, err);
    }
  }

  private getActiveModel(settings: AICopilotSettings): string {
    switch (settings.provider) {
      case "openai":
        return settings.openaiModel;
      case "anthropic":
        return settings.anthropicModel;
      case "bedrock":
        return settings.bedrockModel;
      default:
        return "none";
    }
  }

  dispose() {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
