import { describe, expect, it } from "vitest";
import {
  metadataBoost,
  parseQueryConstraints,
  passesQueryConstraints,
  type RetrievedNoteMetadata
} from "../src/semantic-retrieval";

describe("retrieval metadata constraints + boosts", () => {
  const doc = {
    path: "projects/roadmap.md",
    content: "# Roadmap\n#release [[planning]]",
    mtime: Date.parse("2026-03-01")
  };
  const metadata: RetrievedNoteMetadata = {
    tags: ["release"],
    links: ["planning"],
    headings: ["Roadmap"]
  };

  it("parses folder/tag/date/link constraints", () => {
    const q = parseQueryConstraints("folder:projects tag:release link:planning after:2026-02-01 launch");
    expect(q.folder).toBe("projects");
    expect(q.tag).toBe("release");
    expect(q.link).toBe("planning");
    expect(q.terms).toContain("launch");
  });

  it("filters docs using constraints", () => {
    const q = parseQueryConstraints("folder:projects tag:release before:2026-04-01");
    expect(passesQueryConstraints(doc, metadata, q)).toBe(true);

    const miss = parseQueryConstraints("folder:archive");
    expect(passesQueryConstraints(doc, metadata, miss)).toBe(false);
  });

  it("applies metadata boosts", () => {
    const q = parseQueryConstraints("folder:projects tag:release link:planning roadmap");
    const boost = metadataBoost(doc, metadata, q);
    expect(boost).toBeGreaterThan(0.4);
  });
});
