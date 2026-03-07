import type { AICopilotSettings } from "./settings";

type RerankerSettings = Pick<AICopilotSettings, "rerankerType" | "openaiApiKey" | "rerankerModel">;

export interface RerankCandidate {
  id: string;
  text: string;
  score: number;
}

export interface Reranker {
  rerank(query: string, candidates: RerankCandidate[]): Promise<RerankCandidate[]>;
}

export class HeuristicReranker implements Reranker {
  async rerank(query: string, candidates: RerankCandidate[]): Promise<RerankCandidate[]> {
    const q = query.toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);

    return [...candidates]
      .map((c) => {
        const t = c.text.toLowerCase();
        const termHits = terms.reduce((acc, term) => (t.includes(term) ? acc + 1 : acc), 0);
        const phraseBonus = t.includes(q) ? 0.5 : 0;
        const headingBonus = /(^|\n)#{1,6}\s/.test(c.text) ? 0.1 : 0;
        return { ...c, score: c.score + termHits * 0.08 + phraseBonus + headingBonus };
      })
      .sort((a, b) => b.score - a.score);
  }
}

export class OpenAIReranker implements Reranker {
  constructor(private readonly settings: RerankerSettings) {}

  async rerank(query: string, candidates: RerankCandidate[]): Promise<RerankCandidate[]> {
    if (!this.settings.openaiApiKey) throw new Error("Missing OpenAI API key");

    const compact = candidates.map((c, i) => ({ idx: i, id: c.id, text: c.text.slice(0, 2500) }));
    const prompt = [
      "Rank candidate passages by relevance to the user query.",
      "Return strict JSON only in this format:",
      '{"ranked":[{"idx":number,"relevance":number}]}',
      "Relevance must be 0..1.",
      `Query: ${query}`,
      `Candidates: ${JSON.stringify(compact)}`
    ].join("\n\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.openaiApiKey}`
      },
      body: JSON.stringify({
        model: this.settings.rerankerModel || "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a precise ranking engine." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!res.ok) {
      throw new Error(`OpenAI rerank failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as { ranked?: Array<{ idx: number; relevance: number }> };

    const scored = [...candidates];
    for (const r of parsed.ranked ?? []) {
      if (r.idx >= 0 && r.idx < scored.length) {
        scored[r.idx] = { ...scored[r.idx], score: scored[r.idx].score + Math.max(0, Math.min(1, r.relevance)) };
      }
    }

    return scored.sort((a, b) => b.score - a.score);
  }
}

export function createReranker(settings: RerankerSettings): Reranker {
  if (settings.rerankerType === "openai") return new OpenAIReranker(settings);
  return new HeuristicReranker();
}
