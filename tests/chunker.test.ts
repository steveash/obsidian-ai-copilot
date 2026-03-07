import { describe, expect, it } from "vitest";
import { chunkMarkdownByHeading } from "../src/chunker";

describe("chunkMarkdownByHeading", () => {
  it("splits by heading", () => {
    const md = "# A\nhello\n## B\nworld";
    const chunks = chunkMarkdownByHeading("x.md", md, 1000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].heading).toBe("A");
    expect(chunks[1].heading).toBe("B");
  });
});
