# Research: Headless Obsidian Testing Approaches

**Issue:** ob-20g
**Date:** 2026-03-17
**Status:** Recommended approach selected with proof-of-concept

## Executive Summary

**Recommendation: Option 2 — Vitest + Lightweight Obsidian API Shim (expand the existing adapter pattern)**

This gives the best coverage/effort tradeoff for CI-runnable integration tests. The plugin
already uses dependency injection via `VaultAdapter`, `VectorStorage`, and `EmbeddingProvider`
interfaces. Extending this pattern with a thin Obsidian API shim unlocks integration testing
of the remaining untested surface (plugin lifecycle, command registration, chat orchestration,
settings tab) without any Electron dependency.

## Current State

- **138+ tests** pass via Vitest with in-memory adapters
- **Well-tested:** chunker, planner, reranker, safety, semantic-retrieval, vector-index,
  patch-plan, patcher, smart-refinement, retrieval-integration, orchestrators
- **Not tested:** plugin lifecycle (`onload`/`onunload`), command registration,
  `AICopilotChatView` (extends `ItemView`), `AICopilotSettingTab` (extends `PluginSettingTab`),
  `ChatOrchestrator.activateChatView` (workspace manipulation)

### Obsidian API Surface Used

| Module | Obsidian Imports | Testability |
|--------|-----------------|-------------|
| `main.ts` | `Plugin`, `Notice` | Needs shim |
| `chat.ts` | `ItemView`, `Notice`, `TFile`, `WorkspaceLeaf` | Needs shim |
| `chat-orchestrator.ts` | `Notice`, `App`, `TFile`, `WorkspaceLeaf` | Partially testable (vault ops use adapter) |
| `command-registration.ts` | `App`, `Command`, `Notice`, `TFile` | Needs shim for App/Notice |
| `settings.ts` | `App`, `PluginSettingTab`, `Setting` | Needs shim |
| `obsidian-vault-adapter.ts` | `TFile`, `App` | Production adapter, not tested directly |

## Options Evaluated

### Option 1: jest-environment-obsidian

**What:** Community Jest environment that shims the `obsidian` module.

**Pros:**
- Automatic obsidian import shimming
- Community-maintained API stubs
- Validation meta-tests against real Obsidian API

**Cons:**
- **Jest-only** — this project uses Vitest; switching frameworks is costly
- **v0.0.1, 8 stars, last updated April 2023** — effectively abandoned
- Incomplete API coverage (explicitly WIP)
- No TypeScript-first design
- Would require maintaining a fork or migrating test runner

**Verdict: REJECT** — Framework mismatch (Jest vs Vitest), unmaintained, incomplete.

### Option 2: Vitest + Lightweight Obsidian API Shim (RECOMMENDED)

**What:** Create a minimal `obsidian` module shim for Vitest that stubs only the
types/classes this plugin actually uses. Extend the existing adapter pattern to cover
plugin lifecycle and workspace operations.

**Pros:**
- **Zero new dependencies** — works with existing Vitest setup
- **Minimal shim surface** — only need ~8 classes/types (Plugin, ItemView, Notice, etc.)
- **Leverages existing architecture** — VaultAdapter pattern already proven
- **Fast** — runs in Node.js, no Electron overhead
- **CI-friendly** — no display server, no binary downloads
- **Type-safe** — shim implements the same TypeScript interfaces
- **Incremental** — add shim coverage as needed, doesn't block current tests

**Cons:**
- Shim may diverge from real Obsidian API behavior over time
- Can't test real DOM rendering or Electron-specific behavior
- Manual maintenance of shim when Obsidian SDK updates

**Effort:** ~2-4 hours for initial shim + 3-5 integration tests
**Coverage gain:** Plugin lifecycle, command registration, chat orchestration

**Verdict: RECOMMENDED** — Best coverage/effort ratio, CI-native, builds on existing patterns.

### Option 3: Electron Headless with Real Obsidian (wdio-obsidian-service)

**What:** WebdriverIO service that downloads Obsidian, runs it headless, and drives
it via WebDriver protocol for E2E testing.

**Pros:**
- Tests against real Obsidian — highest fidelity
- Cross-platform (Windows, macOS, Linux, Android)
- Sandbox isolation between test runs
- Catches real integration issues

**Cons:**
- **Heavy CI dependency** — requires Electron/display server (Xvfb on Linux)
- **Slow** — Obsidian startup + WebDriver overhead = seconds per test
- **Fragile** — depends on Obsidian release binaries, download availability
- **Complex setup** — 3 npm packages, WebdriverIO config, vault fixtures
- **Overkill** — this plugin's Obsidian API surface is small and well-abstracted
- **Licensing** — running Obsidian in CI may have EULA implications

**Effort:** ~8-16 hours setup, ongoing maintenance
**Coverage gain:** Full E2E, but duplicates what unit tests already cover

**Verdict: REJECT for now** — Excessive overhead for the coverage gain. Consider later
if the plugin grows complex UI interactions that can't be tested via shim.

### Option 4: Expand InMemoryVaultAdapter Only

**What:** Keep the current approach — only test code behind the VaultAdapter boundary.
Don't shim any Obsidian types.

**Pros:**
- Zero new infrastructure
- Already working well for business logic

**Cons:**
- **Leaves plugin lifecycle untested** — `onload()`, command registration, settings
- **Can't test ChatOrchestrator.activateChatView** — depends on workspace API
- **Can't test AICopilotChatView** — extends `ItemView`
- **Diminishing returns** — the easy wins are already captured

**Verdict: INSUFFICIENT** — Good foundation but leaves too much untested code.
This is what we already have; the question is what to add on top.

### Option 5: Obsimian (Obsidian Simulation Framework)

**What:** npm package that provides fake `App`, `Vault`, `Plugin` implementations
populated from exported vault data.

**Pros:**
- Pre-built fakes for core Obsidian types
- Can test against real vault snapshots

**Cons:**
- **21 stars, 19 commits** — very early stage
- Requires companion plugin to export vault data
- Acknowledged behavioral gaps with real Obsidian
- Not designed for Vitest integration
- Extra dependency for something we can build leaner ourselves

**Verdict: REJECT** — Too immature, unnecessary dependency when our shim needs are small.

## Recommended Approach: Detailed Design

### Architecture

```
tests/
  __mocks__/
    obsidian.ts          ← Vitest module mock for "obsidian" package
  integration/
    plugin-lifecycle.test.ts
    command-registration.test.ts
    chat-view.test.ts
```

### Obsidian Module Shim (`tests/__mocks__/obsidian.ts`)

Stub only what this plugin imports:

| Class/Type | Shim Strategy |
|-----------|---------------|
| `Plugin` | Base class with `app`, `addCommand()`, `registerView()`, `loadData()`, `saveData()`, `addSettingTab()`, `registerInterval()`, `registerEvent()` |
| `ItemView` | Base class with `containerEl`, `app`, `getViewType()`, `getDisplayText()` |
| `Notice` | Constructor that records message (for assertion) |
| `PluginSettingTab` | Base class with `app`, `plugin`, `containerEl` |
| `Setting` | Builder-pattern stub (`.setName().setDesc().addText()`) |
| `TFile` | Simple class with `path`, `basename`, `stat.mtime` |
| `WorkspaceLeaf` | Stub with `view`, `setViewState()` |
| `App` | Object with `vault` and `workspace` sub-objects |

### What This Unlocks

1. **Plugin lifecycle test:** Instantiate `AICopilotPlugin` with mock `App`, call
   `onload()`, verify commands registered, settings tab added, indexing started.

2. **Command registration test:** Verify all commands are registered with correct
   IDs and callbacks, test command execution with mock vault state.

3. **Chat view test:** Instantiate `AICopilotChatView` with mock leaf, verify
   rendering, test submit handler wiring, verify citation click behavior.

4. **Settings tab test:** Verify settings UI renders, test setting changes persist.

### Integration with Existing Tests

- Existing tests continue to work unchanged (they don't import from "obsidian")
- New integration tests use the shim via Vitest's module mocking
- The shim is test infrastructure only — never shipped

## Proof of Concept

See `tests/__mocks__/obsidian.ts` and `tests/integration/plugin-lifecycle.test.ts`
committed alongside this document.

## CI Impact

- **No new CI dependencies** — Vitest already runs in CI
- **No display server needed** — pure Node.js execution
- **Estimated test time increase:** <2 seconds for initial integration tests
- **Maintenance burden:** Low — shim surface is small and plugin's Obsidian API usage is stable
