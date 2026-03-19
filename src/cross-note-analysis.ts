import type { VaultAdapter, VaultFile } from "./vault-adapter";
import { extractMetadata } from "./semantic-retrieval";
import type { FilePatchPlan, MultiFilePatchPlan, PatchPlanEditV2 } from "./patch-plan";

// ── types ────────────────────────────────────────────────────────────

export interface VaultGraph {
  /** Forward links: notePath → set of link targets (without .md) */
  forwardLinks: Map<string, Set<string>>;
  /** Reverse links: normalised target → set of source paths */
  backlinks: Map<string, Set<string>>;
  /** Tags per note */
  tags: Map<string, Set<string>>;
  /** Frontmatter fields per note: notePath → Map<fieldName, rawValue> */
  frontmatter: Map<string, Map<string, string>>;
  /** All known note paths (without .md normalised for lookup) */
  notePaths: Set<string>;
  /** Raw note paths as they exist in the vault */
  rawPaths: Set<string>;
}

export interface MissingBacklink {
  /** Note that has no link back to the source */
  targetPath: string;
  /** Notes that link to targetPath but targetPath doesn't link back */
  unreciprocatedFrom: string[];
}

export interface StaleReference {
  /** Note containing the stale link */
  sourcePath: string;
  /** The broken wikilink target */
  brokenLink: string;
  /** Whether a close-match note exists (possible rename) */
  possibleRename: string | null;
}

export interface TagSuggestion {
  /** Note that could benefit from additional tags */
  notePath: string;
  /** Tags used by related notes but missing from this note */
  suggestedTags: string[];
  /** Related notes that use these tags */
  evidenceNotes: string[];
}

export interface FrontmatterSuggestion {
  /** Note missing frontmatter fields */
  notePath: string;
  /** Fields present in related notes but missing from this note */
  missingFields: string[];
  /** Example values from related notes: fieldName → [value, sourcePath] */
  examples: Map<string, [string, string]>;
}

export interface CrossNoteAnalysis {
  missingBacklinks: MissingBacklink[];
  staleReferences: StaleReference[];
  tagSuggestions: TagSuggestion[];
  frontmatterSuggestions: FrontmatterSuggestion[];
}

// ── vault graph construction ─────────────────────────────────────────

/**
 * Parse YAML frontmatter from note content.
 * Returns field name → raw string value pairs.
 */
export function parseFrontmatter(content: string): Map<string, string> {
  const fields = new Map<string, string>();
  if (!content.startsWith("---")) return fields;

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx < 0) return fields;

  const yaml = content.slice(4, endIdx);
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && !key.startsWith("#")) {
      fields.set(key, value);
    }
  }

  return fields;
}

/**
 * Normalise a note path for lookup: strip .md, lowercase.
 */
function normalisePath(path: string): string {
  return path.replace(/\.md$/i, "").toLowerCase();
}

/**
 * Resolve a wikilink target against the vault's known paths.
 * Returns the matched raw path or null if no match.
 */
function resolveLink(link: string, rawPaths: Set<string>): string | null {
  // Try direct match with .md
  const withMd = `${link}.md`;
  if (rawPaths.has(withMd)) return withMd;
  if (rawPaths.has(link)) return link;

  // Try case-insensitive match
  const lower = link.toLowerCase();
  for (const p of rawPaths) {
    const base = p.replace(/\.md$/i, "").toLowerCase();
    if (base === lower) return p;
    // Also match on filename only (Obsidian resolves by filename)
    const filename = base.split("/").pop();
    if (filename === lower) return p;
  }
  return null;
}

/**
 * Build a complete graph of the vault's inter-note relationships.
 */
export async function buildVaultGraph(vault: VaultAdapter): Promise<VaultGraph> {
  const files = vault.listMarkdownFiles();
  const forwardLinks = new Map<string, Set<string>>();
  const backlinks = new Map<string, Set<string>>();
  const tags = new Map<string, Set<string>>();
  const frontmatter = new Map<string, Map<string, string>>();
  const rawPaths = new Set(files.map((f) => f.path));
  const notePaths = new Set(files.map((f) => normalisePath(f.path)));

  for (const file of files) {
    const content = await vault.read(file.path);
    const meta = extractMetadata(content);

    // Forward links
    const linkTargets = new Set<string>();
    for (const link of meta.links) {
      const normalised = link.replace(/\.md$/i, "").toLowerCase();
      linkTargets.add(normalised);

      // Register backlink
      const existing = backlinks.get(normalised) ?? new Set();
      existing.add(file.path);
      backlinks.set(normalised, existing);
    }
    forwardLinks.set(file.path, linkTargets);

    // Tags
    tags.set(file.path, new Set(meta.tags));

    // Frontmatter
    frontmatter.set(file.path, parseFrontmatter(content));
  }

  return { forwardLinks, backlinks, tags, frontmatter, notePaths, rawPaths };
}

// ── analysis functions ───────────────────────────────────────────────

/**
 * Find notes that are linked to but don't link back (missing backlinks).
 * Only considers notes that actually exist in the vault.
 */
export function findMissingBacklinks(graph: VaultGraph): MissingBacklink[] {
  const results: MissingBacklink[] = [];

  for (const [targetNorm, sources] of graph.backlinks) {
    // Only consider targets that exist as actual notes
    if (!graph.notePaths.has(targetNorm)) continue;

    // Find the actual path of the target note
    let targetPath: string | null = null;
    for (const p of graph.rawPaths) {
      if (normalisePath(p) === targetNorm) {
        targetPath = p;
        break;
      }
    }
    if (!targetPath) continue;

    // Get target's forward links
    const targetForward = graph.forwardLinks.get(targetPath);
    if (!targetForward) continue;

    // Find sources that link to target but target doesn't link back to
    const unreciprocated: string[] = [];
    for (const sourcePath of sources) {
      const sourceNorm = normalisePath(sourcePath);
      if (sourceNorm === targetNorm) continue; // skip self-links
      if (!targetForward.has(sourceNorm)) {
        unreciprocated.push(sourcePath);
      }
    }

    if (unreciprocated.length > 0) {
      results.push({ targetPath, unreciprocatedFrom: unreciprocated.sort() });
    }
  }

  return results.sort((a, b) => a.targetPath.localeCompare(b.targetPath));
}

/**
 * Detect wikilinks that point to non-existent notes (stale/broken references).
 * Optionally suggests possible renames using Levenshtein distance.
 */
export function detectStaleReferences(graph: VaultGraph): StaleReference[] {
  const results: StaleReference[] = [];

  for (const [sourcePath, linkTargets] of graph.forwardLinks) {
    for (const target of linkTargets) {
      if (graph.notePaths.has(target)) continue;

      // Find closest match for possible rename suggestion
      const possibleRename = findClosestMatch(target, graph.notePaths);

      results.push({
        sourcePath,
        brokenLink: target,
        possibleRename,
      });
    }
  }

  return results.sort((a, b) =>
    a.sourcePath.localeCompare(b.sourcePath) || a.brokenLink.localeCompare(b.brokenLink)
  );
}

/**
 * Find notes that could benefit from tags used by their linked neighbours.
 * A tag is suggested if ≥2 connected notes use it but the target doesn't.
 */
export function analyzeTagConsistency(
  graph: VaultGraph,
  minEvidence: number = 2
): TagSuggestion[] {
  const results: TagSuggestion[] = [];

  for (const [notePath, noteTags] of graph.tags) {
    // Collect tags from connected notes (notes this note links to + notes that link to this note)
    const noteNorm = normalisePath(notePath);
    const connectedPaths = new Set<string>();

    // Forward connections
    const forward = graph.forwardLinks.get(notePath);
    if (forward) {
      for (const linkTarget of forward) {
        for (const raw of graph.rawPaths) {
          if (normalisePath(raw) === linkTarget) connectedPaths.add(raw);
        }
      }
    }

    // Backward connections
    const backward = graph.backlinks.get(noteNorm);
    if (backward) {
      for (const src of backward) connectedPaths.add(src);
    }

    if (connectedPaths.size === 0) continue;

    // Count tag frequency among connected notes
    const tagCounts = new Map<string, string[]>();
    for (const connPath of connectedPaths) {
      const connTags = graph.tags.get(connPath);
      if (!connTags) continue;
      for (const tag of connTags) {
        if (noteTags.has(tag)) continue; // already has this tag
        const evidence = tagCounts.get(tag) ?? [];
        evidence.push(connPath);
        tagCounts.set(tag, evidence);
      }
    }

    // Suggest tags with sufficient evidence
    const suggestedTags: string[] = [];
    const evidenceNotes = new Set<string>();
    for (const [tag, sources] of tagCounts) {
      if (sources.length >= minEvidence) {
        suggestedTags.push(tag);
        for (const s of sources) evidenceNotes.add(s);
      }
    }

    if (suggestedTags.length > 0) {
      results.push({
        notePath,
        suggestedTags: suggestedTags.sort(),
        evidenceNotes: [...evidenceNotes].sort(),
      });
    }
  }

  return results.sort((a, b) => a.notePath.localeCompare(b.notePath));
}

/**
 * Find notes missing frontmatter fields that their linked neighbours have.
 * A field is suggested if ≥2 connected notes define it.
 */
export function analyzeFrontmatterConsistency(
  graph: VaultGraph,
  minEvidence: number = 2
): FrontmatterSuggestion[] {
  const results: FrontmatterSuggestion[] = [];

  for (const [notePath, noteFields] of graph.frontmatter) {
    const noteNorm = normalisePath(notePath);
    const connectedPaths = new Set<string>();

    // Forward connections
    const forward = graph.forwardLinks.get(notePath);
    if (forward) {
      for (const linkTarget of forward) {
        for (const raw of graph.rawPaths) {
          if (normalisePath(raw) === linkTarget) connectedPaths.add(raw);
        }
      }
    }

    // Backward connections
    const backward = graph.backlinks.get(noteNorm);
    if (backward) {
      for (const src of backward) connectedPaths.add(src);
    }

    if (connectedPaths.size === 0) continue;

    // Count field frequency among connected notes
    const fieldCounts = new Map<string, Array<[string, string]>>(); // field → [value, sourcePath][]
    for (const connPath of connectedPaths) {
      const connFields = graph.frontmatter.get(connPath);
      if (!connFields) continue;
      for (const [field, value] of connFields) {
        if (noteFields.has(field)) continue; // already has this field
        const evidence = fieldCounts.get(field) ?? [];
        evidence.push([value, connPath]);
        fieldCounts.set(field, evidence);
      }
    }

    // Suggest fields with sufficient evidence
    const missingFields: string[] = [];
    const examples = new Map<string, [string, string]>();
    for (const [field, evidence] of fieldCounts) {
      if (evidence.length >= minEvidence) {
        missingFields.push(field);
        examples.set(field, evidence[0]); // first example
      }
    }

    if (missingFields.length > 0) {
      results.push({
        notePath,
        missingFields: missingFields.sort(),
        examples,
      });
    }
  }

  return results.sort((a, b) => a.notePath.localeCompare(b.notePath));
}

/**
 * Run all cross-note analyses on a vault.
 */
export async function analyzeCrossNoteRelationships(
  vault: VaultAdapter,
  options: { tagMinEvidence?: number; frontmatterMinEvidence?: number } = {}
): Promise<CrossNoteAnalysis> {
  const graph = await buildVaultGraph(vault);

  return {
    missingBacklinks: findMissingBacklinks(graph),
    staleReferences: detectStaleReferences(graph),
    tagSuggestions: analyzeTagConsistency(graph, options.tagMinEvidence ?? 2),
    frontmatterSuggestions: analyzeFrontmatterConsistency(graph, options.frontmatterMinEvidence ?? 2),
  };
}

// ── patch plan generation ────────────────────────────────────────────

/**
 * Convert cross-note analysis results into a MultiFilePatchPlan.
 * All edits are marked as cross-note (moderate risk, lower confidence)
 * to ensure they route through human-required state.
 */
export function buildCrossNotePatchPlan(analysis: CrossNoteAnalysis): MultiFilePatchPlan | null {
  const fileEdits = new Map<string, PatchPlanEditV2[]>();

  // Stale reference fixes (suggest removing or updating broken links)
  for (const stale of analysis.staleReferences) {
    const edits = fileEdits.get(stale.sourcePath) ?? [];
    if (stale.possibleRename) {
      edits.push({
        find: `[[${stale.brokenLink}]]`,
        replace: `[[${stale.possibleRename}]]`,
        reason: `Fix broken wikilink: [[${stale.brokenLink}]] appears to have been renamed to [[${stale.possibleRename}]]`,
        confidence: 0.5,
        risk: "moderate",
      });
    } else {
      edits.push({
        find: `[[${stale.brokenLink}]]`,
        replace: `[[${stale.brokenLink}]]`, // keep as-is but flag it
        reason: `Broken wikilink: [[${stale.brokenLink}]] points to a non-existent note. Consider removing or creating the target note.`,
        confidence: 0.3,
        risk: "moderate",
      });
    }
    fileEdits.set(stale.sourcePath, edits);
  }

  // Missing backlink suggestions (append wikilinks to notes)
  for (const missing of analysis.missingBacklinks) {
    const edits = fileEdits.get(missing.targetPath) ?? [];
    const linkList = missing.unreciprocatedFrom
      .map((p) => `[[${p.replace(/\.md$/, "")}]]`)
      .join(", ");
    edits.push({
      find: "",
      replace: `\n\n## See also\n${missing.unreciprocatedFrom.map((p) => `- [[${p.replace(/\.md$/, "")}]]`).join("\n")}\n`,
      reason: `Add backlinks: ${linkList} link to this note but are not linked back`,
      confidence: 0.4,
      risk: "moderate",
    });
    fileEdits.set(missing.targetPath, edits);
  }

  if (fileEdits.size === 0) return null;

  const files: FilePatchPlan[] = [];
  for (const [path, edits] of fileEdits) {
    // Filter out no-op edits (where find === replace)
    const actionableEdits = edits.filter((e) => e.find !== e.replace);
    if (actionableEdits.length > 0) {
      files.push({ path, edits: actionableEdits });
    }
  }

  if (files.length === 0) return null;

  return {
    title: "Cross-note enrichment suggestions",
    files,
  };
}

/**
 * Build a human-readable markdown report of cross-note analysis results.
 */
export function toMarkdownCrossNoteReport(analysis: CrossNoteAnalysis): string {
  const lines: string[] = ["# Cross-Note Analysis Report", ""];

  // Missing backlinks
  lines.push("## Missing Backlinks");
  if (analysis.missingBacklinks.length === 0) {
    lines.push("No missing backlinks detected.", "");
  } else {
    for (const mb of analysis.missingBacklinks) {
      lines.push(`### ${mb.targetPath}`);
      lines.push("Linked from but doesn't link back to:");
      for (const src of mb.unreciprocatedFrom) {
        lines.push(`- [[${src.replace(/\.md$/, "")}]]`);
      }
      lines.push("");
    }
  }

  // Stale references
  lines.push("## Stale References");
  if (analysis.staleReferences.length === 0) {
    lines.push("No broken wikilinks detected.", "");
  } else {
    for (const sr of analysis.staleReferences) {
      const fix = sr.possibleRename ? ` → possible rename: [[${sr.possibleRename}]]` : "";
      lines.push(`- **${sr.sourcePath}**: [[${sr.brokenLink}]] (broken${fix})`);
    }
    lines.push("");
  }

  // Tag suggestions
  lines.push("## Tag Consistency Suggestions");
  if (analysis.tagSuggestions.length === 0) {
    lines.push("No tag suggestions.", "");
  } else {
    for (const ts of analysis.tagSuggestions) {
      lines.push(`### ${ts.notePath}`);
      lines.push(`Consider adding: ${ts.suggestedTags.map((t) => `#${t}`).join(", ")}`);
      lines.push(`Evidence from: ${ts.evidenceNotes.map((n) => `[[${n.replace(/\.md$/, "")}]]`).join(", ")}`);
      lines.push("");
    }
  }

  // Frontmatter suggestions
  lines.push("## Frontmatter Consistency Suggestions");
  if (analysis.frontmatterSuggestions.length === 0) {
    lines.push("No frontmatter suggestions.", "");
  } else {
    for (const fs of analysis.frontmatterSuggestions) {
      lines.push(`### ${fs.notePath}`);
      lines.push("Missing fields:");
      for (const field of fs.missingFields) {
        const example = fs.examples.get(field);
        if (example) {
          lines.push(`- \`${field}\`: e.g. \`${example[0]}\` (from [[${example[1].replace(/\.md$/, "")}]])`);
        } else {
          lines.push(`- \`${field}\``);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Simple Levenshtein distance for finding close matches.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/**
 * Find the closest matching note path from a set, if within a reasonable edit distance.
 * Returns the matching normalised path or null.
 */
function findClosestMatch(target: string, known: Set<string>): string | null {
  const maxDist = Math.max(2, Math.floor(target.length * 0.3));
  let best: string | null = null;
  let bestDist = Infinity;

  for (const candidate of known) {
    const dist = levenshtein(target, candidate);
    if (dist < bestDist && dist <= maxDist && dist > 0) {
      bestDist = dist;
      best = candidate;
    }
  }

  return best;
}
