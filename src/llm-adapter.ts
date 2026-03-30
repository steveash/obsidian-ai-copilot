import { generateText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { AICopilotSettings } from "./settings";
import type { AgentClient, AgentMessage, ContentBlock, MessagesResponse } from "./agent-loop";

export interface LLMClient {
  chat(prompt: string, system?: string): Promise<string>;
}

export class DryRunClient implements LLMClient {
  async chat(prompt: string): Promise<string> {
    return `DRY_RUN_RESPONSE\n\n${prompt.slice(0, 1200)}`;
  }
}

function resolveModel(settings: AICopilotSettings): LanguageModel {
  switch (settings.provider) {
    case "openai": {
      const provider = createOpenAI({ apiKey: settings.openaiApiKey });
      return provider(settings.openaiModel);
    }
    case "anthropic": {
      const provider = createAnthropic({ apiKey: settings.anthropicApiKey });
      return provider(settings.anthropicModel);
    }
    case "bedrock": {
      const provider = createAmazonBedrock({
        region: settings.bedrockRegion,
        accessKeyId: settings.bedrockAccessKeyId,
        secretAccessKey: settings.bedrockSecretAccessKey,
      });
      return provider(settings.bedrockModel);
    }
    default:
      throw new Error(`Unknown provider: ${settings.provider}`);
  }
}

function validateRemoteAccess(settings: AICopilotSettings): void {
  if (!settings.allowRemoteModels) {
    throw new Error("Remote model calls are disabled in settings");
  }
}

export class AISDKClient implements LLMClient {
  constructor(private readonly settings: AICopilotSettings) {}

  async chat(prompt: string, system = "You are a helpful note assistant."): Promise<string> {
    validateRemoteAccess(this.settings);
    const model = resolveModel(this.settings);
    const boundedPrompt = prompt.slice(0, this.settings.maxPromptChars);

    const result = await generateText({
      model,
      system,
      messages: [{ role: "user" as const, content: boundedPrompt }],
    });

    return result.text.trim();
  }
}

export class AISDKAgentClient implements AgentClient {
  constructor(private readonly settings: AICopilotSettings) {}

  async chatMessages(
    messages: AgentMessage[],
    system: string,
    _tools: unknown[],
    maxTokens: number
  ): Promise<MessagesResponse> {
    validateRemoteAccess(this.settings);
    const model = resolveModel(this.settings);

    // Convert our AgentMessage format to AI SDK ModelMessage format.
    // AI SDK uses separate message types:
    //   - { role: "user", content: string | UserContent[] }
    //   - { role: "assistant", content: string | AssistantContent[] }
    //   - { role: "tool", content: ToolContent[] }
    // Our format packs tool results inside user messages, so we split them out.
    const sdkMessages: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        sdkMessages.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (msg.role === "assistant") {
        const parts: Array<Record<string, unknown>> = [];
        for (const block of msg.content as ContentBlock[]) {
          if (block.type === "text" && block.text) {
            parts.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use" && block.id && block.name) {
            parts.push({
              type: "tool-call",
              toolCallId: block.id,
              toolName: block.name,
              input: block.input ?? {},
            });
          }
        }
        sdkMessages.push({ role: "assistant", content: parts });
        continue;
      }

      // User messages: separate text parts from tool results.
      // Tool results become { role: "tool" } messages in AI SDK.
      const toolResults: Array<Record<string, unknown>> = [];
      const textParts: Array<Record<string, unknown>> = [];

      for (const block of msg.content as ContentBlock[]) {
        if (block.type === "text" && block.text) {
          textParts.push({ type: "text", text: block.text });
        } else if (block.type === "tool_result" && block.tool_use_id) {
          toolResults.push({
            type: "tool-result",
            toolCallId: block.tool_use_id,
            toolName: "tool",
            output: { type: "text", value: block.content ?? "" },
          });
        }
      }

      if (toolResults.length > 0) {
        sdkMessages.push({ role: "tool", content: toolResults });
      }
      if (textParts.length > 0) {
        sdkMessages.push({ role: "user", content: textParts });
      }
    }

    const result = await generateText({
      model,
      system,
      messages: sdkMessages as unknown as Array<{ role: string; content: unknown }>,
      maxOutputTokens: maxTokens,
    } as Parameters<typeof generateText>[0]);

    // Convert AI SDK response back to our ContentBlock format
    const content: ContentBlock[] = [];

    if (result.text) {
      content.push({ type: "text", text: result.text });
    }

    for (const tc of result.toolCalls ?? []) {
      content.push({
        type: "tool_use",
        id: tc.toolCallId,
        name: tc.toolName,
        input: (tc as unknown as Record<string, unknown>).input as Record<string, unknown>,
      });
    }

    // Map stop reason
    let stopReason: MessagesResponse["stop_reason"] = "end_turn";
    if (result.finishReason === "tool-calls") {
      stopReason = "tool_use";
    } else if (result.finishReason === "length") {
      stopReason = "max_tokens";
    } else if (result.finishReason === "stop") {
      stopReason = "end_turn";
    }

    return { content, stop_reason: stopReason };
  }
}

export function buildClient(settings: AICopilotSettings): LLMClient {
  if (!settings.allowRemoteModels) return new DryRunClient();
  if (settings.provider === "none") return new DryRunClient();
  return new AISDKClient(settings);
}

export function buildAgentClient(settings: AICopilotSettings): AgentClient | null {
  if (!settings.allowRemoteModels) return null;
  if (settings.provider === "none") return null;
  return new AISDKAgentClient(settings);
}
