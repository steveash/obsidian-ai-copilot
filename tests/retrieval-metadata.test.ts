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

  it("supports quoted values and safer syntax", () => {
    const q = parseQueryConstraints('folder:"Projects/AI Notes" tag:"release/v1" link:"planning board"');
    expect(q.folder).toBe("projects/ai notes");
    expect(q.tag).toBe("release/v1");
    expect(q.link).toBe("planning board");
  });

  it("falls back invalid filter syntax into terms", () => {
    const q = parseQueryConstraints("folder:../private before:not-a-date ship it");
    expect(q.folder).toBeUndefined();
    expect(q.before).toBeUndefined();
    expect(q.terms).toContain("folder:../private");
    expect(q.terms).toContain("before:not-a-date");
    expect(q.warnings?.length).toBeGreaterThan(0);
  });

  it("keeps unknown filters as plain terms", () => {
    const q = parseQueryConstraints("owner:me project status:active");
    expect(q.terms).toContain("owner:me");
    expect(q.terms).toContain("status:active");
    expect(q.warnings).toBeUndefined();
  });

  it("supports single-quoted values", () => {
    const q = parseQueryConstraints("folder:'Projects/Alpha Team' tag:'#release'");
    expect(q.folder).toBe("projects/alpha team");
    expect(q.tag).toBe("release");
  });

  it("drops contradictory date ranges", () => {
    const q = parseQueryConstraints("after:2026-03-03 before:2026-03-01");
    expect(q.after).toBeUndefined();
    expect(q.before).toBeUndefined();
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
