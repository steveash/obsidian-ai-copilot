import type { AICopilotSettings } from "./settings";
import { redactSensitive } from "./safety";
import { signBedrockRequest } from "./bedrock-signing";

export interface LLMClient {
  chat(prompt: string, system?: string): Promise<string>;
}

export class DryRunClient implements LLMClient {
  async chat(prompt: string): Promise<string> {
    return `DRY_RUN_RESPONSE\n\n${prompt.slice(0, 1200)}`;
  }
}

export class OpenAIClient implements LLMClient {
  constructor(private readonly settings: AICopilotSettings) {}

  async chat(prompt: string, system = "You are a helpful note assistant."): Promise<string> {
    if (!this.settings.allowRemoteModels) {
      throw new Error("Remote model calls are disabled in settings");
    }
    if (!this.settings.openaiApiKey) {
      throw new Error("OpenAI API key missing in plugin settings");
    }

    const boundedPrompt = prompt.slice(0, this.settings.maxPromptChars);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.openaiApiKey}`
      },
      body: JSON.stringify({
        model: this.settings.openaiModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: boundedPrompt }
        ]
      })
    });

    if (!response.ok) {
      const detail = redactSensitive(await response.text());
      throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return json.choices?.[0]?.message?.content?.trim() || "";
  }
}

export class AnthropicClient implements LLMClient {
  constructor(private readonly settings: AICopilotSettings) {}

  async chat(prompt: string, system = "You are a helpful note assistant."): Promise<string> {
    if (!this.settings.allowRemoteModels) {
      throw new Error("Remote model calls are disabled in settings");
    }
    if (!this.settings.anthropicApiKey) {
      throw new Error("Anthropic API key missing in plugin settings");
    }

    const boundedPrompt = prompt.slice(0, this.settings.maxPromptChars);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.settings.anthropicApiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.settings.anthropicModel,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: boundedPrompt }]
      })
    });

    if (!response.ok) {
      const detail = redactSensitive(await response.text());
      throw new Error(`Anthropic request failed: ${response.status} ${detail}`);
    }

    const json = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    return json.content?.find((b) => b.type === "text")?.text?.trim() || "";
  }
}

export class BedrockClient implements LLMClient {
  constructor(private readonly settings: AICopilotSettings) {}

  async chat(prompt: string, system = "You are a helpful note assistant."): Promise<string> {
    if (!this.settings.allowRemoteModels) {
      throw new Error("Remote model calls are disabled in settings");
    }
    if (!this.settings.bedrockAccessKeyId || !this.settings.bedrockSecretAccessKey) {
      throw new Error("AWS Bedrock credentials missing in plugin settings");
    }

    const boundedPrompt = prompt.slice(0, this.settings.maxPromptChars);
    const region = this.settings.bedrockRegion;
    const model = this.settings.bedrockModel;

    const body = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: boundedPrompt }]
    });

    const host = `bedrock-runtime.${region}.amazonaws.com`;
    const encodedPath = `/model/${encodeURIComponent(model)}/invoke`;
    const url = new URL(`https://${host}${encodedPath}`);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const headers = await signBedrockRequest(
      "POST", url, body, timestamp, region,
      this.settings.bedrockAccessKeyId, this.settings.bedrockSecretAccessKey
    );

    const response = await fetch(`https://${host}${encodedPath}`, {
      method: "POST",
      headers,
      body
    });

    if (!response.ok) {
      const detail = redactSensitive(await response.text());
      throw new Error(`Bedrock request failed: ${response.status} ${detail}`);
    }

    const json = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    return json.content?.find((b) => b.type === "text")?.text?.trim() || "";
  }
}

export function buildClient(settings: AICopilotSettings): LLMClient {
  if (!settings.allowRemoteModels) return new DryRunClient();
  switch (settings.provider) {
    case "openai":
      return new OpenAIClient(settings);
    case "anthropic":
      return new AnthropicClient(settings);
    case "bedrock":
      return new BedrockClient(settings);
    default:
      return new DryRunClient();
  }
}
