import type { AICopilotSettings } from "./settings";
import type { EmbeddingProvider } from "./vector-index";

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
