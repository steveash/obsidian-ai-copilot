import type { AICopilotSettings } from "./settings";
import type { EmbeddingProvider } from "./vector-index";
import { signBedrockRequest } from "./bedrock-signing";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly settings: AICopilotSettings) {}

  async embed(text: string, model: string): Promise<number[]> {
    if (!this.settings.openaiApiKey) throw new Error("Missing OpenAI API key");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.openaiApiKey}`
      },
      body: JSON.stringify({ model, input: text.slice(0, 20000) })
    });
    if (!res.ok) throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return json.data?.[0]?.embedding ?? [];
  }
}

export class BedrockEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly settings: AICopilotSettings) {}

  async embed(text: string, model: string): Promise<number[]> {
    if (!this.settings.bedrockAccessKeyId || !this.settings.bedrockSecretAccessKey) {
      throw new Error("AWS Bedrock credentials missing for embedding");
    }

    const region = this.settings.bedrockRegion;
    const body = JSON.stringify({
      inputText: text.slice(0, 20000),
      dimensions: 1024,
      normalize: true
    });

    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const encodedPath = `/model/${encodeURIComponent(model)}/invoke`;
    const url = new URL(`https://${host}${encodedPath}`);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const headers = await signBedrockRequest(
      "POST", url, body, timestamp, region,
      this.settings.bedrockAccessKeyId, this.settings.bedrockSecretAccessKey
    );

    const res = await fetch(`https://${host}${encodedPath}`, {
      method: "POST",
      headers,
      body
    });

    if (!res.ok) throw new Error(`Bedrock embedding request failed: ${res.status} ${await res.text()}`);

    const json = (await res.json()) as { embedding?: number[] };
    return json.embedding ?? [];
  }
}

export class FallbackHashEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
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
