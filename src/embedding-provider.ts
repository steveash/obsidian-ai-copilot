import { embed, type EmbeddingModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { AICopilotSettings } from "./settings";
import type { EmbeddingProvider } from "./vector-index";

export function resolveEmbeddingModel(settings: AICopilotSettings): EmbeddingModel {
  switch (settings.embeddingProvider) {
    case "openai": {
      if (!settings.openaiApiKey) throw new Error("Missing OpenAI API key");
      const provider = createOpenAI({ apiKey: settings.openaiApiKey });
      return provider.embedding(settings.embeddingModel);
    }
    case "bedrock": {
      if (!settings.bedrockAccessKeyId || !settings.bedrockSecretAccessKey) {
        throw new Error("AWS Bedrock credentials missing for embedding");
      }
      if (!settings.bedrockRegion) throw new Error("AWS Bedrock region missing for embedding");
      const provider = createAmazonBedrock({
        region: settings.bedrockRegion,
        accessKeyId: settings.bedrockAccessKeyId,
        secretAccessKey: settings.bedrockSecretAccessKey,
      });
      return provider.embedding(settings.bedrockEmbeddingModel);
    }
    default:
      throw new Error(`Cannot resolve AI SDK embedding model for provider: ${settings.embeddingProvider}`);
  }
}

export class AISDKEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly settings: AICopilotSettings) {}

  async embed(text: string, _model: string): Promise<number[]> {
    const embeddingModel = resolveEmbeddingModel(this.settings);
    const result = await embed({ model: embeddingModel, value: text.slice(0, 20000) });
    return result.embedding;
  }
}

export class FallbackHashEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string, _model: string): Promise<number[]> {
    const arr = new Array<number>(256).fill(0);
    const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    for (const t of clean) {
      let h = 0;
      for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
      arr[h % arr.length] += 1;
    }
    const norm = Math.sqrt(arr.reduce((a, b) => a + b * b, 0)) || 1;
    return arr.map((x) => x / norm);
  }
}
