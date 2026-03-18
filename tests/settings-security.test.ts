import { describe, expect, it } from "vitest";
import { validateSettings } from "../src/config-validation";

const BASE_SETTINGS = {
  provider: "none" as const,
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
  embeddingProvider: "fallback-hash" as const,
  embeddingModel: "text-embedding-3-large",
  bedrockEmbeddingModel: "amazon.titan-embed-text-v2:0",
  preselectCandidateCount: 40,
  retrievalChunkSize: 1200,
  rerankerEnabled: true,
  rerankerTopK: 8,
  rerankerType: "openai" as const,
  rerankerModel: "gpt-4.1-mini",
  allowRemoteModels: true,
  redactSensitiveLogs: true,
  maxPromptChars: 20000,
  agentMaxToolCalls: 10,
  agentTimeoutMs: 60000,
  strictConfigValidation: true,
  enrichmentConfidenceThreshold: 0.6,
  enrichmentDestructiveRewriteThreshold: 0.3,
  enrichmentPersistState: true
};

describe("settings validation", () => {
  it("flags invalid secure config", () => {
    const issues = validateSettings({
      ...BASE_SETTINGS,
      provider: "openai",
      openaiApiKey: "",
      maxPromptChars: 100
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts sane defaults", () => {
    const issues = validateSettings(BASE_SETTINGS);
    expect(issues).toEqual([]);
  });
});
