# Obsidian AI Copilot

Early scaffold for an Obsidian plugin that provides:

- LLM chat over vault notes
- Scheduled note refinement (dedupe, TODO extraction, context enrichment)

## Current status

This repo is bootstrapped with:

- `manifest.json` plugin metadata
- `src/main.ts` plugin entry
- `src/refinement.ts` pure prompt builder logic
- `vitest` unit test setup

## Dev

```bash
npm install
npm test
npm run build
```

## Next milestones

1. Add settings tab for provider/model/API key storage.
2. Implement vault indexing + retrieval for chat.
3. Add scheduled refinement runner and dry-run previews.
4. Add internet-research tool toggle per refinement job.
5. Add end-to-end plugin tests against mocked vault APIs.
