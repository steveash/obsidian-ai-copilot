import type { ToolDefinition, AgentToolContext, ToolResult } from "./agent-tools";
import { AGENT_TOOLS, executeTool } from "./agent-tools";
import type { ChatCitation } from "./chat";
import type { AICopilotSettings } from "./settings";

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface MessagesResponse {
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface AgentClient {
  chatMessages(
    messages: AgentMessage[],
    system: string,
    tools: ToolDefinition[],
    maxTokens: number
  ): Promise<MessagesResponse>;
}

export interface AgentLoopCallbacks {
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: ToolResult) => void;
  onText?: (text: string) => void;
}

export interface AgentLoopResult {
  text: string;
  citations: ChatCitation[];
  toolCallCount: number;
}

const AGENT_SYSTEM_PROMPT =
  "You are an AI assistant integrated into an Obsidian vault. You help users " +
  "understand, search, and navigate their notes.\n\n" +
  "You have tools to search, read, and list notes in the vault. Use them to " +
  "find relevant information before answering. Always ground your answers in " +
  "the actual note content.\n\n" +
  "When citing information, mention the note path so the user can find it. " +
  "If you cannot find relevant information in the vault, say so honestly.\n\n" +
  "Be concise and helpful. Focus on answering the user's question using vault content.";

export async function runAgentLoop(
  client: AgentClient,
  query: string,
  toolCtx: AgentToolContext,
  settings: AICopilotSettings,
  callbacks?: AgentLoopCallbacks
): Promise<AgentLoopResult> {
  const maxToolCalls = settings.agentMaxToolCalls;
  const messages: AgentMessage[] = [{ role: "user", content: query }];
  const citedPaths = new Map<string, number>();
  let toolCallCount = 0;

  for (let i = 0; i < maxToolCalls + 1; i++) {
    const response = await client.chatMessages(
      messages,
      AGENT_SYSTEM_PROMPT,
      AGENT_TOOLS,
      4096
    );

    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const text = extractText(response.content);
      callbacks?.onText?.(text);
      return {
        text,
        citations: buildCitations(citedPaths),
        toolCallCount
      };
    }

    if (response.stop_reason !== "tool_use") {
      const text = extractText(response.content);
      callbacks?.onText?.(text);
      return { text, citations: buildCitations(citedPaths), toolCallCount };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (b): b is ContentBlock & { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        b.type === "tool_use" && !!b.id && !!b.name
    );

    const resultBlocks: ContentBlock[] = [];

    for (const block of toolUseBlocks) {
      toolCallCount++;
      callbacks?.onToolCall?.(block.name, block.input);

      const result = await executeTool(block.name, block.input, toolCtx);
      callbacks?.onToolResult?.(block.name, result);

      trackCitations(block.name, block.input, citedPaths);

      resultBlocks.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.is_error
      });
    }

    messages.push({ role: "user", content: resultBlocks });
  }

  const finalResponse = await client.chatMessages(
    messages,
    AGENT_SYSTEM_PROMPT,
    AGENT_TOOLS,
    4096
  );

  const text = extractText(finalResponse.content);
  callbacks?.onText?.(text);
  return { text, citations: buildCitations(citedPaths), toolCallCount };
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

function trackCitations(
  toolName: string,
  input: Record<string, unknown>,
  citedPaths: Map<string, number>
): void {
  if (toolName === "read_note" && typeof input.path === "string") {
    const current = citedPaths.get(input.path) ?? 0;
    citedPaths.set(input.path, current + 1);
  }
}

function buildCitations(citedPaths: Map<string, number>): ChatCitation[] {
  return [...citedPaths.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => ({ path }));
}
