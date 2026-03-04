import type { AICopilotSettings } from "./settings";

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
    if (!this.settings.openaiApiKey) {
      throw new Error("OpenAI API key missing in plugin settings");
    }

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
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return json.choices?.[0]?.message?.content?.trim() || "";
  }
}

export function buildClient(settings: AICopilotSettings): LLMClient {
  if (settings.provider === "openai") return new OpenAIClient(settings);
  return new DryRunClient();
}
