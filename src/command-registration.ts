import { Notice, TFile } from "obsidian";
import { toMarkdownPlan } from "./planner";
import { buildRefinementPrompt, extractTodos } from "./refinement";
import { applyPatchSet, type PatchTransaction } from "./patcher";
import {
  applyPatchPlan,
  previewPatchPlan,
  toMarkdownPatchPlanPreview,
  validatePatchPlan,
  type PatchPlan
} from "./patch-plan";
import { buildClient } from "./llm";
import type { ChatOrchestrator } from "./chat-orchestrator";
import type { IndexingOrchestrator } from "./indexing-orchestrator";
import { buildRefinementPlan } from "./planner";

export interface CommandContext {
  addCommand: (command: any) => void;
  app: any;
  getSettings: () => any;
  setLastPatchState: (transactions: PatchTransaction[], path: string) => void;
  clearLastPatchState: () => void;
  getLastPatchState: () => { transactions: PatchTransaction[]; path: string | null };
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
      const plan: PatchPlan = {
        path: file.path,
        title: "Normalize common markdown spacing",
        edits: [
          { find: "  ", replace: " ", reason: "normalize spacing", replaceAll: true },
          { find: "\t", replace: "  ", reason: "replace tabs with spaces" }
        ]
      };

      const validation = validatePatchPlan(plan);
      if (!validation.valid) {
        return void new Notice(`Invalid patch plan: ${validation.issues.join("; ")}`);
      }

      const preview = previewPatchPlan(content, plan);
      await ctx.writeAssistantOutput("Refinement Log", toMarkdownPatchPlanPreview(preview));
      new Notice(`AI Copilot: patch preview logged (${preview.summary.appliedEdits}/${preview.summary.totalEdits} edits).`);
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
  settings: any,
  setLastPatchState: (transactions: PatchTransaction[], path: string) => void,
  app: any,
  writeAssistantOutput: (name: string, body: string) => Promise<void>
) {
  if (!candidates.length) return void new Notice("AI Copilot: no recent notes to refine.");

  const plan = buildRefinementPlan(candidates);
  const prompt = buildRefinementPrompt(candidates, {
    enableWebEnrichment: settings.enableWebEnrichment
  });
  const output = await buildClient(settings).chat(
    `${toMarkdownPlan(plan)}\n\n${prompt}`,
    "You refine markdown notes and preserve intent."
  );

  const todos = candidates.flatMap((n) => extractTodos(n.content));
  if (settings.refinementAutoApply && candidates[0]) {
    const c = candidates[0];
    const patchPlan: PatchPlan = {
      path: c.path,
      title: "Auto-normalize spacing",
      edits: [{ find: "  ", replace: " ", reason: "normalize spacing", replaceAll: true }]
    };

    if (validatePatchPlan(patchPlan).valid) {
      const applied = applyPatchPlan(c.content, patchPlan);
      if (applied.transactions.some((tx) => tx.applied)) {
        const file = app.vault.getAbstractFileByPath(c.path);
        if (file instanceof TFile) {
          await app.vault.modify(file, applied.finalContent);
          setLastPatchState(applied.transactions, c.path);
        }
      }
    } else {
      const { finalContent, transactions } = applyPatchSet(c.content, [
        {
          path: c.path,
          find: "  ",
          replace: " ",
          reason: "normalize spacing"
        }
      ]);
      if (transactions.some((tx) => tx.applied)) {
        const file = app.vault.getAbstractFileByPath(c.path);
        if (file instanceof TFile) {
          await app.vault.modify(file, finalContent);
          setLastPatchState(transactions, c.path);
        }
      }
    }
  }

  new Notice(`AI Copilot: scanned ${candidates.length} notes · TODOs ${todos.length}`);
  await writeAssistantOutput("Refinement Log", `${toMarkdownPlan(plan)}\n\n## LLM Output\n${output}`);
}
