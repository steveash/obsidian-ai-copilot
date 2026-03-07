# Obsidian AI Copilot

Obsidian plugin for vault-aware AI workflows:
- chat over notes
- scheduled refinement passes
- hybrid lexical + semantic retrieval with persistent vectors
- retrieval context that includes **relevant sections and full note content**

---

## Current capabilities

### Commands
- **AI Copilot: Open chat panel**
- **AI Copilot: Chat about active note**
- **AI Copilot: Chat using vault query**
- **AI Copilot: Rebuild persistent vector index**
- **AI Copilot: Run refinement now**
- **AI Copilot: Preview structured refinement patch**
- **AI Copilot: Roll back last refinement patch**
- **AI Copilot: Show indexing queue status**

### Retrieval pipeline
- lexical preselect over vault notes
- heading-based chunking for semantic ranking
- persistent vector cache in `AI Copilot/.index/vectors.json`
- freshness and wikilink graph boost
- optional reranker (`openai` or `heuristic` fallback)
- merged retrieval context returns:
  1) top relevant section snippets
  2) full source note body
- metadata-aware query controls:
  - `folder:projects` limit by path prefix
  - `tag:release` filter/boost by tags
  - `link:Roadmap` filter/boost by backlinks/wikilinks
  - `after:2026-01-01` / `before:2026-12-31` date filters
  - quoted filter values are supported (example: `folder:"Projects/AI Notes" link:"release board"`)
  - invalid filter syntax safely falls back to plain query terms instead of hard-failing retrieval

### Refinement/logging
- scheduled refinement loop
- TODO extraction and duplicate-title detection helpers
- structured patch workflow (preview/apply/rollback) for safe note updates
- patch preview now supports multi-edit patch plans with validation, per-edit status, and replace-all edit support
- safe append-only logs:
  - `AI Copilot/Chat Output.md`
  - `AI Copilot/Refinement Log.md`
- configurable sensitive-value redaction before log writes

### Chat panel UX
- persistent right-panel chat
- assistant responses include source citations
- click citations to navigate directly to source notes

---

## Local Obsidian bootstrap (clean setup)

### 1) Clone and install dependencies

```bash
git clone https://github.com/steveash/obsidian-ai-copilot.git
cd obsidian-ai-copilot
npm install
```

### 2) Build plugin bundle

```bash
npm run build
```

### 3) Install into an Obsidian vault (development install)

Pick your vault path and copy required plugin files into:
`<VAULT>/.obsidian/plugins/obsidian-ai-copilot/`

```bash
mkdir -p "<VAULT>/.obsidian/plugins/obsidian-ai-copilot"
cp manifest.json main.js styles.css "<VAULT>/.obsidian/plugins/obsidian-ai-copilot/"
```

### 4) Enable plugin in Obsidian
1. Open Obsidian → **Settings** → **Community plugins**
2. Disable Safe Mode if needed
3. Enable **Obsidian AI Copilot**

---

## First-run configuration (API key + models)

In Obsidian plugin settings (**AI Copilot Settings**):

1. Set **Provider** to `openai`
2. Paste **OpenAI API key**
3. Optionally tune:
   - OpenAI chat model (`gpt-4o-mini` default)
   - embedding model (`text-embedding-3-large` default)
   - reranker model (`gpt-4.1-mini` default)
4. Run **AI Copilot: Rebuild persistent vector index** once after initial enablement (or after major vault changes)

If no key is configured, set provider to `none` for dry-run/local behavior.

---

## Internal architecture (for contributors)

Core runtime orchestration is split into dedicated modules:
- `src/chat-orchestrator.ts` — chat panel + query/active-note chat flow
- `src/retrieval-orchestrator.ts` — retrieval scoring/reranking/merge pipeline
- `src/indexing-orchestrator.ts` — vector index lifecycle + vault sync queue/events
- `src/command-registration.ts` — plugin command wiring + refinement flow wiring
- `src/patch-plan.ts` — structured patch plan validation/preview/apply/rollback

`src/main.ts` now focuses on plugin bootstrap and dependency composition.

## Development loop

Use this loop for every change:

```bash
npm test
npm run build
npx tsc --noEmit
```

Then copy updated `main.js` / `manifest.json` / `styles.css` into your vault plugin directory and reload Obsidian.

Tip: in Obsidian, use **Reload app without saving** (Command Palette) after replacing bundle files.

---

## Testing coverage

- unit tests for planner, refinement, chunking, reranker, safety, semantic helpers
- vector index cache behavior tests
- integration-style retrieval/indexing tests using in-memory storage/mocks for:
  - event-driven note update indexing path
  - delete-path vector cleanup
  - merged retrieval output (sections + full note)

Run all tests:

```bash
npm test
```

---

## Release bundle usage

Create distributable artifacts:

```bash
npm run release:bundle
```

For a full release-quality gate (tests + build + typecheck + dist bundle):

```bash
npm run release:check
```

Output is written to `dist/`:
- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

Track user-facing changes in `CHANGELOG.md`.

Use these files for manual installs or release uploads.
