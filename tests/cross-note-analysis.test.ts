import { describe, expect, it } from "vitest";
import {
  buildVaultGraph,
  findMissingBacklinks,
  detectStaleReferences,
  analyzeTagConsistency,
  analyzeFrontmatterConsistency,
  analyzeCrossNoteRelationships,
  parseFrontmatter,
  buildCrossNotePatchPlan,
  toMarkdownCrossNoteReport,
  type VaultGraph,
} from "../src/cross-note-analysis";
import { InMemoryVaultAdapter, type VaultNote } from "../src/vault-adapter";

// ── helpers ──────────────────────────────────────────────────────────

function makeVault(notes: VaultNote[]) {
  return new InMemoryVaultAdapter(notes);
}

function note(path: string, content: string, mtime = Date.now()): VaultNote {
  return { path, content, mtime };
}

// ── parseFrontmatter ─────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("parses simple YAML frontmatter", () => {
    const fields = parseFrontmatter("---\ntitle: My Note\ntags: foo\n---\n# Content");
    expect(fields.get("title")).toBe("My Note");
    expect(fields.get("tags")).toBe("foo");
  });

  it("returns empty map when no frontmatter", () => {
    const fields = parseFrontmatter("# Just a heading\nSome content.");
    expect(fields.size).toBe(0);
  });

  it("returns empty map for unclosed frontmatter", () => {
    const fields = parseFrontmatter("---\ntitle: oops");
    expect(fields.size).toBe(0);
  });

  it("skips comment lines in frontmatter", () => {
    const fields = parseFrontmatter("---\n# comment\ntitle: Note\n---\n");
    expect(fields.has("#")).toBe(false);
    expect(fields.get("title")).toBe("Note");
  });

  it("handles values with colons", () => {
    const fields = parseFrontmatter("---\nurl: https://example.com\n---\n");
    expect(fields.get("url")).toBe("https://example.com");
  });
});

// ── buildVaultGraph ──────────────────────────────────────────────────

describe("buildVaultGraph", () => {
  it("builds forward and backward links", async () => {
    const vault = makeVault([
      note("A.md", "Links to [[B]] and [[C]]"),
      note("B.md", "Links back to [[A]]"),
      note("C.md", "No links here"),
    ]);

    const graph = await buildVaultGraph(vault);

    expect(graph.forwardLinks.get("A.md")?.has("b")).toBe(true);
    expect(graph.forwardLinks.get("A.md")?.has("c")).toBe(true);
    expect(graph.forwardLinks.get("B.md")?.has("a")).toBe(true);
    expect(graph.backlinks.get("b")?.has("A.md")).toBe(true);
    expect(graph.backlinks.get("a")?.has("B.md")).toBe(true);
  });

  it("extracts tags", async () => {
    const vault = makeVault([
      note("A.md", "Content #project #review"),
      note("B.md", "Content #project"),
    ]);

    const graph = await buildVaultGraph(vault);
    expect(graph.tags.get("A.md")?.has("project")).toBe(true);
    expect(graph.tags.get("A.md")?.has("review")).toBe(true);
    expect(graph.tags.get("B.md")?.has("project")).toBe(true);
  });

  it("extracts frontmatter", async () => {
    const vault = makeVault([
      note("A.md", "---\ntitle: Note A\nstatus: draft\n---\nContent"),
      note("B.md", "No frontmatter"),
    ]);

    const graph = await buildVaultGraph(vault);
    expect(graph.frontmatter.get("A.md")?.get("title")).toBe("Note A");
    expect(graph.frontmatter.get("A.md")?.get("status")).toBe("draft");
    expect(graph.frontmatter.get("B.md")?.size).toBe(0);
  });

  it("tracks all note paths", async () => {
    const vault = makeVault([
      note("notes/A.md", ""),
      note("projects/B.md", ""),
    ]);

    const graph = await buildVaultGraph(vault);
    expect(graph.rawPaths.has("notes/A.md")).toBe(true);
    expect(graph.rawPaths.has("projects/B.md")).toBe(true);
    expect(graph.notePaths.has("notes/a")).toBe(true);
    expect(graph.notePaths.has("projects/b")).toBe(true);
  });
});

// ── findMissingBacklinks ─────────────────────────────────────────────

describe("findMissingBacklinks", () => {
  it("detects missing backlinks", async () => {
    const vault = makeVault([
      note("A.md", "Links to [[B]] and [[C]]"),
      note("B.md", "Links back to [[A]]"),
      note("C.md", "No links at all"),
    ]);

    const graph = await buildVaultGraph(vault);
    const missing = findMissingBacklinks(graph);

    // C is linked from A but doesn't link back
    const cMissing = missing.find((m) => m.targetPath === "C.md");
    expect(cMissing).toBeDefined();
    expect(cMissing!.unreciprocatedFrom).toContain("A.md");

    // B links back to A, so A should have no missing backlinks from B
    const bMissing = missing.find((m) => m.targetPath === "B.md");
    // B is linked from A but doesn't need a backlink check because B links to A
    // Actually B links to A, A links to B, so B should not be missing
    expect(bMissing).toBeUndefined();
  });

  it("ignores links to non-existent notes", async () => {
    const vault = makeVault([
      note("A.md", "Links to [[NonExistent]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    const missing = findMissingBacklinks(graph);
    expect(missing).toEqual([]);
  });

  it("handles circular links correctly", async () => {
    const vault = makeVault([
      note("A.md", "[[B]]"),
      note("B.md", "[[A]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    const missing = findMissingBacklinks(graph);
    expect(missing).toEqual([]);
  });

  it("handles no links", async () => {
    const vault = makeVault([
      note("A.md", "Just text"),
      note("B.md", "Just text"),
    ]);

    const graph = await buildVaultGraph(vault);
    const missing = findMissingBacklinks(graph);
    expect(missing).toEqual([]);
  });
});

// ── detectStaleReferences ────────────────────────────────────────────

describe("detectStaleReferences", () => {
  it("detects broken wikilinks", async () => {
    const vault = makeVault([
      note("A.md", "Links to [[B]] and [[Missing]]"),
      note("B.md", "Exists"),
    ]);

    const graph = await buildVaultGraph(vault);
    const stale = detectStaleReferences(graph);

    expect(stale.length).toBe(1);
    expect(stale[0].sourcePath).toBe("A.md");
    expect(stale[0].brokenLink).toBe("missing");
  });

  it("suggests possible renames for close matches", async () => {
    const vault = makeVault([
      note("A.md", "Links to [[Projcts]]"),
      note("Projects.md", "Exists"),
    ]);

    const graph = await buildVaultGraph(vault);
    const stale = detectStaleReferences(graph);

    expect(stale.length).toBe(1);
    expect(stale[0].brokenLink).toBe("projcts");
    expect(stale[0].possibleRename).toBe("projects");
  });

  it("returns empty for all-valid links", async () => {
    const vault = makeVault([
      note("A.md", "Links to [[B]]"),
      note("B.md", "Links to [[A]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    const stale = detectStaleReferences(graph);
    expect(stale).toEqual([]);
  });

  it("handles notes with no links", async () => {
    const vault = makeVault([note("A.md", "No links")]);
    const graph = await buildVaultGraph(vault);
    const stale = detectStaleReferences(graph);
    expect(stale).toEqual([]);
  });

  it("detects multiple broken links in one note", async () => {
    const vault = makeVault([
      note("A.md", "[[Ghost1]] and [[Ghost2]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    const stale = detectStaleReferences(graph);
    expect(stale.length).toBe(2);
  });
});

// ── analyzeTagConsistency ────────────────────────────────────────────

describe("analyzeTagConsistency", () => {
  it("suggests tags used by multiple connected notes", async () => {
    const vault = makeVault([
      note("Hub.md", "[[A]] [[B]] [[C]]"),
      note("A.md", "[[Hub]] #project #active"),
      note("B.md", "[[Hub]] #project #active"),
      note("C.md", "[[Hub]] #project"),
    ]);

    const graph = await buildVaultGraph(vault);
    const suggestions = analyzeTagConsistency(graph, 2);

    // Hub should be suggested #project (3 connected notes have it)
    // and #active (2 connected notes have it)
    const hubSuggestion = suggestions.find((s) => s.notePath === "Hub.md");
    expect(hubSuggestion).toBeDefined();
    expect(hubSuggestion!.suggestedTags).toContain("project");
    expect(hubSuggestion!.suggestedTags).toContain("active");
  });

  it("does not suggest tags already present", async () => {
    const vault = makeVault([
      note("A.md", "[[B]] #shared"),
      note("B.md", "[[A]] #shared"),
    ]);

    const graph = await buildVaultGraph(vault);
    const suggestions = analyzeTagConsistency(graph, 1);

    // Both notes already have #shared, so no suggestions
    expect(suggestions).toEqual([]);
  });

  it("respects minEvidence threshold", async () => {
    const vault = makeVault([
      note("A.md", "[[B]] [[C]]"),
      note("B.md", "[[A]] #rare"),
      note("C.md", "[[A]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    // With minEvidence=2, #rare (only in B) shouldn't be suggested
    const suggestions = analyzeTagConsistency(graph, 2);
    const aSuggestion = suggestions.find((s) => s.notePath === "A.md");
    expect(aSuggestion).toBeUndefined();
  });

  it("returns empty for isolated notes", async () => {
    const vault = makeVault([
      note("A.md", "#tag1"),
      note("B.md", "#tag2"),
    ]);

    const graph = await buildVaultGraph(vault);
    const suggestions = analyzeTagConsistency(graph);
    expect(suggestions).toEqual([]);
  });
});

// ── analyzeFrontmatterConsistency ────────────────────────────────────

describe("analyzeFrontmatterConsistency", () => {
  it("suggests missing frontmatter fields", async () => {
    const vault = makeVault([
      note("Hub.md", "[[A]] [[B]]"),
      note("A.md", "---\nstatus: active\ncategory: dev\n---\n[[Hub]]"),
      note("B.md", "---\nstatus: draft\ncategory: ops\n---\n[[Hub]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    const suggestions = analyzeFrontmatterConsistency(graph, 2);

    const hubSuggestion = suggestions.find((s) => s.notePath === "Hub.md");
    expect(hubSuggestion).toBeDefined();
    expect(hubSuggestion!.missingFields).toContain("status");
    expect(hubSuggestion!.missingFields).toContain("category");
  });

  it("does not suggest fields already present", async () => {
    const vault = makeVault([
      note("A.md", "---\nstatus: active\n---\n[[B]]"),
      note("B.md", "---\nstatus: draft\n---\n[[A]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    const suggestions = analyzeFrontmatterConsistency(graph, 1);
    expect(suggestions).toEqual([]);
  });

  it("provides examples from connected notes", async () => {
    const vault = makeVault([
      note("A.md", "[[B]] [[C]]"),
      note("B.md", "---\npriority: high\n---\n[[A]]"),
      note("C.md", "---\npriority: low\n---\n[[A]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    const suggestions = analyzeFrontmatterConsistency(graph, 2);

    const aSuggestion = suggestions.find((s) => s.notePath === "A.md");
    expect(aSuggestion).toBeDefined();
    expect(aSuggestion!.examples.has("priority")).toBe(true);
  });

  it("returns empty when no frontmatter exists", async () => {
    const vault = makeVault([
      note("A.md", "[[B]]"),
      note("B.md", "[[A]]"),
    ]);

    const graph = await buildVaultGraph(vault);
    const suggestions = analyzeFrontmatterConsistency(graph);
    expect(suggestions).toEqual([]);
  });
});

// ── analyzeCrossNoteRelationships (integration) ──────────────────────

describe("analyzeCrossNoteRelationships", () => {
  it("runs all analyses on a realistic vault", async () => {
    const vault = makeVault([
      note("Projects/AI.md", "---\nstatus: active\n---\n# AI Project\n[[Projects/Backend]] [[Research/ML]] #project #ai"),
      note("Projects/Backend.md", "---\nstatus: active\n---\n# Backend\n[[Projects/AI]] #project #backend"),
      note("Research/ML.md", "# ML Research\n#ai #research\nReferences [[OldNote]] and [[Projects/AI]]"),
      note("Daily/2026-03-18.md", "Worked on [[Projects/AI]] and [[Projects/Backend]] #daily"),
    ]);

    const analysis = await analyzeCrossNoteRelationships(vault);

    // Stale references: OldNote doesn't exist
    expect(analysis.staleReferences.length).toBeGreaterThan(0);
    const oldNoteRef = analysis.staleReferences.find((s) => s.brokenLink === "oldnote");
    expect(oldNoteRef).toBeDefined();
    expect(oldNoteRef!.sourcePath).toBe("Research/ML.md");

    // Missing backlinks: AI and Backend link to each other, but ML doesn't link back to Daily
    // Daily links to AI and Backend but neither links back
    expect(analysis.missingBacklinks.length).toBeGreaterThan(0);
  });

  it("returns empty analysis for empty vault", async () => {
    const vault = makeVault([]);
    const analysis = await analyzeCrossNoteRelationships(vault);

    expect(analysis.missingBacklinks).toEqual([]);
    expect(analysis.staleReferences).toEqual([]);
    expect(analysis.tagSuggestions).toEqual([]);
    expect(analysis.frontmatterSuggestions).toEqual([]);
  });

  it("returns empty analysis for single note", async () => {
    const vault = makeVault([note("Solo.md", "Just me #alone")]);
    const analysis = await analyzeCrossNoteRelationships(vault);

    expect(analysis.missingBacklinks).toEqual([]);
    expect(analysis.staleReferences).toEqual([]);
    expect(analysis.tagSuggestions).toEqual([]);
    expect(analysis.frontmatterSuggestions).toEqual([]);
  });
});

// ── buildCrossNotePatchPlan ──────────────────────────────────────────

describe("buildCrossNotePatchPlan", () => {
  it("returns null for empty analysis", () => {
    const plan = buildCrossNotePatchPlan({
      missingBacklinks: [],
      staleReferences: [],
      tagSuggestions: [],
      frontmatterSuggestions: [],
    });
    expect(plan).toBeNull();
  });

  it("generates patch for stale references with rename suggestions", () => {
    const plan = buildCrossNotePatchPlan({
      missingBacklinks: [],
      staleReferences: [
        { sourcePath: "A.md", brokenLink: "Projcts", possibleRename: "Projects" },
      ],
      tagSuggestions: [],
      frontmatterSuggestions: [],
    });

    expect(plan).not.toBeNull();
    expect(plan!.files.length).toBe(1);
    expect(plan!.files[0].path).toBe("A.md");
    expect(plan!.files[0].edits[0].find).toBe("[[Projcts]]");
    expect(plan!.files[0].edits[0].replace).toBe("[[Projects]]");
    expect(plan!.files[0].edits[0].risk).toBe("moderate");
  });

  it("generates patch for missing backlinks", () => {
    const plan = buildCrossNotePatchPlan({
      missingBacklinks: [
        { targetPath: "B.md", unreciprocatedFrom: ["A.md"] },
      ],
      staleReferences: [],
      tagSuggestions: [],
      frontmatterSuggestions: [],
    });

    expect(plan).not.toBeNull();
    expect(plan!.files.length).toBe(1);
    expect(plan!.files[0].path).toBe("B.md");
    expect(plan!.files[0].edits[0].replace).toContain("[[A]]");
  });

  it("marks all edits as moderate risk", () => {
    const plan = buildCrossNotePatchPlan({
      missingBacklinks: [
        { targetPath: "B.md", unreciprocatedFrom: ["A.md"] },
      ],
      staleReferences: [
        { sourcePath: "C.md", brokenLink: "X", possibleRename: "Y" },
      ],
      tagSuggestions: [],
      frontmatterSuggestions: [],
    });

    expect(plan).not.toBeNull();
    for (const file of plan!.files) {
      for (const edit of file.edits) {
        expect(edit.risk).toBe("moderate");
      }
    }
  });
});

// ── toMarkdownCrossNoteReport ────────────────────────────────────────

describe("toMarkdownCrossNoteReport", () => {
  it("generates a readable report for empty analysis", () => {
    const report = toMarkdownCrossNoteReport({
      missingBacklinks: [],
      staleReferences: [],
      tagSuggestions: [],
      frontmatterSuggestions: [],
    });

    expect(report).toContain("Cross-Note Analysis Report");
    expect(report).toContain("No missing backlinks detected");
    expect(report).toContain("No broken wikilinks detected");
  });

  it("generates a readable report with findings", () => {
    const report = toMarkdownCrossNoteReport({
      missingBacklinks: [
        { targetPath: "B.md", unreciprocatedFrom: ["A.md", "C.md"] },
      ],
      staleReferences: [
        { sourcePath: "D.md", brokenLink: "Ghost", possibleRename: "Ghost2" },
      ],
      tagSuggestions: [
        { notePath: "E.md", suggestedTags: ["project"], evidenceNotes: ["F.md", "G.md"] },
      ],
      frontmatterSuggestions: [
        {
          notePath: "H.md",
          missingFields: ["status"],
          examples: new Map([["status", ["active", "I.md"]]]),
        },
      ],
    });

    expect(report).toContain("B.md");
    expect(report).toContain("[[A]]");
    expect(report).toContain("[[C]]");
    expect(report).toContain("Ghost");
    expect(report).toContain("Ghost2");
    expect(report).toContain("#project");
    expect(report).toContain("status");
    expect(report).toContain("active");
  });
});
