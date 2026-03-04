import { detectDuplicateTitleClusters, extractTodos, type RefineCandidate } from "./refinement";

export interface RefinementPlan {
  generatedAt: string;
  noteCount: number;
  todoCount: number;
  duplicateClusters: Array<{ anchor: string; duplicates: string[] }>;
  suggestions: string[];
}

export function buildRefinementPlan(notes: RefineCandidate[]): RefinementPlan {
  const todos = notes.flatMap((n) => extractTodos(n.content));
  const duplicateClusters = detectDuplicateTitleClusters(notes);
  const suggestions: string[] = [];

  if (duplicateClusters.length) {
    suggestions.push(`Merge or cross-link ${duplicateClusters.length} duplicate title cluster(s).`);
  }
  if (todos.length > 0) {
    suggestions.push(`Create a consolidated task dashboard for ${todos.length} TODO item(s).`);
  }

  const sparseNotes = notes.filter((n) => n.content.trim().split(/\s+/).length < 40);
  if (sparseNotes.length) {
    suggestions.push(`Expand ${sparseNotes.length} short note(s) with context/examples.`);
  }

  if (!suggestions.length) {
    suggestions.push("No obvious structural issues found; focus on style and clarity improvements.");
  }

  return {
    generatedAt: new Date().toISOString(),
    noteCount: notes.length,
    todoCount: todos.length,
    duplicateClusters,
    suggestions
  };
}

export function toMarkdownPlan(plan: RefinementPlan): string {
  const dupes = plan.duplicateClusters.length
    ? plan.duplicateClusters
        .map((d) => `- Anchor: ${d.anchor} | Duplicates: ${d.duplicates.join(", ")}`)
        .join("\n")
    : "- None";

  return [
    "## Refinement Plan",
    `- Generated: ${plan.generatedAt}`,
    `- Notes scanned: ${plan.noteCount}`,
    `- TODOs found: ${plan.todoCount}`,
    "",
    "### Duplicate clusters",
    dupes,
    "",
    "### Suggestions",
    ...plan.suggestions.map((s) => `- ${s}`)
  ].join("\n");
}
