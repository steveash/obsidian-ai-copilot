import type { RetrievedNote } from "./semantic-retrieval";

export function formatChunkContent(path: string, heading: string, text: string): string {
  return [path, heading, text].join("\n");
}

export function formatChunkPreview(heading: string, text: string): string {
  return [`# ${heading}`, text].join("\n");
}

export function mergeChunkResultsToFullNotes(results: RetrievedNote[], sectionsPerNote = 2): RetrievedNote[] {
  const grouped = new Map<string, RetrievedNote[]>();
  for (const result of results) {
    const items = grouped.get(result.path) ?? [];
    items.push(result);
    grouped.set(result.path, items);
  }

  const merged: RetrievedNote[] = [];
  for (const [path, chunks] of grouped.entries()) {
    const ranked = [...chunks].sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const sectionContext = ranked
      .slice(0, sectionsPerNote)
      .map((chunk, i) => `## Relevant Section ${i + 1}\n${chunk.content}`)
      .join("\n\n");

    const fullNote = top.metadata.fullContent ?? top.content;

    merged.push({
      ...top,
      content: `${sectionContext}\n\n## Full Note (${path})\n${fullNote}`
    });
  }

  return merged.sort((a, b) => b.score - a.score);
}
