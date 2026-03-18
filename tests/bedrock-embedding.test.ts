import { describe, expect, it, vi } from "vitest";
import { BedrockEmbeddingProvider } from "../src/embedding-provider";
import { validateSettings } from "../src/config-validation";
import { InMemoryVectorStorage, PersistentVectorIndex } from "../src/vector-index";
import type { AICopilotSettings } from "../src/settings";

const BASE: AICopilotSettings = {
  provider: "bedrock",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-6",
  bedrockAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
  bedrockSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
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
  embeddingProvider: "bedrock",
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
  strictConfigValidation: true,
  enrichmentConfidenceThreshold: 0.6,
  enrichmentDestructiveRewriteThreshold: 0.3,
  enrichmentPersistState: true
};

describe("BedrockEmbeddingProvider", () => {
  it("throws when credentials are missing", async () => {
    const provider = new BedrockEmbeddingProvider({
      ...BASE,
      bedrockAccessKeyId: "",
      bedrockSecretAccessKey: ""
    });
    await expect(provider.embed("hello", "amazon.titan-embed-text-v2:0")).rejects.toThrow(
      "AWS Bedrock credentials missing"
    );
  });

  it("calls Bedrock Titan embedding endpoint with SigV4 headers", async () => {
    const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: mockEmbedding, inputTextTokenCount: 5 })
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new BedrockEmbeddingProvider(BASE);
    const result = await provider.embed("hello world", "amazon.titan-embed-text-v2:0");

    expect(result).toEqual(mockEmbedding);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("bedrock-runtime.us-west-2.amazonaws.com");
    expect(url).toContain("/model/amazon.titan-embed-text-v2%3A0/invoke");
    expect(opts.headers["Authorization"]).toContain("AWS4-HMAC-SHA256");
    expect(opts.headers["X-Amz-Date"]).toBeTruthy();

    const body = JSON.parse(opts.body);
    expect(body.inputText).toBe("hello world");
    expect(body.dimensions).toBe(1024);
    expect(body.normalize).toBe(true);

    vi.unstubAllGlobals();
  });

  it("truncates input text to 20000 chars", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [1, 2, 3] })
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new BedrockEmbeddingProvider(BASE);
    const longText = "a".repeat(25000);
    await provider.embed(longText, "amazon.titan-embed-text-v2:0");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.inputText.length).toBe(20000);

    vi.unstubAllGlobals();
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Access Denied"
      })
    );

    const provider = new BedrockEmbeddingProvider(BASE);
    await expect(provider.embed("hello", "amazon.titan-embed-text-v2:0")).rejects.toThrow(
      "Bedrock embedding request failed: 403"
    );

    vi.unstubAllGlobals();
  });

  it("returns empty array when response has no embedding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({})
      })
    );

    const provider = new BedrockEmbeddingProvider(BASE);
    const result = await provider.embed("hello", "amazon.titan-embed-text-v2:0");
    expect(result).toEqual([]);

    vi.unstubAllGlobals();
  });
});

describe("config validation for bedrock embedding", () => {
  it("flags missing credentials for bedrock embedding provider", () => {
    const issues = validateSettings({
      ...BASE,
      provider: "none",
      embeddingProvider: "bedrock",
      bedrockAccessKeyId: "",
      bedrockSecretAccessKey: ""
    });
    expect(issues).toContain(
      "Bedrock embedding provider requires AWS access key ID and secret access key."
    );
  });

  it("flags missing region for bedrock embedding provider", () => {
    const issues = validateSettings({
      ...BASE,
      embeddingProvider: "bedrock",
      bedrockRegion: ""
    });
    expect(issues).toContain("Bedrock embedding provider requires an AWS region.");
  });

  it("flags missing API key for openai embedding provider", () => {
    const issues = validateSettings({
      ...BASE,
      provider: "none",
      embeddingProvider: "openai",
      openaiApiKey: ""
    });
    expect(issues).toContain("OpenAI embedding provider requires an API key.");
  });

  it("accepts valid bedrock embedding config", () => {
    const issues = validateSettings(BASE);
    expect(issues).toEqual([]);
  });
});

describe("vector index provider metadata", () => {
  it("stores and retrieves embedding provider", async () => {
    const storage = new InMemoryVectorStorage();
    const provider = { embed: async () => [1, 2] };
    const idx = new PersistentVectorIndex(storage, provider);

    expect(await idx.getStoredProvider()).toBeUndefined();

    await idx.setProvider("bedrock");
    expect(await idx.getStoredProvider()).toBe("bedrock");

    await idx.setProvider("openai");
    expect(await idx.getStoredProvider()).toBe("openai");
  });

  it("preserves provider metadata across rebuild", async () => {
    const storage = new InMemoryVectorStorage();
    const provider = { embed: async () => [1, 2] };
    const idx = new PersistentVectorIndex(storage, provider);

    await idx.setProvider("bedrock");
    await idx.rebuild(
      [{ id: "a.md#0", path: "a.md", content: "hello" }],
      "amazon.titan-embed-text-v2:0"
    );
    expect(await idx.getStoredProvider()).toBe("bedrock");
  });
});
