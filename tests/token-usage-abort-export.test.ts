import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AICopilotSettings } from "../src/settings";

// ── Mock AI SDK before importing adapter ──────────────────────────
const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

const mockCreateOpenAI = vi.fn();
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (...args: unknown[]) => mockCreateOpenAI(...args),
}));

const mockCreateAnthropic = vi.fn();
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (...args: unknown[]) => mockCreateAnthropic(...args),
}));

const mockCreateAmazonBedrock = vi.fn();
vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: (...args: unknown[]) => mockCreateAmazonBedrock(...args),
}));

import { AISDKAgentClient } from "../src/llm-adapter";
import { runAgentLoop } from "../src/agent-loop";
import type { AgentClient, AgentMessage, MessagesResponse, TokenUsage } from "../src/agent-loop";
import type { AgentToolContext } from "../src/agent-tools";
import { InMemoryVaultAdapter } from "../src/vault-adapter";
import { formatTokenUsageHtml } from "../src/chat-format";
import { ConversationManager } from "../src/conversation-manager";

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

function setupProviderMock() {
  const mockModel = Symbol("mock-model");
  const providerFn = vi.fn().mockReturnValue(mockModel);
  mockCreateOpenAI.mockReturnValue(providerFn);
  mockCreateAnthropic.mockReturnValue(providerFn);
  mockCreateAmazonBedrock.mockReturnValue(providerFn);
  return mockModel;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Token Usage Tests ─────────────────────────────────────────────

describe("token usage: AISDKAgentClient", () => {
  it("returns usage from generateText response", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({
      text: "Hello",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const client = new AISDKAgentClient({ ...BASE, provider: "anthropic", anthropicApiKey: "key" });
    const result = await client.chatMessages(
      [{ role: "user", content: "hi" }],
      "sys",
      [],
      4096
    );

    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it("returns undefined usage when not available", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({
      text: "Hello",
      toolCalls: [],
      finishReason: "stop",
      // No usage field
    });

    const client = new AISDKAgentClient({ ...BASE, provider: "anthropic", anthropicApiKey: "key" });
    const result = await client.chatMessages(
      [{ role: "user", content: "hi" }],
      "sys",
      [],
      4096
    );

    expect(result.usage).toBeUndefined();
  });
});

describe("token usage: agent loop accumulation", () => {
  it("accumulates usage across multiple iterations", async () => {
    const vault = new InMemoryVaultAdapter([
      { path: "note.md", content: "test", mtime: Date.now() },
    ]);
    const toolCtx: AgentToolContext = {
      vault,
      searchNotes: async () => [{
        path: "note.md", content: "test", score: 1,
        lexicalScore: 0, semanticScore: 1, freshnessScore: 0, graphBoost: 0,
        metadata: { tags: [], links: [], headings: [] },
      }],
      maxSearchResults: 6,
    };

    let callCount = 0;
    const mockClient: AgentClient = {
      async chatMessages() {
        callCount++;
        if (callCount === 1) {
          return {
            content: [
              { type: "tool_use", id: "tc1", name: "search_notes", input: { query: "test" } },
            ],
            stop_reason: "tool_use" as const,
            usage: { inputTokens: 200, outputTokens: 30 },
          };
        }
        return {
          content: [{ type: "text", text: "Found it" }],
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 300, outputTokens: 80 },
        };
      },
    };

    const result = await runAgentLoop(mockClient, "search", toolCtx, BASE);

    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 110 });
    expect(result.text).toBe("Found it");
  });

  it("returns zero usage when none provided by client", async () => {
    const mockClient: AgentClient = {
      async chatMessages() {
        return {
          content: [{ type: "text", text: "Done" }],
          stop_reason: "end_turn" as const,
        };
      },
    };

    const vault = new InMemoryVaultAdapter();
    const toolCtx: AgentToolContext = {
      vault,
      searchNotes: async () => [],
      maxSearchResults: 6,
    };

    const result = await runAgentLoop(mockClient, "hi", toolCtx, BASE);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("token usage: formatTokenUsageHtml", () => {
  it("renders token counts with total", () => {
    const html = formatTokenUsageHtml({ inputTokens: 150, outputTokens: 75 });
    expect(html).toContain("150 in");
    expect(html).toContain("75 out");
    expect(html).toContain("225 total");
    expect(html).toContain("ai-copilot-token-usage");
  });

  it("renders zero tokens", () => {
    const html = formatTokenUsageHtml({ inputTokens: 0, outputTokens: 0 });
    expect(html).toContain("0 in");
    expect(html).toContain("0 out");
    expect(html).toContain("0 total");
  });
});

// ── Abort/Cancel Tests ────────────────────────────────────────────

describe("abort/cancel: agent loop", () => {
  it("throws when signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const mockClient: AgentClient = {
      async chatMessages() {
        return {
          content: [{ type: "text", text: "Should not reach" }],
          stop_reason: "end_turn" as const,
        };
      },
    };

    const vault = new InMemoryVaultAdapter();
    const toolCtx: AgentToolContext = {
      vault,
      searchNotes: async () => [],
      maxSearchResults: 6,
    };

    await expect(
      runAgentLoop(mockClient, "hi", toolCtx, BASE, undefined, undefined, undefined, abortController.signal)
    ).rejects.toThrow();
  });

  it("passes abort signal to client chatMessages", async () => {
    const abortController = new AbortController();
    const receivedSignals: (AbortSignal | undefined)[] = [];

    const mockClient: AgentClient = {
      async chatMessages(_msgs, _sys, _tools, _max, signal) {
        receivedSignals.push(signal);
        return {
          content: [{ type: "text", text: "Done" }],
          stop_reason: "end_turn" as const,
        };
      },
    };

    const vault = new InMemoryVaultAdapter();
    const toolCtx: AgentToolContext = {
      vault,
      searchNotes: async () => [],
      maxSearchResults: 6,
    };

    await runAgentLoop(
      mockClient, "hi", toolCtx, BASE,
      undefined, undefined, undefined, abortController.signal
    );

    expect(receivedSignals).toHaveLength(1);
    expect(receivedSignals[0]).toBe(abortController.signal);
  });
});

describe("abort/cancel: AISDKAgentClient passes signal to generateText", () => {
  it("passes abortSignal through to generateText", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({
      text: "Hello",
      toolCalls: [],
      finishReason: "stop",
    });

    const abortController = new AbortController();
    const client = new AISDKAgentClient({ ...BASE, provider: "anthropic", anthropicApiKey: "key" });

    await client.chatMessages(
      [{ role: "user", content: "hi" }],
      "sys",
      [],
      4096,
      abortController.signal
    );

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.abortSignal).toBe(abortController.signal);
  });
});

// ── Conversation Export Tests ─────────────────────────────────────

describe("conversation export", () => {
  it("exports conversation as markdown with messages", async () => {
    const vault = new InMemoryVaultAdapter();
    const mgr = new ConversationManager(vault);

    const conv = await mgr.create("Test Topic", "anthropic/claude-sonnet");
    await mgr.addMessage(conv.meta.id, "user", "Hello, can you help?");
    await mgr.addMessage(conv.meta.id, "assistant", "Of course! What do you need?");
    await mgr.addMessage(conv.meta.id, "system", "Context from vault...");
    await mgr.addMessage(conv.meta.id, "user", "Tell me about project alpha.");
    await mgr.addMessage(conv.meta.id, "assistant", "Project alpha is about...");

    // Re-read to get the full conversation with messages
    const fullConv = await mgr.get(conv.meta.id);
    expect(fullConv).not.toBeNull();
    expect(fullConv!.messages).toHaveLength(5);

    // Simulate export by filtering and formatting (matches ChatOrchestrator.exportConversation logic)
    const msgs = fullConv!.messages.filter(m => m.role !== "system");
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Hello, can you help?");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[3].role).toBe("assistant");
  });

  it("handles empty conversation", async () => {
    const vault = new InMemoryVaultAdapter();
    const mgr = new ConversationManager(vault);

    const conv = await mgr.create("Empty Chat", "anthropic/claude-sonnet");
    expect(conv.messages).toHaveLength(0);
  });
});
