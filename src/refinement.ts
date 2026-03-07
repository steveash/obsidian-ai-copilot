export type RefineCandidate = {
  path: string;
  content: string;
};

export interface DuplicateCluster {
  anchor: string;
  duplicates: string[];
}

export function extractTodos(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  return lines
    .filter((l) => /^\s*[-*]\s+\[\s\]\s+/i.test(l) || /^\s*TODO[:\s]/i.test(l))
    .map((l) => l.trim());
}

export function detectDuplicateTitleClusters(notes: RefineCandidate[]): DuplicateCluster[] {
  const groups = new Map<string, string[]>();
  for (const n of notes) {
    const parts = n.path.split("/");
    const leaf = parts.length ? parts[parts.length - 1] : n.path;
    const base = leaf.replace(/\.md$/i, "").toLowerCase();
    const arr = groups.get(base) ?? [];
    arr.push(n.path);
    groups.set(base, arr);
  }

  return [...groups.values()]
    .filter((arr) => arr.length > 1)
    .map((arr) => ({ anchor: arr[0], duplicates: arr.slice(1) }));
}

export function buildRefinementPrompt(
  notes: RefineCandidate[],
  options?: { enableWebEnrichment?: boolean }
): string {
  const header = [
    "You are an Obsidian note refinement assistant.",
    "Improve clarity, merge duplicates, surface TODOs, and suggest missing context.",
    "For each note, provide:",
    "1) Issues found",
    "2) Concrete edits (markdown snippets)",
    "3) Optional research followups",
    options?.enableWebEnrichment
      ? "You MAY suggest web queries when context gaps are obvious."
      : "Do NOT require internet lookups; work only with provided content.",
    "Keep suggestions concise and practical."
  ].join("\n");

  const body = notes.map((n, i) => `## Note ${i + 1}: ${n.path}\n${n.content}`).join("\n\n");
  return `${header}\n\n${body}`;
}
