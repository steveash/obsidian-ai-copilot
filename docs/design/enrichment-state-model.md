# Enrichment State Model Design

## Overview

This document defines the per-note enrichment state machine for the Obsidian AI
Copilot plugin. The state model tracks where each note stands in the
enrichment lifecycle: from initial analysis through suggestion, approval, and
application.

The design builds on the existing refinement system (`smart-refinement.ts`,
`patch-plan.ts`) and extends it with persistent per-note state tracking.

## State Machine

### States

| State | Description |
|-------|-------------|
| `unenriched` | Note has not been processed by the enrichment system, or its content has changed since the last enrichment cycle invalidated prior state. This is the default/initial state. |
| `analyzing` | Enrichment is currently running LLM analysis on this note. Prevents concurrent enrichment of the same note. |
| `auto-enriched` | Safe edits were automatically applied (risk=safe, confidence >= 0.8, no conflicts, no safety issues). No user action needed. |
| `suggested` | Non-trivial edits were generated and are awaiting user review. The user can approve, reject, or escalate individual edits. |
| `human-required` | The system flagged this note for mandatory human review due to one or more intervention triggers (see below). |
| `approved` | User approved suggested changes; edits are queued for application. |
| `applied` | Approved changes have been written to the note. Snapshot stored for rollback. |
| `rejected` | User explicitly rejected the suggested changes for this enrichment cycle. |

### Transition Diagram

```
                    +------------------+
                    |   unenriched     |<----------------------------------+
                    +------------------+                                   |
                           |                                              |
                     [enrichment cycle starts]                            |
                           |                                              |
                           v                                              |
                    +------------------+                                  |
                    |    analyzing     |                                  |
                    +------------------+                                  |
                      /      |       \                                    |
            [all safe]  [has edits]  [triggers met]                       |
                    /        |          \                                  |
                   v         v           v                                |
          +-------------+ +----------+ +----------------+                |
          |auto-enriched| |suggested | |human-required  |                |
          +-------------+ +----------+ +----------------+                |
                |           / |    \         |    \                       |
                |     [approve] [reject] [resolve] [reject]              |
                |         /    |      \      |        \                   |
                |        v     |       v     v         v                  |
                |  +--------+  |  +--------+ |   +---------+             |
                |  |approved|  |  |rejected| |   |rejected |             |
                |  +--------+  |  +--------+ |   +---------+             |
                |      |       |      |      |        |                  |
                |  [apply]     |  [note edit / next cycle]               |
                |      |       |      |      |        |                  |
                |      v       |      +------+--------+------------------+
                |  +--------+  |             |
                |  |applied |  |     [user downgrades to suggested]
                |  +--------+  |             |
                |      |       |             v
                +------+-------+--------> (back to suggested)
                       |
                [note edited by user]
                       |
                       v
                (back to unenriched)
```

### Transition Rules

| From | To | Trigger | Condition |
|------|----|---------|-----------|
| `unenriched` | `analyzing` | Enrichment cycle starts | Note is a candidate (modified within lookback window) |
| `analyzing` | `auto-enriched` | LLM returns edits | All edits pass safe auto-apply filter: `risk === "safe"` AND `confidence >= 0.8` AND no conflicts AND no safety issues AND `refinementAutoApply` enabled |
| `analyzing` | `suggested` | LLM returns edits | At least one edit does not pass the safe auto-apply filter, but no intervention triggers are met |
| `analyzing` | `human-required` | LLM returns edits | One or more human-intervention triggers are met (see below) |
| `analyzing` | `unenriched` | LLM returns no edits | No suggestions generated; note returns to unenriched |
| `suggested` | `approved` | User approves | User selects edits to apply (all or subset) |
| `suggested` | `rejected` | User rejects | User explicitly rejects all suggestions |
| `suggested` | `human-required` | User escalates | User flags note for deeper review |
| `human-required` | `suggested` | User resolves | User downgrades after reviewing the concern |
| `human-required` | `rejected` | User rejects | User rejects after reviewing |
| `approved` | `applied` | System applies | Edits applied to note via `applyPatchPlan` |
| `applied` | `unenriched` | Note modified by user | Content hash changed since enrichment; invalidate state |
| `auto-enriched` | `unenriched` | Note modified by user | Content hash changed since enrichment; invalidate state |
| `rejected` | `unenriched` | Next enrichment cycle | On next cycle, rejected notes re-enter candidacy |

### Invalidation

Any user edit to a note (detected via content hash change or vault `modify`
event) transitions `auto-enriched` or `applied` notes back to `unenriched`.
This prevents stale enrichment state from persisting after the user changes
the underlying content.

Notes in `suggested`, `human-required`, or `approved` states are also
invalidated if the content hash changes, since the pending edits may no longer
apply cleanly.

## Human-Intervention-Required Triggers

A note enters the `human-required` state when ANY of these conditions are met
during the `analyzing` phase:

### 1. Low Confidence (threshold: < 0.6)

The **average confidence** across all proposed edits for a note falls below
0.6. Individual edits may have high confidence, but a low average indicates
the LLM is uncertain about the overall enrichment strategy.

```typescript
const avgConfidence = edits.reduce((sum, e) => sum + (e.confidence ?? 1), 0) / edits.length;
if (avgConfidence < 0.6) triggers.push("low-confidence");
```

**Rationale**: Low-confidence edits applied automatically lead to user distrust.
Better to surface them for review and let the user build confidence in the
system's suggestions.

### 2. Conflicting Evidence

Multiple notes in the same enrichment batch contain contradictory information
about the same entity, date, or claim. Detected by the LLM during analysis
(returned as a structured flag in the patch plan response).

Example: Note A says "Project launched Q1 2026" while Note B says "Project
launched Q2 2026". The enrichment system cannot resolve the conflict
autonomously.

```typescript
if (parseResult.flags?.includes("conflicting-evidence")) triggers.push("conflicting-evidence");
```

**Rationale**: Automatically resolving factual conflicts risks propagating
incorrect information across the vault.

### 3. Ambiguous Intent

The note's structure suggests multiple valid enrichment strategies and the LLM
cannot confidently choose one. Examples:
- A note with mixed meeting notes and action items where enrichment could
  organize by topic OR by person
- A brainstorming note where "enrichment" might mean structuring ideas vs.
  adding research links

Detected via an LLM-returned flag in the response.

```typescript
if (parseResult.flags?.includes("ambiguous-intent")) triggers.push("ambiguous-intent");
```

### 4. Destructive Rewrite Risk (threshold: > 30% content changed)

The proposed edits would modify more than 30% of the note's character content.
Measured by computing the total `find` string length as a proportion of the
original note length.

```typescript
const totalFindLength = edits.reduce((sum, e) => sum + e.find.length, 0);
const changeRatio = totalFindLength / originalContent.length;
if (changeRatio > 0.3) triggers.push("destructive-rewrite");
```

**Rationale**: Large rewrites fundamentally change the note's character. The
user should explicitly approve such transformations. The 30% threshold balances
between allowing meaningful enrichment (adding structure, fixing formatting)
and preventing wholesale replacement of user-authored content.

### 5. Safety Check Failures

Any edit in the batch triggers a safety check failure from `runSafetyChecks`:
path protection (`.obsidian/`, `.git/`), size limits (> 50KB), or secret
pattern detection.

```typescript
if (preview.edits.some(e => e.safetyIssues.length > 0)) triggers.push("safety-failure");
```

### 6. All Edits Conflicting

Every proposed edit has a conflict (stale or ambiguous). If zero edits can
apply cleanly, the note needs human attention to determine if the LLM's
understanding of the note is outdated.

```typescript
if (conflicts.length === edits.length && edits.length > 0) triggers.push("all-conflicting");
```

## Storage Recommendation

### Decision: Sidecar JSON in `AI Copilot/.enrichment/`

**Chosen approach**: Per-note sidecar JSON files stored in the plugin's
existing `AI Copilot/` namespace directory.

#### Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| **Frontmatter** | Visible, portable, queryable by Dataview/other plugins | No frontmatter parsing exists yet; modifies user content; merge conflicts in sync; user may not want AI metadata in their notes |
| **Sidecar JSON** | Doesn't modify notes; structured data; per-note isolation; leverages existing VaultAdapter | Sync overhead if notes rename/move; not visible in note itself |
| **Plugin data store** | Simple API (`loadData/saveData`); already used for settings | Single monolithic file; grows unbounded with vault size; no per-note querying; opaque to user |

#### Why Sidecar JSON

1. **Does not modify user content**. Trust is paramount for an AI writing
   assistant. Users should never discover unexpected metadata injected into
   their notes. Frontmatter modification creates anxiety about AI "touching"
   their writing.

2. **Per-note isolation**. Each note's state is an independent file, enabling
   efficient reads/writes without loading the entire state store. The plugin
   data store (`data.json`) would become a bottleneck for large vaults.

3. **Leverages existing VaultAdapter**. The `VaultAdapter` interface already
   supports `create`, `modify`, `read`, and `exists` — all we need.

4. **Namespace consistency**. The plugin already uses `AI Copilot/` for the
   vector index (`AI Copilot/.index/`) and logs. Adding
   `AI Copilot/.enrichment/` follows the established pattern.

5. **Inspectable**. Users who want to understand or debug enrichment state can
   browse these files directly. Power users can bulk-edit or delete them.

#### File Structure

```
AI Copilot/
  .enrichment/
    <content-hash-prefix>-<note-path-hash>.json
```

Each sidecar file:

```typescript
interface EnrichmentStateRecord {
  /** Version for forward-compatible schema changes */
  version: 1;

  /** Vault-relative path to the source note */
  notePath: string;

  /** SHA-256 hash of note content at time of last state transition.
   *  Used for invalidation: if current content hash differs, state
   *  resets to unenriched. */
  contentHash: string;

  /** Current enrichment state */
  state: EnrichmentState;

  /** ISO timestamp of last state transition */
  updatedAt: string;

  /** Enrichment run ID that produced the current state */
  runId: string;

  /** Human-intervention triggers that were met (empty if not human-required) */
  triggers: HumanInterventionTrigger[];

  /** The pending patch plan, if state is suggested/human-required/approved.
   *  Null if state is unenriched/auto-enriched/applied/rejected. */
  pendingPlan: PatchPlan | MultiFilePatchPlan | null;

  /** Per-edit approval decisions, if state is approved.
   *  Maps edit index to approved/rejected. */
  editDecisions: Record<number, "approved" | "rejected"> | null;

  /** Snapshot of original content before auto-enrichment or approved apply.
   *  Stored for rollback capability. Null if no edits applied. */
  preApplySnapshot: string | null;

  /** LLM model that generated the suggestions */
  model: string;

  /** Average confidence of proposed edits (0..1) */
  avgConfidence: number | null;

  /** Attribution: which notes were used as context for this enrichment */
  contextNotes: string[];
}

type EnrichmentState =
  | "unenriched"
  | "analyzing"
  | "auto-enriched"
  | "suggested"
  | "human-required"
  | "approved"
  | "applied"
  | "rejected";

type HumanInterventionTrigger =
  | "low-confidence"
  | "conflicting-evidence"
  | "ambiguous-intent"
  | "destructive-rewrite"
  | "safety-failure"
  | "all-conflicting";
```

#### File Naming

Use a deterministic hash-based naming scheme to handle renames:

```typescript
function enrichmentStatePath(notePath: string): string {
  // Use first 8 chars of SHA-256 of the note path for collision resistance
  // plus a slugified version of the filename for human readability
  const hash = sha256(notePath).slice(0, 8);
  const slug = notePath.split("/").pop()?.replace(/\.md$/, "").slice(0, 30) ?? "note";
  return `AI Copilot/.enrichment/${hash}-${slugify(slug)}.json`;
}
```

#### Rename/Move Handling

When a note is renamed or moved:
1. The `modify` event fires on the new path
2. Content hash check finds no matching sidecar (old path hash differs)
3. Note enters `unenriched` state naturally
4. Orphaned sidecar from old path is cleaned up during periodic maintenance

This is acceptable because enrichment state is cheap to regenerate and renames
should not preserve stale enrichment suggestions that may reference the old
filename or context.

## Reviewability and Attribution

### Diff Format

Enrichment edits use the existing `PatchPlanEditV2` format which already
provides:
- `find` / `replace`: exact text diff
- `reason`: human-readable explanation of why the edit is proposed
- `confidence`: 0..1 score
- `risk`: safe / moderate / unsafe

The `previewPatchPlan` function already generates before/after context samples
(+/- 50 chars) for each edit. This is sufficient for review UI.

### Attribution Data

Each enrichment state record includes:
- **`model`**: Which LLM generated the suggestions
- **`runId`**: Unique identifier for the enrichment run (enables grouping
  related enrichments)
- **`contextNotes`**: Which notes were used as retrieval context
- **`updatedAt`**: When the suggestion was generated

This enables an approval UI to show: "Claude 3.5 Sonnet suggested these
changes on 2026-03-17, based on context from [Note A, Note B, Note C]."

### Approval UI (Recommendation)

The approval flow should present:
1. **Note header**: Note title, current state, when suggestions were generated
2. **Per-edit review**: Each edit shown as a diff with reason, confidence badge,
   and risk level. User can approve/reject individual edits.
3. **Batch actions**: "Approve all safe", "Reject all", "Approve selected"
4. **Context panel**: Which notes informed the suggestions (clickable links)
5. **Trigger warnings**: If `human-required`, show which triggers were met
   with explanations

The existing `toMarkdownRefinementPreview` can be extended for this purpose,
or a dedicated Obsidian view can render richer UI.

### Audit Trail

The existing `AI Copilot/Refinement Log.md` should be extended with
enrichment-specific entries:

```markdown
## Enrichment Run: <runId> — <ISO timestamp>

### <note-path>
- State: suggested → approved → applied
- Model: claude-sonnet-4-6
- Context notes: [[Note A]], [[Note B]]
- Edits: 3 approved, 1 rejected
- Average confidence: 0.85
- Triggers: (none)
```

## State Transition Implementation

### Core Function

```typescript
async function transitionEnrichmentState(
  vault: VaultAdapter,
  notePath: string,
  newState: EnrichmentState,
  updates: Partial<EnrichmentStateRecord>
): Promise<EnrichmentStateRecord> {
  const statePath = enrichmentStatePath(notePath);
  const existing = await loadEnrichmentState(vault, notePath);

  // Validate transition
  if (!isValidTransition(existing.state, newState)) {
    throw new Error(
      `Invalid enrichment transition: ${existing.state} → ${newState} for ${notePath}`
    );
  }

  const updated: EnrichmentStateRecord = {
    ...existing,
    ...updates,
    state: newState,
    updatedAt: new Date().toISOString(),
  };

  await vault.modify(statePath, JSON.stringify(updated, null, 2));
  return updated;
}

function isValidTransition(from: EnrichmentState, to: EnrichmentState): boolean {
  const allowed: Record<EnrichmentState, EnrichmentState[]> = {
    "unenriched":     ["analyzing"],
    "analyzing":      ["auto-enriched", "suggested", "human-required", "unenriched"],
    "auto-enriched":  ["unenriched"],
    "suggested":      ["approved", "rejected", "human-required", "unenriched"],
    "human-required": ["suggested", "rejected", "unenriched"],
    "approved":       ["applied", "unenriched"],
    "applied":        ["unenriched"],
    "rejected":       ["unenriched"],
  };
  return allowed[from]?.includes(to) ?? false;
}
```

### Content Hash Invalidation

On vault `modify` events, check if the content hash has changed:

```typescript
vault.on("modify", async (file) => {
  const state = await loadEnrichmentState(vault, file.path);
  if (state.state === "unenriched") return; // nothing to invalidate

  const currentContent = await vault.read(file.path);
  const currentHash = sha256(currentContent);

  if (currentHash !== state.contentHash) {
    await transitionEnrichmentState(vault, file.path, "unenriched", {
      pendingPlan: null,
      editDecisions: null,
      preApplySnapshot: null,
      triggers: [],
    });
  }
});
```

### Integration with Existing Refinement Flow

The enrichment state machine wraps the existing refinement pipeline:

1. **`runRefinementFlow`** (existing) calls `buildRefinementPreview`
2. **New**: After preview generation, evaluate intervention triggers
3. **New**: Create/update enrichment state record based on evaluation
4. **Existing**: If auto-apply enabled and state is `auto-enriched`, call
   `buildSafeAutoApplyDecision` + `applyRefinementDecision`
5. **New**: If state is `suggested` or `human-required`, persist pending plan
   and wait for user action
6. **Existing**: User action flows through `applyRefinementDecision` with
   selected edits

## Configuration Extensions

New settings to add to `AICopilotSettings`:

```typescript
// Enrichment state thresholds
enrichmentConfidenceThreshold: number;      // Default: 0.6 — below this triggers human-required
enrichmentDestructiveRewriteThreshold: number; // Default: 0.3 — above this triggers human-required
enrichmentPersistState: boolean;            // Default: true — enable/disable state tracking
```

## Open Questions

1. **Conflict resolution UI**: Should the approval UI be a modal, a sidebar
   panel, or a dedicated note view? This depends on the Obsidian UI framework
   chosen for the plugin.

2. **Batch enrichment scheduling**: When enriching multiple notes in one cycle,
   should they be processed in parallel or sequentially? Sequential is simpler
   and avoids rate limits but is slower for large vaults.

3. **State cleanup frequency**: How often should orphaned sidecar files be
   cleaned up? Options: on plugin load, periodically, or on user command.

4. **Cross-note enrichment**: The current model is per-note. Should there be a
   higher-level "enrichment batch" concept that groups related notes? This
   would help with conflicting-evidence detection across notes.
