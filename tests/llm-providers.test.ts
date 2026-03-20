import { describe, expect, it, vi } from "vitest";
import {
  buildClient,
  DryRunClient,
  OpenAIClient,
  AnthropicClient,
  BedrockClient
} from "../src/llm";
import { validateSettings } from "../src/config-validation";
import type { AICopilotSettings } from "../src/settings";

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
  requireApprovalForNewFiles: true
};

describe("buildClient factory", () => {
  it("returns DryRunClient for provider=none", () => {
    expect(buildClient({ ...BASE, provider: "none" })).toBeInstanceOf(DryRunClient);
  });

  it("returns OpenAIClient for provider=openai", () => {
    expect(buildClient({ ...BASE, provider: "openai" })).toBeInstanceOf(OpenAIClient);
  });

  it("returns AnthropicClient for provider=anthropic", () => {
    expect(buildClient({ ...BASE, provider: "anthropic" })).toBeInstanceOf(AnthropicClient);
  });

  it("returns BedrockClient for provider=bedrock", () => {
    expect(buildClient({ ...BASE, provider: "bedrock" })).toBeInstanceOf(BedrockClient);
  });

  it("returns DryRunClient when allowRemoteModels is false", () => {
    expect(
      buildClient({ ...BASE, provider: "anthropic", allowRemoteModels: false })
    ).toBeInstanceOf(DryRunClient);
  });
});

describe("AnthropicClient", () => {
  it("throws when allowRemoteModels is false", async () => {
    const client = new AnthropicClient({ ...BASE, allowRemoteModels: false });
    await expect(client.chat("hi")).rejects.toThrow("Remote model calls are disabled");
  });

  it("throws when API key is missing", async () => {
    const client = new AnthropicClient({ ...BASE, anthropicApiKey: "" });
    await expect(client.chat("hi")).rejects.toThrow("Anthropic API key missing");
  });

  it("calls Anthropic messages API with correct headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "Hello back" }] })
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = new AnthropicClient({
      ...BASE,
      provider: "anthropic",
      anthropicApiKey: "sk-ant-test-key"
    });
    const result = await client.chat("hello", "system prompt");

    expect(result).toBe("Hello back");
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(opts.headers["x-api-key"]).toBe("sk-ant-test-key");
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.system).toBe("system prompt");
    expect(body.messages[0].content).toBe("hello");

    vi.unstubAllGlobals();
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized"
    }));

    const client = new AnthropicClient({
      ...BASE,
      anthropicApiKey: "sk-ant-test"
    });
    await expect(client.chat("hi")).rejects.toThrow("Anthropic request failed: 401");

    vi.unstubAllGlobals();
  });
});

describe("BedrockClient", () => {
  it("throws when allowRemoteModels is false", async () => {
    const client = new BedrockClient({ ...BASE, allowRemoteModels: false });
    await expect(client.chat("hi")).rejects.toThrow("Remote model calls are disabled");
  });

  it("throws when credentials are missing", async () => {
    const client = new BedrockClient({
      ...BASE,
      bedrockAccessKeyId: "",
      bedrockSecretAccessKey: ""
    });
    await expect(client.chat("hi")).rejects.toThrow("AWS Bedrock credentials missing");
  });

  it("calls Bedrock invoke endpoint with SigV4 headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "Bedrock response" }] })
    });
    vi.stubGlobal("fetch", mockFetch);

    const client = new BedrockClient({
      ...BASE,
      provider: "bedrock",
      bedrockAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      bedrockSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      bedrockRegion: "us-west-2",
      bedrockModel: "us.anthropic.claude-sonnet-4-20250514-v1:0"
    });

    const result = await client.chat("test prompt");
    expect(result).toBe("Bedrock response");
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("bedrock-runtime.us-west-2.amazonaws.com");
    expect(url).toContain("/model/us.anthropic.claude-sonnet-4-20250514-v1%3A0/invoke");
    expect(opts.headers["Authorization"]).toContain("AWS4-HMAC-SHA256");
    expect(opts.headers["X-Amz-Date"]).toBeTruthy();

    const body = JSON.parse(opts.body);
    expect(body.anthropic_version).toBe("bedrock-2023-05-31");
    expect(body.messages[0].content).toBe("test prompt");

    vi.unstubAllGlobals();
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Access Denied"
    }));

    const client = new BedrockClient({
      ...BASE,
      bedrockAccessKeyId: "AKIATEST",
      bedrockSecretAccessKey: "secrettest"
    });
    await expect(client.chat("hi")).rejects.toThrow("Bedrock request failed: 403");

    vi.unstubAllGlobals();
  });
});

describe("config validation for new providers", () => {
  it("flags missing Anthropic API key", () => {
    const issues = validateSettings({ ...BASE, provider: "anthropic", anthropicApiKey: "" });
    expect(issues).toContain("Anthropic provider requires an API key.");
  });

  it("flags missing Bedrock credentials", () => {
    const issues = validateSettings({
      ...BASE,
      provider: "bedrock",
      bedrockAccessKeyId: "",
      bedrockSecretAccessKey: ""
    });
    expect(issues).toContain(
      "Bedrock provider requires AWS access key ID and secret access key."
    );
  });

  it("flags missing Bedrock region", () => {
    const issues = validateSettings({
      ...BASE,
      provider: "bedrock",
      bedrockAccessKeyId: "AKIA...",
      bedrockSecretAccessKey: "secret",
      bedrockRegion: ""
    });
    expect(issues).toContain("Bedrock provider requires an AWS region.");
  });

  it("accepts valid Anthropic config", () => {
    const issues = validateSettings({
      ...BASE,
      provider: "anthropic",
      anthropicApiKey: "sk-ant-valid-key"
    });
    expect(issues).toEqual([]);
  });

  it("accepts valid Bedrock config", () => {
    const issues = validateSettings({
      ...BASE,
      provider: "bedrock",
      bedrockAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      bedrockSecretAccessKey: "wJalrXUtnFEMI",
      bedrockRegion: "us-west-2"
    });
    expect(issues).toEqual([]);
  });
});
