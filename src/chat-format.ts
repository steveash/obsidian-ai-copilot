import type { ChatCitation } from "./chat";
import type { TokenUsage } from "./agent-loop";

const TOOL_LABELS: Record<string, string> = {
  search_notes: "Searching vault...",
  read_note: "Reading note...",
  list_notes: "Listing notes...",
  write_note: "Writing note...",
  edit_note: "Editing note..."
};

/** Escape HTML special characters for safe rendering. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format tool progress label from tool name. */
export function formatToolProgressText(toolName: string): string {
  return TOOL_LABELS[toolName] ?? `Running ${toolName}...`;
}

/**
 * Build token usage HTML block for display after a response.
 * Returns empty string when usage is not available.
 */
export function formatTokenUsageHtml(usage: TokenUsage): string {
  const total = usage.inputTokens + usage.outputTokens;
  return (
    '<div class="ai-copilot-token-usage">' +
    `Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out (${total} total)` +
    "</div>"
  );
}

/**
 * Build citation HTML block using Deep Chat htmlClassUtilities classes.
 * Returns empty string when no citations are provided.
 */
export function formatCitationHtml(citations: ChatCitation[]): string {
  if (!citations.length) return "";
  const items = citations
    .map((c) => {
      const scoreText =
        typeof c.score === "number" ? ` (${c.score.toFixed(2)})` : "";
      return `<li><a class="deep-chat-citation-link" data-path="${escapeHtml(c.path)}">${escapeHtml(c.path)}${scoreText}</a></li>`;
    })
    .join("");
  return (
    '<div class="deep-chat-citations">' +
    '<div class="deep-chat-citation-title">Sources:</div>' +
    `<ul>${items}</ul></div>`
  );
}
