# Obsidian AI Copilot

Obsidian plugin scaffold for an AI assistant focused on:

- Chat over your vault notes
- Scheduled note refinement
- TODO extraction and duplicate-note detection

## Implemented

- Plugin entry + commands:
  - **AI Copilot: Chat about active note**
  - **AI Copilot: Chat using vault query**
  - **AI Copilot: Run refinement now**
- Settings tab:
  - Provider selection (`none` dry-run or `openai`)
  - OpenAI API key + model
  - Chat note result limit
  - Refinement interval + lookback window
  - Web-enrichment toggle
- Retrieval/ranking engine for relevant notes (`src/search.ts`)
- Refinement planner:
  - TODO extraction
  - Duplicate-title clusters
  - Action suggestions
- Structured output logs written into vault:
  - `AI Copilot/Chat Output.md`
  - `AI Copilot/Refinement Log.md`
- Sensitive data redaction before writing assistant output (`src/safety.ts`)

## Quality

- Unit tests (Vitest): ranking, refinement prompt, planner, safety redaction
- CI workflow runs `npm test` + `npm run build` on pushes/PRs

## Local development

```bash
npm install
npm test
npm run build
```

## Next feature ideas

1. Inline diff preview + one-click apply for refinement edits.
2. Embeddings-based semantic search (instead of keyword-only ranking).
3. Provider abstraction for Anthropic/OpenRouter/local models.
4. Background job status panel (last run, errors, note counts).
5. Optional internet-enrichment connector with explicit allowlists.

## Notes

Current implementation is functional but intentionally conservative:
- Refinement writes suggestions to logs by default (safe-by-default).
- `openai` provider requires user-configured API key in plugin settings.


## Implemented features (current)

- Settings tab for provider/model/refinement schedule
- Query-based note chat with ranked context
- Dedicated AI Copilot chat panel view
- Scheduled refinement run with plan + output logs
- Safe deterministic auto-apply hook (spacing normalization)
- Sensitive data redaction before writing logs
- CI workflow (test + build)


## Integration-style test coverage

- `tests/vault-index.test.ts` validates recent-note filtering and retrieval against an in-memory vault adapter.
- This keeps core retrieval logic testable outside Obsidian runtime.

## Release packaging

Build release artifacts:

```bash
npm run release:bundle
```

This writes `manifest.json`, `main.js`, `styles.css`, and `versions.json` to `dist/`.


## Retrieval design notes (researched + implemented)

Implemented a local **hybrid retrieval** pipeline inspired by common RAG best practices:

- Lexical overlap score (BM25-style sparse signal)
- Local embedding cosine similarity (dense-ish semantic signal)
- Freshness boost from note `mtime`
- Graph enrichment via `[[wikilinks]]` from top-ranked notes
- Metadata extraction (`tags`, `headings`, `links`) for future filtering/reranking

This gives better robustness for both exact-term and concept-level queries while staying fully local/private.


## Persistent vector index (new)

- Embeddings are persisted to `AI Copilot/.index/vectors.json` inside the vault.
- Uses OpenAI embeddings endpoint by default (`text-embedding-3-large`) when provider is OpenAI.
- Retrieval flow is now two-stage:
  1) lexical preselect top-N
  2) vector rerank + freshness + wikilink graph boost
- Command added: **AI Copilot: Rebuild persistent vector index**


## Added retrieval upgrades

- Incremental vector updates on note modify/delete events
- Chunk-level embeddings (heading-based chunks)
- Optional reranker pass for top-k results

This improves long-note retrieval quality and keeps index fresh without full rebuilds.


## Best reranker mode

- Added OpenAI LLM reranker mode (default) for higher precision ranking.
- Configurable via settings:
  - `rerankerType`: `openai` (default) or `heuristic`
  - `rerankerModel`: default `gpt-4.1-mini`
- Automatic fallback to heuristic reranker on API errors.
