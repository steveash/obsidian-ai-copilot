import type { AICopilotSettings } from "./settings";
import { redactSensitive } from "./safety";

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

  /** AWS Signature V4 signing for Bedrock invoke requests. */
  private async sign(
    method: string,
    url: URL,
    body: string,
    timestamp: string
  ): Promise<Record<string, string>> {
    const region = this.settings.bedrockRegion;
    const accessKey = this.settings.bedrockAccessKeyId;
    const secretKey = this.settings.bedrockSecretAccessKey;
    const service = "bedrock";
    const dateStamp = timestamp.slice(0, 8);

    const enc = new TextEncoder();

    async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key instanceof ArrayBuffer ? new Uint8Array(key) as BufferSource : key as BufferSource,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
    }

    async function sha256(data: string): Promise<string> {
      const digest = await crypto.subtle.digest("SHA-256", enc.encode(data));
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    const payloadHash = await sha256(body);
    const host = url.hostname;
    // SigV4 requires each path segment to be URI-encoded; `new URL().pathname`
    // does not encode chars like `:` that are valid in URLs but must be encoded
    // for the canonical URI (e.g. model IDs containing `v1:0`).
    const canonicalUri =
      "/" + url.pathname.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const canonicalQuerystring = "";

    const signedHeaders = "content-type;host;x-amz-date";
    const canonicalHeaders =
      `content-type:application/json\nhost:${host}\nx-amz-date:${timestamp}\n`;

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      credentialScope,
      await sha256(canonicalRequest)
    ].join("\n");

    const kDate = await hmac(enc.encode("AWS4" + secretKey), dateStamp);
    const kRegion = await hmac(kDate, region);
    const kService = await hmac(kRegion, service);
    const kSigning = await hmac(kService, "aws4_request");

    const signatureBuffer = await hmac(kSigning, stringToSign);
    const signature = [...new Uint8Array(signatureBuffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      "Content-Type": "application/json",
      "X-Amz-Date": timestamp,
      Authorization: authorization
    };
  }

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
    const headers = await this.sign("POST", url, body, timestamp);

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
