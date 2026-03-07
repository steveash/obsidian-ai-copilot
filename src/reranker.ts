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
