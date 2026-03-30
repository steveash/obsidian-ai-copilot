import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AICopilotSettings } from "../src/settings";

// Mock the AI SDK modules before importing the adapter
const mockGenerateText = vi.fn();
const mockStreamText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  streamText: (...args: unknown[]) => mockStreamText(...args),
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

import {
  buildClient,
  buildAgentClient,
  DryRunClient,
  AISDKClient,
  AISDKAgentClient,
} from "../src/llm-adapter";

const BASE: AICopilotSettings = {
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
  allowRemoteModels: true,
  redactSensitiveLogs: true,
  maxPromptChars: 20000,
  agentMode: "auto-apply" as const,
  agentMaxToolCalls: 10,
  agentTimeoutMs: 60000,
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

describe("buildClient factory", () => {
  it("returns DryRunClient for provider=none", () => {
    expect(buildClient({ ...BASE, provider: "none" })).toBeInstanceOf(DryRunClient);
  });

  it("returns AISDKClient for provider=openai", () => {
    expect(buildClient({ ...BASE, provider: "openai" })).toBeInstanceOf(AISDKClient);
  });

  it("returns AISDKClient for provider=anthropic", () => {
    expect(buildClient({ ...BASE, provider: "anthropic" })).toBeInstanceOf(AISDKClient);
  });

  it("returns AISDKClient for provider=bedrock", () => {
    expect(buildClient({ ...BASE, provider: "bedrock" })).toBeInstanceOf(AISDKClient);
  });

  it("returns DryRunClient when allowRemoteModels is false", () => {
    expect(
      buildClient({ ...BASE, provider: "anthropic", allowRemoteModels: false })
    ).toBeInstanceOf(DryRunClient);
  });
});

describe("buildAgentClient factory", () => {
  it("returns null when allowRemoteModels is false", () => {
    expect(buildAgentClient({ ...BASE, provider: "anthropic", allowRemoteModels: false })).toBeNull();
  });

  it("returns null for provider=none", () => {
    expect(buildAgentClient({ ...BASE, provider: "none" })).toBeNull();
  });

  it("returns AISDKAgentClient for provider=anthropic", () => {
    expect(buildAgentClient({ ...BASE, provider: "anthropic" })).toBeInstanceOf(AISDKAgentClient);
  });

  it("returns AISDKAgentClient for provider=openai", () => {
    expect(buildAgentClient({ ...BASE, provider: "openai" })).toBeInstanceOf(AISDKAgentClient);
  });

  it("returns AISDKAgentClient for provider=bedrock", () => {
    expect(buildAgentClient({ ...BASE, provider: "bedrock" })).toBeInstanceOf(AISDKAgentClient);
  });
});

describe("DryRunClient", () => {
  it("returns dry run response with prompt excerpt", async () => {
    const client = new DryRunClient();
    const result = await client.chat("hello world");
    expect(result).toContain("DRY_RUN_RESPONSE");
    expect(result).toContain("hello world");
  });
});

describe("AISDKClient", () => {
  it("throws when allowRemoteModels is false", async () => {
    const client = new AISDKClient({ ...BASE, provider: "anthropic", allowRemoteModels: false });
    await expect(client.chat("hi")).rejects.toThrow("Remote model calls are disabled");
  });

  it("calls generateText with correct parameters for OpenAI provider", async () => {
    const mockModel = setupProviderMock();
    mockGenerateText.mockResolvedValue({ text: "Hello back" });

    const client = new AISDKClient({
      ...BASE,
      provider: "openai",
      openaiApiKey: "sk-test-key",
    });
    const result = await client.chat("hello", "custom system");

    expect(result).toBe("Hello back");
    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test-key" });
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: mockModel,
      system: "custom system",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("calls generateText with Anthropic provider", async () => {
    const mockModel = setupProviderMock();
    mockGenerateText.mockResolvedValue({ text: "Anthropic response" });

    const client = new AISDKClient({
      ...BASE,
      provider: "anthropic",
      anthropicApiKey: "sk-ant-test",
    });
    const result = await client.chat("test prompt");

    expect(result).toBe("Anthropic response");
    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
  });

  it("calls generateText with Bedrock provider", async () => {
    const mockModel = setupProviderMock();
    mockGenerateText.mockResolvedValue({ text: "Bedrock response" });

    const client = new AISDKClient({
      ...BASE,
      provider: "bedrock",
      bedrockAccessKeyId: "AKIATEST",
      bedrockSecretAccessKey: "secrettest",
      bedrockRegion: "us-east-1",
    });
    const result = await client.chat("test");

    expect(result).toBe("Bedrock response");
    expect(mockCreateAmazonBedrock).toHaveBeenCalledWith({
      region: "us-east-1",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secrettest",
    });
  });

  it("truncates prompt to maxPromptChars", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({ text: "ok" });

    const longPrompt = "x".repeat(500);
    const client = new AISDKClient({
      ...BASE,
      provider: "openai",
      openaiApiKey: "sk-test",
      maxPromptChars: 100,
    });
    await client.chat(longPrompt);

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.messages[0].content).toHaveLength(100);
  });

  it("uses default system prompt when none provided", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({ text: "ok" });

    const client = new AISDKClient({ ...BASE, provider: "openai", openaiApiKey: "sk-test" });
    await client.chat("hi");

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.system).toBe("You are a helpful note assistant.");
  });
});

describe("AISDKAgentClient", () => {
  it("throws when allowRemoteModels is false", async () => {
    const client = new AISDKAgentClient({ ...BASE, provider: "anthropic", allowRemoteModels: false });
    await expect(
      client.chatMessages([{ role: "user", content: "hi" }], "sys", [], 4096)
    ).rejects.toThrow("Remote model calls are disabled");
  });

  it("converts simple text messages and returns response", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({
      text: "Response text",
      toolCalls: [],
      finishReason: "stop",
    });

    const client = new AISDKAgentClient({ ...BASE, provider: "anthropic", anthropicApiKey: "key" });
    const result = await client.chatMessages(
      [{ role: "user", content: "hello" }],
      "system prompt",
      [],
      4096
    );

    expect(result.content).toEqual([{ type: "text", text: "Response text" }]);
    expect(result.stop_reason).toBe("end_turn");
  });

  it("maps tool_use stop reason from tool-calls finishReason", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({
      text: "",
      toolCalls: [
        { toolCallId: "tc_1", toolName: "search_notes", input: { query: "test" } },
      ],
      finishReason: "tool-calls",
    });

    const client = new AISDKAgentClient({ ...BASE, provider: "anthropic", anthropicApiKey: "key" });
    const result = await client.chatMessages(
      [{ role: "user", content: "find notes" }],
      "sys",
      [],
      4096
    );

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toEqual([
      {
        type: "tool_use",
        id: "tc_1",
        name: "search_notes",
        input: { query: "test" },
      },
    ]);
  });

  it("maps max_tokens stop reason from length finishReason", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({
      text: "partial",
      toolCalls: [],
      finishReason: "length",
    });

    const client = new AISDKAgentClient({ ...BASE, provider: "anthropic", anthropicApiKey: "key" });
    const result = await client.chatMessages(
      [{ role: "user", content: "hi" }],
      "sys",
      [],
      100
    );

    expect(result.stop_reason).toBe("max_tokens");
  });

  it("converts assistant tool_use messages to AI SDK format", async () => {
    setupProviderMock();
    mockGenerateText.mockResolvedValue({
      text: "done",
      toolCalls: [],
      finishReason: "stop",
    });

    const client = new AISDKAgentClient({ ...BASE, provider: "anthropic", anthropicApiKey: "key" });
    await client.chatMessages(
      [
        { role: "user", content: "find stuff" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me search." },
            { type: "tool_use", id: "tc_1", name: "search_notes", input: { query: "stuff" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tc_1", content: "found notes", is_error: false },
          ],
        },
      ],
      "sys",
      [],
      4096
    );

    const callArgs = mockGenerateText.mock.calls[0][0];
    // Assistant message should have tool-call format
    expect(callArgs.messages[1].content[1]).toEqual({
      type: "tool-call",
      toolCallId: "tc_1",
      toolName: "search_notes",
      input: { query: "stuff" },
    });
    // Tool results become { role: "tool" } messages in AI SDK format
    expect(callArgs.messages[2]).toEqual({
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "tc_1",
        toolName: "tool",
        output: { type: "text", value: "found notes" },
      }],
    });
  });
});

describe("config validation for providers", () => {
  // Config validation tests import from config-validation, not llm-adapter,
  // so they are unaffected by the adapter migration. Re-run them to verify.
  it("validates that buildClient/buildAgentClient handle all provider types", () => {
    const providers: AICopilotSettings["provider"][] = ["none", "openai", "anthropic", "bedrock"];
    for (const provider of providers) {
      const settings = { ...BASE, provider };
      // Should not throw
      buildClient(settings);
      buildAgentClient(settings);
    }
  });
});
