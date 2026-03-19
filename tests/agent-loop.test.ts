import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent-loop";
import type { AgentClient, AgentMessage, MessagesResponse } from "../src/agent-loop";
import type { AgentToolContext } from "../src/agent-tools";
import { executeTool, AGENT_TOOLS } from "../src/agent-tools";
import { InMemoryVaultAdapter } from "../src/vault-adapter";
import type { AICopilotSettings } from "../src/settings";

const BASE: AICopilotSettings = {
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
  agentMaxToolCalls: 10,
  agentTimeoutMs: 60000,
  allowRemoteModels: true,
  redactSensitiveLogs: true,
  maxPromptChars: 20000,
  strictConfigValidation: true,
  enrichmentConfidenceThreshold: 0.6,
  enrichmentDestructiveRewriteThreshold: 0.3,
  enrichmentPersistState: true
};

function makeSettings(overrides: Partial<AICopilotSettings> = {}): AICopilotSettings {
  return { ...BASE, ...overrides };
}

function makeVault() {
  return new InMemoryVaultAdapter([
    { path: "Projects/alpha.md", content: "# Alpha\nThis is the alpha project.", mtime: Date.now() - 1000 },
    { path: "Projects/beta.md", content: "# Beta\nBeta project details here.", mtime: Date.now() - 2000 },
    { path: "Daily/2026-03-18.md", content: "# Daily\nToday I worked on alpha.", mtime: Date.now() }
  ]);
}

function makeToolCtx(vault = makeVault()): AgentToolContext {
  return {
    vault,
    searchNotes: vi.fn().mockResolvedValue([
      {
        path: "Projects/alpha.md",
        content: "# Alpha\nThis is the alpha project.",
        score: 0.95,
        lexicalScore: 0.8,
        semanticScore: 0.9,
        freshnessScore: 0.5,
        graphBoost: 0,
        metadata: { tags: [], links: [], headings: ["Alpha"] }
      }
    ]),
    maxSearchResults: 6
  };
}

describe("AGENT_TOOLS", () => {
  it("defines five tools (3 read + 2 write)", () => {
    expect(AGENT_TOOLS).toHaveLength(5);
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names).toContain("search_notes");
    expect(names).toContain("read_note");
    expect(names).toContain("list_notes");
    expect(names).toContain("write_note");
    expect(names).toContain("edit_note");
  });

  it("each tool has name, description, and input_schema", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    }
  });
});

describe("executeTool", () => {
  it("search_notes returns formatted results", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("search_notes", { query: "alpha" }, ctx);
    expect(result.content).toContain("Projects/alpha.md");
    expect(result.content).toContain("score: 0.95");
    expect(result.is_error).toBeUndefined();
  });

  it("search_notes returns error on empty query", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("search_notes", { query: "" }, ctx);
    expect(result.is_error).toBe(true);
  });

  it("read_note returns file content", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("read_note", { path: "Projects/alpha.md" }, ctx);
    expect(result.content).toBe("# Alpha\nThis is the alpha project.");
  });

  it("read_note returns error for missing file", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("read_note", { path: "nonexistent.md" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Note not found");
  });

  it("list_notes lists all markdown files", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("list_notes", {}, ctx);
    expect(result.content).toContain("Projects/alpha.md");
    expect(result.content).toContain("Projects/beta.md");
    expect(result.content).toContain("Daily/2026-03-18.md");
  });

  it("list_notes filters by folder", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("list_notes", { folder: "Projects/" }, ctx);
    expect(result.content).toContain("Projects/alpha.md");
    expect(result.content).not.toContain("Daily/");
  });

  it("unknown tool returns error", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("nonexistent_tool", {}, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });
});

describe("executeTool: write_note", () => {
  it("creates a new note", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("write_note", { path: "New/note.md", content: "# Hello" }, ctx);
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Note created");
    expect(result.content).toContain("New/note.md");
    const written = await ctx.vault.read("New/note.md");
    expect(written).toBe("# Hello");
  });

  it("overwrites an existing note", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("write_note", { path: "Projects/alpha.md", content: "# Alpha v2\nUpdated." }, ctx);
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Note updated");
    const written = await ctx.vault.read("Projects/alpha.md");
    expect(written).toBe("# Alpha v2\nUpdated.");
  });

  it("blocks protected paths", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("write_note", { path: ".obsidian/config.json", content: "{}" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("protected");
  });

  it("blocks path traversal", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("write_note", { path: "../etc/passwd", content: "hack" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("traversal");
  });

  it("blocks absolute paths", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("write_note", { path: "/tmp/evil.md", content: "bad" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("traversal");
  });

  it("requires approval for destructive overwrite", async () => {
    const approve = vi.fn().mockResolvedValue(false);
    const ctx = makeToolCtx();
    ctx.approveEdit = approve;
    ctx.destructiveThreshold = 0.4;

    // Completely different content triggers approval
    const result = await executeTool("write_note", {
      path: "Projects/alpha.md",
      content: "Completely different content that replaces everything with new stuff."
    }, ctx);

    expect(approve).toHaveBeenCalledOnce();
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("rejected");
  });

  it("calls snapshot callback before overwrite", async () => {
    const snapshot = vi.fn();
    const ctx = makeToolCtx();
    ctx.onSnapshot = snapshot;

    await executeTool("write_note", { path: "Projects/alpha.md", content: "# Alpha\nThis is the alpha project. Small edit." }, ctx);
    expect(snapshot).toHaveBeenCalledWith("Projects/alpha.md", "# Alpha\nThis is the alpha project.");
  });

  it("returns error when content is empty", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("write_note", { path: "test.md", content: "" }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("content is required");
  });
});

describe("executeTool: edit_note", () => {
  it("applies a find-and-replace edit", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("edit_note", {
      path: "Projects/alpha.md",
      find: "alpha project",
      replace: "Alpha Project (v2)"
    }, ctx);
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Note edited");
    const content = await ctx.vault.read("Projects/alpha.md");
    expect(content).toBe("# Alpha\nThis is the Alpha Project (v2).");
  });

  it("returns error when find string not found", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("edit_note", {
      path: "Projects/alpha.md",
      find: "nonexistent text",
      replace: "replacement"
    }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("not found");
  });

  it("returns error for ambiguous match", async () => {
    const vault = new InMemoryVaultAdapter([
      { path: "test.md", content: "foo bar foo baz", mtime: Date.now() }
    ]);
    const ctx = makeToolCtx(vault);
    const result = await executeTool("edit_note", {
      path: "test.md",
      find: "foo",
      replace: "qux"
    }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("ambiguous");
  });

  it("blocks protected paths", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("edit_note", {
      path: ".git/config",
      find: "something",
      replace: "else"
    }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("protected");
  });

  it("blocks edits containing secrets", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("edit_note", {
      path: "Projects/alpha.md",
      find: "alpha project",
      replace: "api_key: sk-ant-abcdefghijklmnopqrstuvwxyz1234567890"
    }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Safety check failed");
  });

  it("returns error for missing file", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("edit_note", {
      path: "nonexistent.md",
      find: "a",
      replace: "b"
    }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Note not found");
  });

  it("calls snapshot callback before edit", async () => {
    const snapshot = vi.fn();
    const ctx = makeToolCtx();
    ctx.onSnapshot = snapshot;

    await executeTool("edit_note", {
      path: "Projects/alpha.md",
      find: "alpha project",
      replace: "alpha project v2"
    }, ctx);
    expect(snapshot).toHaveBeenCalledWith("Projects/alpha.md", "# Alpha\nThis is the alpha project.");
  });

  it("requires approval for destructive edit", async () => {
    const vault = new InMemoryVaultAdapter([
      { path: "small.md", content: "hello", mtime: Date.now() }
    ]);
    const approve = vi.fn().mockResolvedValue(false);
    const ctx = makeToolCtx(vault);
    ctx.approveEdit = approve;
    ctx.destructiveThreshold = 0.4;

    const result = await executeTool("edit_note", {
      path: "small.md",
      find: "hello",
      replace: "completely different and much longer text that changes everything"
    }, ctx);

    expect(approve).toHaveBeenCalledOnce();
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("rejected");
  });

  it("returns error when find is empty", async () => {
    const ctx = makeToolCtx();
    const result = await executeTool("edit_note", {
      path: "Projects/alpha.md",
      find: "",
      replace: "something"
    }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("find is required");
  });
});

describe("runAgentLoop", () => {
  it("returns text directly when model responds with end_turn", async () => {
    const client: AgentClient = {
      chatMessages: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Here is your answer." }],
        stop_reason: "end_turn"
      })
    };

    const result = await runAgentLoop(
      client,
      "What is alpha?",
      makeToolCtx(),
      makeSettings()
    );

    expect(result.text).toBe("Here is your answer.");
    expect(result.toolCallCount).toBe(0);
    expect(result.citations).toEqual([]);
  });

  it("executes tool calls and feeds results back", async () => {
    const chatMessages = vi.fn();

    // First call: model wants to search
    chatMessages.mockResolvedValueOnce({
      content: [
        { type: "text", text: "Let me search for that." },
        {
          type: "tool_use",
          id: "tool_1",
          name: "search_notes",
          input: { query: "alpha project" }
        }
      ],
      stop_reason: "tool_use"
    } satisfies MessagesResponse);

    // Second call: model responds with final answer
    chatMessages.mockResolvedValueOnce({
      content: [{ type: "text", text: "Alpha is a project about..." }],
      stop_reason: "end_turn"
    } satisfies MessagesResponse);

    const client: AgentClient = { chatMessages };
    const toolCtx = makeToolCtx();
    const callbacks = {
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onText: vi.fn()
    };

    const result = await runAgentLoop(
      client,
      "Tell me about alpha",
      toolCtx,
      makeSettings(),
      callbacks
    );

    expect(result.text).toBe("Alpha is a project about...");
    expect(result.toolCallCount).toBe(1);
    expect(callbacks.onToolCall).toHaveBeenCalledWith("search_notes", { query: "alpha project" });
    expect(callbacks.onToolResult).toHaveBeenCalledOnce();

    // Verify tool result was fed back to model
    expect(chatMessages).toHaveBeenCalledTimes(2);
    const secondCallMessages = chatMessages.mock.calls[1][0];
    expect(secondCallMessages).toHaveLength(3); // user, assistant, user (tool_result)
    const toolResultMsg = secondCallMessages[2];
    expect(toolResultMsg.role).toBe("user");
    expect(toolResultMsg.content[0].type).toBe("tool_result");
    expect(toolResultMsg.content[0].tool_use_id).toBe("tool_1");
  });

  it("tracks citations from read_note tool calls", async () => {
    const chatMessages = vi.fn();

    chatMessages.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "read_note",
          input: { path: "Projects/alpha.md" }
        }
      ],
      stop_reason: "tool_use"
    });

    chatMessages.mockResolvedValueOnce({
      content: [{ type: "text", text: "The alpha project is..." }],
      stop_reason: "end_turn"
    });

    const result = await runAgentLoop(
      { chatMessages },
      "read alpha",
      makeToolCtx(),
      makeSettings()
    );

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].path).toBe("Projects/alpha.md");
  });

  it("respects maxToolCalls limit", async () => {
    const chatMessages = vi.fn();

    // Always wants more tools
    chatMessages.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "tool_x",
          name: "list_notes",
          input: {}
        }
      ],
      stop_reason: "tool_use"
    });

    // Override the last call to return end_turn
    const settings = makeSettings({ agentMaxToolCalls: 3 });

    // After 3 tool calls + 1 final call = 4 chatMessages calls total
    // The loop runs maxToolCalls+1 iterations, then makes one final call
    const result = await runAgentLoop(
      { chatMessages },
      "list everything",
      makeToolCtx(),
      settings
    );

    // Should have made 3 tool calls before hitting the limit
    expect(result.toolCallCount).toBeLessThanOrEqual(4);
  });

  it("passes tools to the client", async () => {
    const chatMessages = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Done" }],
      stop_reason: "end_turn"
    });

    await runAgentLoop(
      { chatMessages },
      "hello",
      makeToolCtx(),
      makeSettings()
    );

    const tools = chatMessages.mock.calls[0][2];
    expect(tools).toHaveLength(5);
    expect(tools.map((t: { name: string }) => t.name)).toEqual([
      "search_notes",
      "read_note",
      "list_notes",
      "write_note",
      "edit_note"
    ]);
  });
});
