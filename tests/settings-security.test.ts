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

  it("flags agent max tool calls out of range", () => {
    const issues = validateSettings({ ...BASE_SETTINGS, agentMaxToolCalls: 0 });
    expect(issues).toContain("agentMaxToolCalls must be between 1 and 30.");
    const issues2 = validateSettings({ ...BASE_SETTINGS, agentMaxToolCalls: 50 });
    expect(issues2).toContain("agentMaxToolCalls must be between 1 and 30.");
  });

  it("flags agent timeout out of range", () => {
    const issues = validateSettings({ ...BASE_SETTINGS, agentTimeoutMs: 5000 });
    expect(issues).toContain("agentTimeoutMs must be between 10000 and 300000.");
  });

  it("flags enrichment debounce out of range", () => {
    const issues = validateSettings({ ...BASE_SETTINGS, enrichmentDebounceSec: 0 });
    expect(issues).toContain("enrichmentDebounceSec must be between 1 and 30.");
  });

  it("flags enrichment confidence threshold out of range", () => {
    const issues = validateSettings({ ...BASE_SETTINGS, enrichmentConfidenceThreshold: -0.1 });
    expect(issues).toContain("enrichmentConfidenceThreshold must be between 0 and 1.");
    const issues2 = validateSettings({ ...BASE_SETTINGS, enrichmentConfidenceThreshold: 1.5 });
    expect(issues2).toContain("enrichmentConfidenceThreshold must be between 0 and 1.");
  });

  it("flags destructive rewrite threshold out of range", () => {
    const issues = validateSettings({ ...BASE_SETTINGS, enrichmentDestructiveRewriteThreshold: 2.0 });
    expect(issues).toContain("enrichmentDestructiveRewriteThreshold must be between 0 and 1.");
  });
});
