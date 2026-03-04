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
