# Development Guide

## Prerequisites

- Node.js 22+
- npm
- Obsidian desktop app (for manual testing)
- A test vault (do NOT use your real vault for development)

## Setup

```bash
git clone https://github.com/steveash/obsidian-ai-copilot.git
cd obsidian-ai-copilot
npm install
```

## Build & Test Loop

```bash
# Run all tests (fast, no Obsidian needed)
npm test

# Watch mode (re-runs on file change)
npm run test:watch

# Typecheck
npm run typecheck

# Build plugin bundle
npm run build

# All three at once
npm run check
```

## Install into a Test Vault

After building, symlink or copy the plugin into your test vault:

```bash
# Option A: Symlink (recommended — no re-copy after each build)
VAULT="$HOME/obsidian-test-vault"
mkdir -p "$VAULT/.obsidian/plugins"
ln -s "$(pwd)" "$VAULT/.obsidian/plugins/obsidian-ai-copilot"

# Option B: Copy files manually
VAULT="$HOME/obsidian-test-vault"
mkdir -p "$VAULT/.obsidian/plugins/obsidian-ai-copilot"
cp manifest.json main.js styles.css "$VAULT/.obsidian/plugins/obsidian-ai-copilot/"
```

With the symlink approach, `npm run build` updates `main.js` in place and you
just need to reload in Obsidian.

## Reload After Changes

1. `npm run build`
2. In Obsidian: **Ctrl+P** (or **Cmd+P**) → "Reload app without saving"
   - Or: **Settings → Community Plugins → Disable/Enable** the plugin

If you have the [Hot Reload plugin](https://github.com/pjeby/hot-reload)
installed in your test vault, it will auto-reload when `main.js` changes.

## Testing Architecture

Tests use **Vitest** and run entirely outside of Obsidian. The key abstraction
is `VaultAdapter` (`src/vault-adapter.ts`):

- **`VaultAdapter`** — interface for all vault I/O (read, write, list, events)
- **`InMemoryVaultAdapter`** — test implementation, no filesystem or Obsidian needed
- **`ObsidianVaultAdapter`** — production implementation wrapping `Obsidian.Vault`

All business logic (retrieval, patching, refinement, chat orchestration, LLM
calls) is tested against `InMemoryVaultAdapter` with mocked providers. This
means tests are fast (~3 seconds for the full suite) and CI-friendly.

### Writing tests

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryVaultAdapter } from "../src/vault-adapter";

describe("my feature", () => {
  it("does the thing", async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.create("notes/test.md", "# Hello\nSome content");

    // Test your logic against the vault adapter
    const content = await vault.read("notes/test.md");
    expect(content).toContain("Hello");
  });
});
```

### What to mock

| Dependency | Mock strategy |
|---|---|
| Vault I/O | `InMemoryVaultAdapter` |
| LLM calls | `DryRunClient` or `vi.fn()` returning canned responses |
| Embeddings | `FallbackHashEmbeddingProvider` or mock returning fixed vectors |
| Obsidian types | Not imported at runtime in testable code (types only) |

### Running specific tests

```bash
# Run a single test file
npx vitest run tests/patch-plan.test.ts

# Run tests matching a pattern
npx vitest run -t "refinement"

# Run with verbose output
npx vitest run --reporter=verbose
```

## Manual Testing Checklist

After building and loading the plugin in your test vault:

1. **Plugin loads** — "AI Copilot loaded." notice appears
2. **Settings panel** — Settings → AI Copilot Settings renders, saves correctly
3. **Chat panel** — Command: "AI Copilot: Open chat panel" opens right sidebar
4. **Chat query** — Send a query, get a response (use dry-run or real provider)
5. **Chat active note** — Open a note, run "Chat about active note"
6. **Index rebuild** — "Rebuild persistent vector index" completes without error
7. **Refinement** — "Run refinement now" processes recent notes
8. **Patch preview** — "Preview structured refinement patch" generates preview
9. **Rollback** — After applying edits, rollback restores original content
10. **Mobile** — Open same vault on Obsidian Mobile, verify chat panel renders

## Mobile Testing

Obsidian Mobile (iOS/Android) uses Capacitor, not Electron. Key differences:
- Viewport is narrower — test chat panel at 375px width
- Touch scrolling instead of mouse wheel
- No `window.prompt()` — modal input needed for query command
- File system access via Capacitor bridge (transparent if using Obsidian API)

To test: sync your test vault to mobile via Obsidian Sync or iCloud/Google Drive,
enable the plugin, and run through the manual checklist above.

## Project Structure

```
src/
  main.ts                    # Plugin bootstrap
  chat-orchestrator.ts       # Chat panel + query flows
  retrieval-orchestrator.ts  # Hybrid retrieval pipeline
  indexing-orchestrator.ts   # Vector index lifecycle
  command-registration.ts    # Plugin commands
  semantic-retrieval.ts      # Scoring, constraints, metadata
  vector-index.ts            # Persistent vector cache
  patch-plan.ts              # Patch validation/preview/apply/rollback
  smart-refinement.ts        # Multi-file refinement workflow
  llm.ts                     # LLM provider clients
  embedding-provider.ts      # Embedding providers
  vault-adapter.ts           # Vault I/O abstraction
  settings.ts                # Plugin settings + UI
  ...
tests/
  *.test.ts                  # All test files
```

## CI

GitHub Actions runs on every push to `main` and all PRs:
- `npm test`
- `npm run build`
- `npx tsc --noEmit`

Release bundle workflow triggers on version tags (`v*`).

## Release

```bash
npm run release:check    # test + build + typecheck + bundle
ls dist/                 # manifest.json, main.js, styles.css, versions.json
```
