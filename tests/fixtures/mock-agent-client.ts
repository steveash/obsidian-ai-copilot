/**
 * Mock AgentClient for integration tests. Returns scripted responses
 * without making external API calls. Supports tool-use simulation.
 */
import type {
  AgentClient,
  AgentMessage,
  MessagesResponse,
  ContentBlock,
} from "../../src/agent-loop";

export interface ScriptedTurn {
  /** Content blocks the mock model returns */
  content: ContentBlock[];
  /** Stop reason for this turn */
  stop_reason: MessagesResponse["stop_reason"];
}

/**
 * A mock agent client that plays back scripted turns in sequence.
 * Each call to chatMessages() returns the next scripted turn.
 */
export class ScriptedAgentClient implements AgentClient {
  private turns: ScriptedTurn[];
  private callIndex = 0;
  readonly calls: AgentMessage[][] = [];

  constructor(turns: ScriptedTurn[]) {
    this.turns = turns;
  }

  async chatMessages(
    messages: AgentMessage[],
    _system: string,
    _tools: unknown[],
    _maxTokens: number
  ): Promise<MessagesResponse> {
    this.calls.push([...messages]);
    const turn = this.turns[this.callIndex];
    if (!turn) {
      return {
        content: [{ type: "text", text: "(no more scripted turns)" }],
        stop_reason: "end_turn",
      };
    }
    this.callIndex++;
    return { content: turn.content, stop_reason: turn.stop_reason };
  }
}

// ── common scripted scenarios ────────────────────────────────────────

/**
 * Client that answers immediately without using tools.
 */
export function directAnswerClient(text: string): ScriptedAgentClient {
  return new ScriptedAgentClient([
    {
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
    },
  ]);
}

/**
 * Client that searches notes, reads one, then answers.
 */
export function searchThenReadClient(
  searchQuery: string,
  readPath: string,
  finalAnswer: string
): ScriptedAgentClient {
  return new ScriptedAgentClient([
    // Turn 1: model wants to search
    {
      content: [
        { type: "text", text: "Let me search for relevant notes." },
        {
          type: "tool_use",
          id: "call_1",
          name: "search_notes",
          input: { query: searchQuery },
        },
      ],
      stop_reason: "tool_use",
    },
    // Turn 2: model wants to read a specific note
    {
      content: [
        { type: "text", text: "Let me read that note in detail." },
        {
          type: "tool_use",
          id: "call_2",
          name: "read_note",
          input: { path: readPath },
        },
      ],
      stop_reason: "tool_use",
    },
    // Turn 3: model gives final answer
    {
      content: [{ type: "text", text: finalAnswer }],
      stop_reason: "end_turn",
    },
  ]);
}

/**
 * Client that lists notes in a folder, then answers.
 */
export function listThenAnswerClient(
  folder: string,
  finalAnswer: string
): ScriptedAgentClient {
  return new ScriptedAgentClient([
    {
      content: [
        {
          type: "tool_use",
          id: "call_1",
          name: "list_notes",
          input: { folder },
        },
      ],
      stop_reason: "tool_use",
    },
    {
      content: [{ type: "text", text: finalAnswer }],
      stop_reason: "end_turn",
    },
  ]);
}

/**
 * Client that always requests tools (for testing tool call limits).
 */
export function infiniteToolClient(): ScriptedAgentClient {
  const turns: ScriptedTurn[] = Array.from({ length: 50 }, (_, i) => ({
    content: [
      {
        type: "tool_use" as const,
        id: `call_${i}`,
        name: "list_notes",
        input: {},
      },
    ],
    stop_reason: "tool_use" as const,
  }));
  return new ScriptedAgentClient(turns);
}
