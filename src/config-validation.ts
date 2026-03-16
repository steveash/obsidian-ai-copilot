import type { AICopilotSettings } from "./settings";

export function validateSettings(input: AICopilotSettings): string[] {
  const issues: string[] = [];
  if (input.provider === "openai" && !input.openaiApiKey) issues.push("OpenAI provider requires an API key.");
  if (input.provider === "anthropic" && !input.anthropicApiKey) issues.push("Anthropic provider requires an API key.");
  if (input.provider === "bedrock" && (!input.bedrockAccessKeyId || !input.bedrockSecretAccessKey)) {
    issues.push("Bedrock provider requires AWS access key ID and secret access key.");
  }
  if (input.provider === "bedrock" && !input.bedrockRegion) issues.push("Bedrock provider requires an AWS region.");
  if (input.embeddingProvider === "openai" && !input.openaiApiKey) {
    issues.push("OpenAI embedding provider requires an API key.");
  }
  if (input.embeddingProvider === "bedrock" && (!input.bedrockAccessKeyId || !input.bedrockSecretAccessKey)) {
    issues.push("Bedrock embedding provider requires AWS access key ID and secret access key.");
  }
  if (input.embeddingProvider === "bedrock" && !input.bedrockRegion) {
    issues.push("Bedrock embedding provider requires an AWS region.");
  }
  const weights = input.retrievalLexicalWeight + input.retrievalSemanticWeight + input.retrievalFreshnessWeight;
  if (weights > 1.5) issues.push("Retrieval weight sum is too high; expected <= 1.5.");
  if (input.maxPromptChars < 2000 || input.maxPromptChars > 100000) {
    issues.push("maxPromptChars must be between 2000 and 100000.");
  }
  if (input.rerankerTopK < 1) issues.push("rerankerTopK must be >= 1.");
  return issues;
}
