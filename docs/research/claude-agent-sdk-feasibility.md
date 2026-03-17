# Claude Agent SDK Integration Feasibility — Technical Memo

**Date:** 2026-03-17
**Bead:** ob-d9g
**Status:** Complete

## Executive Summary

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is **not suitable for
direct embedding** in an Obsidian plugin. It requires Node.js 18+ with the
Claude Code CLI as a local subprocess, carries a 56.6 MB package footprint,
and its architecture assumes server-side execution with filesystem/shell access.

**Recommended pattern:** Continue using the Anthropic Messages API directly
(as the plugin already does) and implement a lightweight tool-call loop in
plugin code. If full agent capabilities are needed later, use a Node.js sidecar
process that communicates with the plugin over IPC.

---

## Q1: Can the SDK run in browser/Electron?

**No.** The Agent SDK is a server-side orchestration framework, not a client
library.

| Requirement | Agent SDK needs | Obsidian provides |
|-------------|----------------|-------------------|
| Runtime | Node.js 18+ | Electron (Chromium + Node, but constrained) |
| CLI dependency | Claude Code CLI installed locally | Not guaranteed |
| Process spawning | Spawns subprocesses for tool execution | Sandboxed environment |
| Filesystem | Direct fs access for Read/Write/Edit tools | Vault abstraction layer |
| Shell | Full shell access for Bash tool | Not available in plugin context |

The SDK communicates with a local Claude Code CLI process that manages tool
execution, file I/O, and command execution. This process model is incompatible
with Obsidian's plugin sandbox.

**Electron caveat:** While Obsidian runs on Electron (which includes Node.js),
plugins run in a constrained context. The SDK's dependency on spawning the
Claude Code CLI binary, managing subprocesses, and direct filesystem access
makes it unsuitable even in the desktop Electron context.

---

## Q2: Tool definition format

The SDK uses **Zod schemas** wrapped in **MCP (Model Context Protocol)** tool
definitions:

```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const myTool = tool(
  "tool_name",
  "Tool description",
  z.object({ param: z.string() }),
  async (args) => ({
    content: [{ type: "text", text: `Result: ${args.param}` }]
  })
);
```

Tools are registered via MCP servers:

```typescript
const server = createSdkMcpServer({
  name: "my-server",
  version: "1.0.0",
  tools: [myTool]
});
```

**Relevance to our plugin:** Our existing `LLMClient.chat()` interface is much
simpler. If we add tool use, the Anthropic Messages API's native tool_use format
is sufficient — we don't need MCP wrapping. The tool_use format from the Messages
API:

```json
{
  "name": "search_notes",
  "description": "Search vault notes",
  "input_schema": {
    "type": "object",
    "properties": { "query": { "type": "string" } },
    "required": ["query"]
  }
}
```

---

## Q3: Agent loop architecture

The SDK implements a **streaming agentic loop**:

```
User Input → Claude API → Tool Call Decision → Execute Tool → Feed Result Back → Repeat
```

Key characteristics:
- **Streaming:** Events yielded in real-time (SystemMessage, AssistantMessage, ResultMessage)
- **Autonomous:** Claude decides which tools to call and when to stop
- **Permission system:** `canUseTool` callback for allow/deny/transform
- **Session persistence:** Save/resume conversation state
- **Multi-turn:** Loop continues until Claude decides it's done

**What we'd need to replicate:** A simple tool-call loop using the Messages API
directly. The core pattern is straightforward:

```typescript
async function agentLoop(messages, tools) {
  while (true) {
    const response = await anthropicChat(messages, tools);
    if (response.stop_reason === "end_turn") return response;
    // Extract tool_use blocks, execute them, append tool_result
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input);
        messages.push({ role: "user", content: [{ type: "tool_result", ... }] });
      }
    }
  }
}
```

This is ~30 lines of code. The SDK's value is in its built-in tools (filesystem,
shell, etc.) — which we don't want in a plugin context anyway.

---

## Q4: Bedrock as backend provider

The SDK supports Bedrock via environment variables:

```bash
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

**Our plugin already handles Bedrock directly** via `bedrock-signing.ts` with
SigV4 request signing. This is the correct approach for a plugin — we control
the auth flow and don't depend on CLI environment variables.

The SDK uses Bedrock's `InvokeModelWithResponseStream` API, which is the same
endpoint our existing implementation targets. No advantage to switching.

---

## Q5: Bundle size implications

| Metric | Value |
|--------|-------|
| NPM package size | 56.6 MB |
| Core dependency | zod ^3.24.1 |
| Our current main.js | ~99 KB |

The SDK would increase our bundle by **~570x**. This is a non-starter for an
Obsidian plugin where users expect lightweight, fast-loading extensions.

Even if tree-shaking were possible (it isn't — the SDK is tightly coupled to
its CLI runtime), the fundamental architecture mismatch makes bundling irrelevant.

---

## Recommended Integration Pattern

### Keep: Direct Messages API (current approach)

Our existing `llm.ts` already implements direct API calls to Anthropic and
Bedrock. This is the right pattern for a plugin:

- Minimal dependencies
- Full control over auth (especially Bedrock SigV4)
- No external process dependencies
- ~99 KB total bundle

### Add: Lightweight tool-call loop (if agent features needed)

When ob-jhe (Agent SDK integration as chat backend) is implemented, the
recommended approach is:

1. **Define tools as JSON schemas** (Messages API format, not MCP)
2. **Implement a simple agentic loop** (~30-50 lines) that:
   - Sends messages with tool definitions to the API
   - Handles `tool_use` responses by executing plugin-native functions
   - Feeds `tool_result` back and continues until `end_turn`
3. **Plugin-native tools** (not filesystem/shell):
   - `search_notes` — uses existing RetrievalOrchestrator
   - `read_note` — uses VaultAdapter
   - `edit_note` — uses VaultAdapter with patch safety
   - `list_notes` — vault file listing
4. **Streaming** via the Messages API's native SSE streaming

### Maybe later: Node.js sidecar (if full agent needed)

If a future requirement demands the full Agent SDK (multi-agent orchestration,
MCP servers, complex tool pipelines), the pattern would be:

1. Plugin spawns a Node.js sidecar process
2. Sidecar runs the Agent SDK with custom MCP tools
3. Plugin communicates with sidecar over stdin/stdout or local socket
4. Sidecar handles all Claude API interaction

This is complex and should only be considered if the lightweight loop proves
insufficient.

---

## Decision Matrix

| Approach | Complexity | Bundle Impact | Bedrock Support | Agent Features |
|----------|-----------|---------------|-----------------|----------------|
| Direct API (current) | Low | None | Yes (existing) | Chat only |
| Direct API + tool loop | Low-Med | +~2 KB | Yes | Basic agent |
| Agent SDK (embedded) | **Blocked** | **+56 MB** | Yes | Full agent |
| Agent SDK (sidecar) | High | Separate process | Yes | Full agent |

**Recommendation: Direct API + tool loop** — provides agent capabilities
(tool use, multi-turn reasoning) with minimal complexity and zero new
dependencies.
