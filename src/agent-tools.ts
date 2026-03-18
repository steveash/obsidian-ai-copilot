import type { VaultAdapter } from "./vault-adapter";
import type { RetrievedNote } from "./semantic-retrieval";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  is_error?: boolean;
}

export type NoteSearchFn = (query: string, maxResults: number) => Promise<RetrievedNote[]>;

export interface AgentToolContext {
  vault: VaultAdapter;
  searchNotes: NoteSearchFn;
  maxSearchResults: number;
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "search_notes",
    description:
      "Search the vault for notes relevant to a query. Returns note paths, " +
      "scores, and content previews. Use this to find information across the vault.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant notes"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "read_note",
    description:
      "Read the full content of a specific note by its file path. " +
      "Use this after search_notes to get the complete text of a relevant note.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path of the note to read (e.g. 'Projects/my-note.md')"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "list_notes",
    description:
      "List all markdown files in the vault. Returns file paths and modification times. " +
      "Optionally filter by folder prefix.",
    input_schema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Optional folder prefix to filter results (e.g. 'Projects/')"
        }
      }
    }
  }
];

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentToolContext
): Promise<ToolResult> {
  switch (name) {
    case "search_notes":
      return executeSearchNotes(input, ctx);
    case "read_note":
      return executeReadNote(input, ctx);
    case "list_notes":
      return executeListNotes(input, ctx);
    default:
      return { content: `Unknown tool: ${name}`, is_error: true };
  }
}

async function executeSearchNotes(
  input: Record<string, unknown>,
  ctx: AgentToolContext
): Promise<ToolResult> {
  const query = String(input.query ?? "");
  if (!query) return { content: "Error: query is required", is_error: true };

  const results = await ctx.searchNotes(query, ctx.maxSearchResults);
  if (results.length === 0) {
    return { content: "No matching notes found." };
  }

  const formatted = results.map((n) => {
    const preview = n.content.slice(0, 500).replace(/\n{3,}/g, "\n\n");
    return `### ${n.path} (score: ${n.score.toFixed(2)})\n${preview}`;
  });

  return { content: formatted.join("\n\n---\n\n") };
}

async function executeReadNote(
  input: Record<string, unknown>,
  ctx: AgentToolContext
): Promise<ToolResult> {
  const path = String(input.path ?? "");
  if (!path) return { content: "Error: path is required", is_error: true };

  if (!ctx.vault.exists(path)) {
    return { content: `Note not found: ${path}`, is_error: true };
  }

  const content = await ctx.vault.read(path);
  return { content };
}

async function executeListNotes(
  input: Record<string, unknown>,
  ctx: AgentToolContext
): Promise<ToolResult> {
  const folder = input.folder ? String(input.folder) : undefined;
  let files = ctx.vault.listMarkdownFiles();

  if (folder) {
    files = files.filter((f) => f.path.startsWith(folder));
  }

  if (files.length === 0) {
    return { content: folder ? `No notes found in folder: ${folder}` : "No notes in vault." };
  }

  const lines = files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 100)
    .map((f) => `- ${f.path} (modified: ${new Date(f.mtime).toISOString().slice(0, 10)})`);

  if (files.length > 100) {
    lines.push(`\n... and ${files.length - 100} more files`);
  }

  return { content: lines.join("\n") };
}
