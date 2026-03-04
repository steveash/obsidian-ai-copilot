export type RefineCandidate = {
  path: string;
  content: string;
};

export function buildRefinementPrompt(notes: RefineCandidate[]): string {
  const header = [
    "You are an Obsidian note refinement assistant.",
    "Improve clarity, merge duplicates, surface TODOs, and suggest missing context.",
    "Return structured suggestions per note."
  ].join("\n");

  const body = notes
    .map((n, i) => `## Note ${i + 1}: ${n.path}\n${n.content}`)
    .join("\n\n");

  return `${header}\n\n${body}`;
}
