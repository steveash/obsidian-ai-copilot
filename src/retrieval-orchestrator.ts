import type { AICopilotSettings } from "./settings";
import {
  applyGraphBoost,
  cosine,
  extractMetadata,
  freshnessScore,
  lexicalScore,
  metadataBoost,
  parseQueryConstraints,
  passesQueryConstraints,
  type NoteDoc,
  type RetrievedNote
} from "./semantic-retrieval";
import { chunkMarkdownByHeading } from "./chunker";
import { formatChunkContent, formatChunkPreview, mergeChunkResultsToFullNotes } from "./retrieval-context";
import { createReranker, HeuristicReranker } from "./reranker";
import type { PersistentVectorIndex } from "./vector-index";

export interface RetrievalDeps {
  getAllNotes: () => Promise<NoteDoc[]>;
  getVectorIndex: () => PersistentVectorIndex;
  getSettings: () => AICopilotSettings;
}

export class RetrievalOrchestrator {
  constructor(private readonly deps: RetrievalDeps) {}

  async getRelevantNotes(query: string, maxResults: number): Promise<RetrievedNote[]> {
    const notes = await this.deps.getAllNotes();
    const settings = this.deps.getSettings();
    const constraints = parseQueryConstraints(query);

    const pre = notes
      .map((n) => {
        const metadata = extractMetadata(n.content);
        if (!passesQueryConstraints(n, metadata, constraints)) {
          return { n, lex: 0, fresh: 0, metaBoost: 0, metadata, preScore: -1 };
        }
        const lex = lexicalScore(n, constraints.terms);
        const fresh = freshnessScore(n.mtime);
        const metaBoost = metadataBoost(n, metadata, constraints);
        return { n, lex, fresh, metaBoost, metadata, preScore: lex + 0.25 * fresh + metaBoost };
      })
      .filter((x) => x.preScore >= 0)
      .sort((a, b) => b.preScore - a.preScore)
      .slice(0, Math.max(maxResults, settings.preselectCandidateCount));

    const vectorIndex = this.deps.getVectorIndex();
    const queryVec = await vectorIndex.getOrCreate("__query__", "__query__", query, settings.embeddingModel);

    const ranked: RetrievedNote[] = [];
    for (const c of pre) {
      const chunks = chunkMarkdownByHeading(c.n.path, c.n.content, settings.retrievalChunkSize);
      for (const ch of chunks) {
        const chunkContent = formatChunkContent(c.n.path, ch.heading, ch.text);
        const docVec = await vectorIndex.getOrCreate(
          ch.chunkId,
          c.n.path,
          chunkContent,
          settings.embeddingModel,
          c.n.mtime
        );
        const sem = cosine(docVec, queryVec);
        const score =
          settings.retrievalLexicalWeight * c.lex +
          settings.retrievalSemanticWeight * sem +
          settings.retrievalFreshnessWeight * c.fresh +
          c.metaBoost;
        ranked.push({
          path: c.n.path,
          content: formatChunkPreview(ch.heading, ch.text),
          mtime: c.n.mtime,
          score,
          lexicalScore: c.lex,
          semanticScore: sem,
          freshnessScore: c.fresh,
          graphBoost: c.metaBoost,
          metadata: { ...c.metadata, fullContent: c.n.content }
        });
      }
    }

    let final = applyGraphBoost(ranked, Math.max(maxResults, settings.rerankerTopK), settings.retrievalGraphExpandHops)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(maxResults, settings.rerankerTopK));

    if (settings.rerankerEnabled) {
      let reranker = createReranker(settings);
      let reranked;
      try {
        reranked = await reranker.rerank(
          query,
          final
            .slice(0, settings.rerankerTopK)
            .map((x, i) => ({ id: `${i}:${x.path}`, text: `${x.path}\n${x.content}`, score: x.score }))
        );
      } catch {
        reranker = new HeuristicReranker();
        reranked = await reranker.rerank(
          query,
          final
            .slice(0, settings.rerankerTopK)
            .map((x, i) => ({ id: `${i}:${x.path}`, text: `${x.path}\n${x.content}`, score: x.score }))
        );
      }

      const map = new Map(final.map((x) => [`${x.path}\n${x.content}`, x]));
      final = reranked
        .map((r) => map.get(r.text))
        .filter((x): x is RetrievedNote => Boolean(x))
        .concat(final)
        .slice(0, maxResults);
    } else {
      final = final.slice(0, maxResults);
    }

    return mergeChunkResultsToFullNotes(final).slice(0, maxResults);
  }
}
