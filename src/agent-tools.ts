import type { VaultAdapter } from "./vault-adapter";
import type { RetrievedNote } from "./semantic-retrieval";
import { checkPathProtected, runSafetyChecks } from "./patch-safety";
import type { PatchSafetyConfig } from "./patch-safety";

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

/** Approval callback for write operations. Returns true if approved. */
export type ApproveEditFn = (description: string) => Promise<boolean>;

/** Snapshot callback for rollback support. Called with path and original content before writes. */
export type SnapshotFn = (path: string, originalContent: string) => void;

export interface AgentToolContext {
  vault: VaultAdapter;
  searchNotes: NoteSearchFn;
  maxSearchResults: number;
  safetyConfig?: PatchSafetyConfig;
  approveEdit?: ApproveEditFn;
  onSnapshot?: SnapshotFn;
  /** Destructive rewrite threshold (0-1). Writes replacing more than this ratio require approval. Default: 0.4 */
  destructiveThreshold?: number;
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
  },
  {
    name: "write_note",
    description:
      "Create a new note or overwrite an existing note in the vault. " +
      "Paths must be vault-relative (e.g. 'Projects/my-note.md'). " +
      "Protected paths (.obsidian/, .git/, etc.) are blocked. " +
      "Overwriting an existing note with large content changes may require user approval.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path of the note to create or overwrite (e.g. 'Projects/new-note.md')"
        },
        content: {
          type: "string",
          description: "The full markdown content to write to the note"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "edit_note",
    description:
      "Apply a targeted find-and-replace edit to an existing note. " +
      "The find string must match exactly one location in the note. " +
      "Protected paths and content containing secrets are blocked.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path of the note to edit (e.g. 'Projects/my-note.md')"
        },
        find: {
          type: "string",
          description: "The exact text to find in the note (must match exactly once)"
        },
        replace: {
          type: "string",
          description: "The text to replace the found text with"
        }
      },
      required: ["path", "find", "replace"]
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
    case "write_note":
      return executeWriteNote(input, ctx);
    case "edit_note":
      return executeEditNote(input, ctx);
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

/** Check if a path is within vault scope (not protected). */
function checkVaultScope(path: string, config?: PatchSafetyConfig): ToolResult | null {
  if (!path) return { content: "Error: path is required", is_error: true };

  // Reject path traversal attempts
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("../")) {
    return { content: `Error: path must be vault-relative without traversal: ${path}`, is_error: true };
  }

  const pathCheck = checkPathProtected(normalized, config?.protectedPaths);
  if (!pathCheck.safe) {
    return { content: `Error: ${pathCheck.issues.join("; ")}`, is_error: true };
  }

  return null;
}

/** Compute the content-change ratio between old and new content. */
function contentChangeRatio(oldContent: string, newContent: string): number {
  if (oldContent.length === 0) return 0;
  // Simple character-level difference ratio
  const maxLen = Math.max(oldContent.length, newContent.length);
  let diffChars = 0;
  for (let i = 0; i < maxLen; i++) {
    if (oldContent[i] !== newContent[i]) diffChars++;
  }
  return diffChars / oldContent.length;
}

async function executeWriteNote(
  input: Record<string, unknown>,
  ctx: AgentToolContext
): Promise<ToolResult> {
  const path = String(input.path ?? "");
  const content = String(input.content ?? "");

  const scopeError = checkVaultScope(path, ctx.safetyConfig);
  if (scopeError) return scopeError;

  if (!content) return { content: "Error: content is required", is_error: true };

  const isOverwrite = ctx.vault.exists(path);

  if (isOverwrite) {
    const existingContent = await ctx.vault.read(path);
    const threshold = ctx.destructiveThreshold ?? 0.4;
    const changeRatio = contentChangeRatio(existingContent, content);

    if (changeRatio > threshold && ctx.approveEdit) {
      const approved = await ctx.approveEdit(
        `Overwriting "${path}" changes ${Math.round(changeRatio * 100)}% of content (threshold: ${Math.round(threshold * 100)}%)`
      );
      if (!approved) {
        return { content: `Edit rejected: overwriting "${path}" would change ${Math.round(changeRatio * 100)}% of content. User approval required.`, is_error: true };
      }
    }

    // Snapshot for rollback before modifying
    ctx.onSnapshot?.(path, existingContent);
    await ctx.vault.modify(path, content);
    return { content: `Note updated: ${path} (${content.length} chars, replaced ${existingContent.length} chars)` };
  }

  // New file — ensure parent folder path components are created
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash > 0) {
    const folder = path.slice(0, lastSlash);
    if (!ctx.vault.exists(folder)) {
      await ctx.vault.createFolder(folder);
    }
  }

  await ctx.vault.create(path, content);
  return { content: `Note created: ${path} (${content.length} chars)` };
}

async function executeEditNote(
  input: Record<string, unknown>,
  ctx: AgentToolContext
): Promise<ToolResult> {
  const path = String(input.path ?? "");
  const find = String(input.find ?? "");
  const replace = String(input.replace ?? "");

  const scopeError = checkVaultScope(path, ctx.safetyConfig);
  if (scopeError) return scopeError;

  if (!find) return { content: "Error: find is required", is_error: true };

  if (!ctx.vault.exists(path)) {
    return { content: `Note not found: ${path}`, is_error: true };
  }

  // Run patch-safety checks (path protection, size limits, secret detection)
  const safetyResult = runSafetyChecks(path, find, replace, ctx.safetyConfig);
  if (!safetyResult.safe) {
    return { content: `Safety check failed: ${safetyResult.issues.join("; ")}`, is_error: true };
  }

  const existingContent = await ctx.vault.read(path);

  // Check that find matches exactly once
  const firstIdx = existingContent.indexOf(find);
  if (firstIdx === -1) {
    return { content: `Error: find string not found in "${path}"`, is_error: true };
  }
  const secondIdx = existingContent.indexOf(find, firstIdx + 1);
  if (secondIdx !== -1) {
    return { content: `Error: find string matches multiple locations in "${path}" (ambiguous edit)`, is_error: true };
  }

  const newContent = existingContent.slice(0, firstIdx) + replace + existingContent.slice(firstIdx + find.length);

  // Check destructive threshold
  const threshold = ctx.destructiveThreshold ?? 0.4;
  const changeRatio = contentChangeRatio(existingContent, newContent);
  if (changeRatio > threshold && ctx.approveEdit) {
    const approved = await ctx.approveEdit(
      `Editing "${path}" changes ${Math.round(changeRatio * 100)}% of content (threshold: ${Math.round(threshold * 100)}%)`
    );
    if (!approved) {
      return { content: `Edit rejected: editing "${path}" would change ${Math.round(changeRatio * 100)}% of content. User approval required.`, is_error: true };
    }
  }

  // Snapshot for rollback
  ctx.onSnapshot?.(path, existingContent);
  await ctx.vault.modify(path, newContent);

  return { content: `Note edited: ${path} (replaced ${find.length} chars with ${replace.length} chars)` };
}
