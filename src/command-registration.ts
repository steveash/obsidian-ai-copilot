import { type App, type Command, Notice, TFile } from "obsidian";
import { toMarkdownPlan, buildRefinementPlan } from "./planner";
import { buildRefinementPrompt } from "./refinement";
import type { PatchTransaction } from "./patcher";
import { buildClient } from "./llm";
import type { ChatOrchestrator } from "./chat-orchestrator";
import type { IndexingOrchestrator } from "./indexing-orchestrator";
import type { AICopilotSettings } from "./settings";
import { buildPatchPlanSystemPrompt } from "./patch-plan-parser";
import {
  buildRefinementPreview,
  applyRefinementDecision,
  buildSafeAutoApplyDecision,
  buildRollbackContents,
  toMarkdownRefinementPreview,
  type SmartRefinementSnapshot
} from "./smart-refinement";

export interface CommandContext {
  addCommand: (command: Command) => void;
  app: App;
  getSettings: () => AICopilotSettings;
  setLastPatchState: (transactions: PatchTransaction[], path: string) => void;
  clearLastPatchState: () => void;
  getLastPatchState: () => { transactions: PatchTransaction[]; path: string | null };
  setLastRefinementSnapshot: (snapshot: SmartRefinementSnapshot) => void;
  clearLastRefinementSnapshot: () => void;
  getLastRefinementSnapshot: () => SmartRefinementSnapshot | null;
  writeAssistantOutput: (name: string, body: string) => Promise<void>;
  runRefinementPass: () => Promise<void>;
}

export function registerPluginCommands(
  ctx: CommandContext,
  chat: ChatOrchestrator,
  indexing: IndexingOrchestrator
) {
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
      if (!file) return void new Notice("No active note selected.");
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
      new Notice(`AI Copilot: rebuilt vector index for ${count} notes.`);
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
      if (!file) return void new Notice("No active note selected.");
      const content = await ctx.app.vault.read(file);
      const settings = ctx.getSettings();

      new Notice("AI Copilot: generating refinement preview…");
      const candidates = [{ path: file.path, content }];
      const prompt = buildRefinementPrompt(candidates, {
        enableWebEnrichment: settings.enableWebEnrichment
      });
      const plan = buildRefinementPlan(candidates);
      const llmOutput = await buildClient(settings).chat(
        `${toMarkdownPlan(plan)}\n\n${prompt}`,
        buildPatchPlanSystemPrompt()
      );

      const fileContents = new Map([[file.path, content]]);
      const preview = buildRefinementPreview(llmOutput, fileContents, candidates);
      const md = toMarkdownRefinementPreview(preview);
      await ctx.writeAssistantOutput("Refinement Log", md);

      const editCount = preview.singleFilePreviews.reduce(
        (sum, p) => sum + p.preview.summary.totalEdits, 0
      );
      new Notice(`AI Copilot: preview logged — ${editCount} edit(s) proposed.`);
    }
  });

  ctx.addCommand({
    id: "ai-copilot-smart-apply-safe",
    name: "AI Copilot: Auto-apply safe refinement edits",
    callback: async () => {
      const file = ctx.app.workspace.getActiveFile();
      if (!file) return void new Notice("No active note selected.");
      const content = await ctx.app.vault.read(file);
      const settings = ctx.getSettings();

      new Notice("AI Copilot: analyzing note for safe edits…");
      const candidates = [{ path: file.path, content }];
      const prompt = buildRefinementPrompt(candidates, {
        enableWebEnrichment: settings.enableWebEnrichment
      });
      const plan = buildRefinementPlan(candidates);
      const llmOutput = await buildClient(settings).chat(
        `${toMarkdownPlan(plan)}\n\n${prompt}`,
        buildPatchPlanSystemPrompt()
      );

      const fileContents = new Map([[file.path, content]]);
      const preview = buildRefinementPreview(llmOutput, fileContents, candidates);
      const decision = buildSafeAutoApplyDecision(preview);

      const totalSafe = (decision.singleFileSelections ?? []).reduce(
        (sum, s) => sum + (s.selectedEditIndices?.length ?? 0), 0
      );

      if (totalSafe === 0) {
        await ctx.writeAssistantOutput("Refinement Log", toMarkdownRefinementPreview(preview));
        return void new Notice("AI Copilot: no safe edits to apply. Preview logged.");
      }

      const { result, snapshot } = applyRefinementDecision(preview, decision, fileContents);

      for (const sr of result.singleFileResults) {
        if (sr.applied.transactions.some((t) => t.applied)) {
          const f = ctx.app.vault.getAbstractFileByPath(sr.path);
          if (f instanceof TFile) await ctx.app.vault.modify(f, sr.applied.finalContent);
        }
      }

      ctx.setLastRefinementSnapshot(snapshot);
      await ctx.writeAssistantOutput("Refinement Log",
        `## Smart Apply (safe only)\n${result.summary}\n\n${toMarkdownRefinementPreview(preview)}`
      );
      new Notice(`AI Copilot: applied ${totalSafe} safe edit(s).`);
    }
  });

  ctx.addCommand({
    id: "ai-copilot-rollback-smart-refinement",
    name: "AI Copilot: Roll back last smart refinement",
    callback: async () => {
      const snapshot = ctx.getLastRefinementSnapshot();
      if (!snapshot) return void new Notice("No smart refinement snapshot available for rollback.");

      const rollbackContents = buildRollbackContents(snapshot);
      let restored = 0;
      for (const [path, original] of rollbackContents) {
        const f = ctx.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) {
          await ctx.app.vault.modify(f, original);
          restored++;
        }
      }

      ctx.clearLastRefinementSnapshot();
      new Notice(`AI Copilot: rolled back ${restored} file(s) to pre-refinement state.`);
    }
  });

  ctx.addCommand({
    id: "ai-copilot-rollback-last-refinement-patch",
    name: "AI Copilot: Roll back last refinement patch",
    callback: async () => {
      const { transactions, path } = ctx.getLastPatchState();
      if (!transactions.length || !path) {
        return void new Notice("No patch transaction available for rollback.");
      }
      const file = ctx.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return void new Notice("Original note not found for rollback.");
      const current = await ctx.app.vault.read(file);
      const { rollbackPatchPlan } = await import("./patch-plan");
      const rolled = rollbackPatchPlan(current, transactions);
      await ctx.app.vault.modify(file, rolled);
      ctx.clearLastPatchState();
      new Notice("AI Copilot: rolled back last structured patch.");
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
      ].join(" · ");
      await ctx.writeAssistantOutput("Refinement Log", `## Indexing Queue Diagnostics\n${summary}`);
      new Notice(`AI Copilot indexing: ${summary}`);
    }
  });
}

export async function runRefinementFlow(
  candidates: Array<{ path: string; content: string }>,
  settings: AICopilotSettings,
  setLastPatchState: (transactions: PatchTransaction[], path: string) => void,
  app: App,
  writeAssistantOutput: (name: string, body: string) => Promise<void>,
  setLastRefinementSnapshot?: (snapshot: SmartRefinementSnapshot) => void
) {
  if (!candidates.length) return void new Notice("AI Copilot: no recent notes to refine.");

  const plan = buildRefinementPlan(candidates);
  const prompt = buildRefinementPrompt(candidates, {
    enableWebEnrichment: settings.enableWebEnrichment
  });
  const output = await buildClient(settings).chat(
    `${toMarkdownPlan(plan)}\n\n${prompt}`,
    buildPatchPlanSystemPrompt()
  );

  const fileContents = new Map(candidates.map((c) => [c.path, c.content]));
  const preview = buildRefinementPreview(output, fileContents, candidates);

  if (settings.refinementAutoApply) {
    const decision = buildSafeAutoApplyDecision(preview);
    const totalSafe = (decision.singleFileSelections ?? []).reduce(
      (sum, s) => sum + (s.selectedEditIndices?.length ?? 0), 0
    );

    if (totalSafe > 0) {
      const { result, snapshot } = applyRefinementDecision(preview, decision, fileContents);

      for (const sr of result.singleFileResults) {
        if (sr.applied.transactions.some((t) => t.applied)) {
          const file = app.vault.getAbstractFileByPath(sr.path);
          if (file instanceof TFile) {
            await app.vault.modify(file, sr.applied.finalContent);
            // Also set legacy patch state for backward compat rollback
            setLastPatchState(sr.applied.transactions, sr.path);
          }
        }
      }

      if (setLastRefinementSnapshot) setLastRefinementSnapshot(snapshot);
    }
  }

  const md = toMarkdownRefinementPreview(preview);
  new Notice(`AI Copilot: scanned ${candidates.length} notes · TODOs ${preview.todoCount}`);
  await writeAssistantOutput("Refinement Log", `${toMarkdownPlan(plan)}\n\n${md}\n\n## Raw LLM Output\n${output}`);
}
