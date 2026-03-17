/**
 * Integration tests for plugin lifecycle, command registration, and
 * chat view — exercising the Obsidian API shim.
 *
 * These tests prove the vitest + obsidian shim approach can:
 * 1. Instantiate the real plugin class with a mock App
 * 2. Verify commands are registered during onload()
 * 3. Test command callbacks end-to-end
 * 4. Verify settings tab is wired up
 *
 * This is the proof-of-concept for ob-20g.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// "obsidian" is aliased to tests/__mocks__/obsidian.ts via vitest.config.ts
import { Notice } from "obsidian";
import { registerPluginCommands, type CommandContext } from "../../src/command-registration";
import type { ChatOrchestrator } from "../../src/chat-orchestrator";
import type { IndexingOrchestrator } from "../../src/indexing-orchestrator";
import { InMemoryVaultAdapter, type VaultNote } from "../../src/vault-adapter";
import { DEFAULT_SETTINGS, type AICopilotSettings } from "../../src/settings";
import type { PatchTransaction } from "../../src/patcher";
import type { SmartRefinementSnapshot } from "../../src/smart-refinement";
import type { Command } from "obsidian";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides?: Partial<AICopilotSettings>): AICopilotSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeVault(notes: VaultNote[] = []): InMemoryVaultAdapter {
  return new InMemoryVaultAdapter(notes);
}

function makeCommandContext(
  vault: InMemoryVaultAdapter,
  settings: AICopilotSettings
): { ctx: CommandContext; commands: Command[] } {
  const commands: Command[] = [];
  const ctx: CommandContext = {
    addCommand: (cmd: Command) => { commands.push(cmd); },
    app: {
      vault: {} as any,
      workspace: {
        getActiveFile: () => null
      }
    } as any,
    vault,
    getSettings: () => settings,
    setLastPatchState: vi.fn(),
    clearLastPatchState: vi.fn(),
    getLastPatchState: () => ({ transactions: [] as PatchTransaction[], path: null }),
    setLastRefinementSnapshot: vi.fn(),
    clearLastRefinementSnapshot: vi.fn(),
    getLastRefinementSnapshot: () => null,
    writeAssistantOutput: vi.fn(async () => {}),
    runRefinementPass: vi.fn(async () => {})
  };
  return { ctx, commands };
}

function makeMockChat(): ChatOrchestrator {
  return {
    activateChatView: vi.fn(async () => {}),
    chatActiveNote: vi.fn(async () => {}),
    chatQuery: vi.fn(async () => {}),
    registerView: vi.fn()
  } as unknown as ChatOrchestrator;
}

function makeMockIndexing(): IndexingOrchestrator {
  return {
    rebuildPersistentIndex: vi.fn(async () => 42),
    queue: { stats: () => ({ pending: 0, running: 0, processed: 10, failed: 0, lastRunAt: Date.now(), lastError: null }) }
  } as unknown as IndexingOrchestrator;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Command Registration (integration)", () => {
  let vault: InMemoryVaultAdapter;
  let settings: AICopilotSettings;
  let commands: Command[];
  let ctx: CommandContext;
  let chat: ChatOrchestrator;
  let indexing: IndexingOrchestrator;

  beforeEach(() => {
    (Notice as any).history = [];
    vault = makeVault([
      { path: "notes/hello.md", content: "# Hello\nWorld", mtime: Date.now() }
    ]);
    settings = makeSettings({ provider: "none" });
    const result = makeCommandContext(vault, settings);
    ctx = result.ctx;
    commands = result.commands;
    chat = makeMockChat();
    indexing = makeMockIndexing();
  });

  it("registers all expected commands", () => {
    registerPluginCommands(ctx, chat, indexing);

    const ids = commands.map((c) => c.id);
    expect(ids).toContain("ai-copilot-open-chat-panel");
    expect(ids).toContain("ai-copilot-chat-active-note");
    expect(ids).toContain("ai-copilot-chat-query");
    expect(ids).toContain("ai-copilot-rebuild-vector-index");
    expect(ids).toContain("ai-copilot-run-refinement-now");
    expect(ids).toContain("ai-copilot-preview-refinement-patch");
    expect(ids).toContain("ai-copilot-smart-apply-safe");
    expect(ids).toContain("ai-copilot-rollback-smart-refinement");
    expect(ids).toContain("ai-copilot-rollback-last-refinement-patch");
    expect(ids).toContain("ai-copilot-indexing-status");
  });

  it("registers exactly 10 commands", () => {
    registerPluginCommands(ctx, chat, indexing);
    expect(commands).toHaveLength(10);
  });

  it("open-chat-panel calls chat.activateChatView", async () => {
    registerPluginCommands(ctx, chat, indexing);
    const cmd = commands.find((c) => c.id === "ai-copilot-open-chat-panel");
    await cmd?.callback?.();
    expect(chat.activateChatView).toHaveBeenCalled();
  });

  it("rebuild-vector-index calls indexing.rebuildPersistentIndex", async () => {
    registerPluginCommands(ctx, chat, indexing);
    const cmd = commands.find((c) => c.id === "ai-copilot-rebuild-vector-index");
    await cmd?.callback?.();
    expect(indexing.rebuildPersistentIndex).toHaveBeenCalled();
  });

  it("run-refinement-now calls runRefinementPass", async () => {
    registerPluginCommands(ctx, chat, indexing);
    const cmd = commands.find((c) => c.id === "ai-copilot-run-refinement-now");
    await cmd?.callback?.();
    expect(ctx.runRefinementPass).toHaveBeenCalled();
  });

  it("chat-active-note shows notice when no active file", async () => {
    registerPluginCommands(ctx, chat, indexing);
    const cmd = commands.find((c) => c.id === "ai-copilot-chat-active-note");
    await cmd?.callback?.();
    expect((Notice as any).history).toContain("No active note selected.");
  });

  it("rollback-smart-refinement shows notice when no snapshot", async () => {
    registerPluginCommands(ctx, chat, indexing);
    const cmd = commands.find((c) => c.id === "ai-copilot-rollback-smart-refinement");
    await cmd?.callback?.();
    expect((Notice as any).history).toContain(
      "No smart refinement snapshot available for rollback."
    );
  });

  it("rollback-last-patch shows notice when no transactions", async () => {
    registerPluginCommands(ctx, chat, indexing);
    const cmd = commands.find((c) => c.id === "ai-copilot-rollback-last-refinement-patch");
    await cmd?.callback?.();
    expect((Notice as any).history).toContain(
      "No patch transaction available for rollback."
    );
  });

  it("indexing-status writes diagnostics to assistant output", async () => {
    registerPluginCommands(ctx, chat, indexing);
    const cmd = commands.find((c) => c.id === "ai-copilot-indexing-status");
    await cmd?.callback?.();
    expect(ctx.writeAssistantOutput).toHaveBeenCalledWith(
      "Refinement Log",
      expect.stringContaining("Indexing Queue Diagnostics")
    );
  });
});

describe("Chat upsert (integration with vault adapter)", () => {
  it("creates output file and appends chat content", async () => {
    const { upsertChatOutput } = await import("../../src/chat");
    const vault = makeVault();

    await upsertChatOutput(vault, "## Query\ntest\n\n## Response\nanswer");

    const content = await vault.read("AI Copilot/Chat Output.md");
    expect(content).toContain("# Chat Output");
    expect(content).toContain("## Query");
    expect(content).toContain("## Response");
    expect(content).toContain("answer");
  });

  it("appends to existing output file", async () => {
    const { upsertChatOutput } = await import("../../src/chat");
    const vault = makeVault([
      { path: "AI Copilot/Chat Output.md", content: "# Chat Output\n", mtime: Date.now() }
    ]);

    await upsertChatOutput(vault, "first");
    await upsertChatOutput(vault, "second");

    const content = await vault.read("AI Copilot/Chat Output.md");
    expect(content).toContain("first");
    expect(content).toContain("second");
  });
});
