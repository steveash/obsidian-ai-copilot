import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  formatToolProgressText,
  formatCitationHtml,
} from "../src/chat-format";
import type { ChatCitation } from "../src/chat";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('x')</script>")).toBe(
      "&lt;script&gt;alert('x')&lt;/script&gt;"
    );
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('a "b" c')).toBe("a &quot;b&quot; c");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("passes through plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("escapes multiple special characters together", () => {
    expect(escapeHtml('<a href="x">&')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;"
    );
  });
});

describe("formatToolProgressText", () => {
  it("returns label for known tools", () => {
    expect(formatToolProgressText("search_notes")).toBe("Searching vault...");
    expect(formatToolProgressText("read_note")).toBe("Reading note...");
    expect(formatToolProgressText("list_notes")).toBe("Listing notes...");
    expect(formatToolProgressText("write_note")).toBe("Writing note...");
    expect(formatToolProgressText("edit_note")).toBe("Editing note...");
  });

  it("returns generic label for unknown tools", () => {
    expect(formatToolProgressText("custom_tool")).toBe(
      "Running custom_tool..."
    );
  });
});

describe("formatCitationHtml", () => {
  it("returns empty string for no citations", () => {
    expect(formatCitationHtml([])).toBe("");
  });

  it("renders a single citation without score", () => {
    const citations: ChatCitation[] = [{ path: "notes/hello.md" }];
    const html = formatCitationHtml(citations);
    expect(html).toContain("Sources:");
    expect(html).toContain("deep-chat-citations");
    expect(html).toContain("deep-chat-citation-link");
    expect(html).toContain('data-path="notes/hello.md"');
    expect(html).toContain("notes/hello.md</a>");
  });

  it("renders citation with score", () => {
    const citations: ChatCitation[] = [
      { path: "research/paper.md", score: 0.8512 }
    ];
    const html = formatCitationHtml(citations);
    expect(html).toContain("research/paper.md (0.85)");
  });

  it("renders multiple citations", () => {
    const citations: ChatCitation[] = [
      { path: "a.md", score: 0.9 },
      { path: "b.md" },
      { path: "c.md", score: 0.5 }
    ];
    const html = formatCitationHtml(citations);
    expect(html).toContain("a.md (0.90)");
    expect(html).toContain("b.md</a>");
    expect(html).toContain("c.md (0.50)");
    // Should have three list items
    const liCount = (html.match(/<li>/g) ?? []).length;
    expect(liCount).toBe(3);
  });

  it("escapes HTML in citation paths", () => {
    const citations: ChatCitation[] = [
      { path: 'notes/<script>"xss"</script>.md' }
    ];
    const html = formatCitationHtml(citations);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;xss&quot;");
  });

  it("produces valid HTML structure", () => {
    const citations: ChatCitation[] = [{ path: "test.md" }];
    const html = formatCitationHtml(citations);
    // Check nesting: div > div (title) + ul > li > a
    expect(html).toMatch(
      /^<div class="deep-chat-citations">.*<\/div>$/
    );
    expect(html).toContain('<div class="deep-chat-citation-title">');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("</ul>");
  });

  it("uses data-path attribute for click handling", () => {
    const citations: ChatCitation[] = [
      { path: "folder/sub folder/note.md" }
    ];
    const html = formatCitationHtml(citations);
    expect(html).toContain('data-path="folder/sub folder/note.md"');
  });
});
