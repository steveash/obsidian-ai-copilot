import { describe, expect, it } from "vitest";
import { applyPatchSet } from "../src/patcher";
import { mergeChunkResultsToFullNotes } from "../src/retrieval-context";
import type { RetrievedNote } from "../src/semantic-retrieval";

describe("e2e-ish: command -> retrieval -> artifact", () => {
  it("builds merged retrieval artifact and supports rollback-friendly patch tx", () => {
    const chunks: RetrievedNote[] = [
      {
        path: "notes/product.md",
        content: "# Overview\nCopilot release scope",
        score: 0.95,
        lexicalScore: 0.8,
        semanticScore: 0.8,
        freshnessScore: 0.5,
        graphBoost: 0,
        metadata: {
          tags: ["release"],
          links: ["plan"],
          headings: ["Overview"],
          fullContent: "# Product\nFull product note content"
        }
      }
    ];

    const merged = mergeChunkResultsToFullNotes(chunks);
    expect(merged[0].content).toContain("## Relevant Section 1");
    expect(merged[0].content).toContain("## Full Note (notes/product.md)");

    const artifact = `## Query\nship plan\n\n## Response\nUse notes/product.md`;
    const { finalContent, transactions } = applyPatchSet(artifact, [
      { path: "AI Copilot/Chat Output.md", find: "ship plan", replace: "ship release plan", reason: "clarify" }
    ]);

    expect(finalContent).toContain("ship release plan");
    expect(transactions[0].rollbackPatch).toBeTruthy();
  });
});
