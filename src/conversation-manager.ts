import type { VaultAdapter } from "./vault-adapter";
import type { AgentMessage } from "./agent-loop";

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface ConversationMeta {
  id: string;
  topic: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  meta: ConversationMeta;
  messages: ConversationMessage[];
}

const CONVERSATIONS_DIR = "AI Copilot/Conversations";

/**
 * Manages multi-turn conversations with vault persistence.
 * Conversations are stored as Markdown files with YAML frontmatter
 * in AI Copilot/Conversations/<topic>.md
 */
export class ConversationManager {
  private conversations = new Map<string, Conversation>();

  constructor(
    private readonly vault: VaultAdapter,
    private readonly maxContextMessages: number = 20
  ) {}

  /** Create a new conversation and persist it. */
  async create(topic: string, model: string): Promise<Conversation> {
    const id = generateId();
    const now = new Date().toISOString();
    const conv: Conversation = {
      meta: { id, topic, model, createdAt: now, updatedAt: now },
      messages: [],
    };
    this.conversations.set(id, conv);
    await this.persist(conv);
    return conv;
  }

  /** Get a conversation by ID (from cache or vault). */
  async get(id: string): Promise<Conversation | null> {
    const cached = this.conversations.get(id);
    if (cached) return cached;
    return this.loadFromVault(id);
  }

  /** Add a message to a conversation and persist. */
  async addMessage(
    id: string,
    role: ConversationMessage["role"],
    content: string
  ): Promise<void> {
    const conv = await this.get(id);
    if (!conv) throw new Error(`Conversation not found: ${id}`);
    conv.messages.push({ role, content, timestamp: Date.now() });
    conv.meta.updatedAt = new Date().toISOString();
    await this.persist(conv);
  }

  /**
   * Return the sliding window of messages for the context window,
   * keeping the most recent messages up to maxContextMessages.
   * Always includes any system messages from the start.
   */
  getContextWindow(conv: Conversation): ConversationMessage[] {
    const systemMessages = conv.messages.filter((m) => m.role === "system");
    const nonSystem = conv.messages.filter((m) => m.role !== "system");

    if (nonSystem.length <= this.maxContextMessages) {
      return [...systemMessages, ...nonSystem];
    }

    const window = nonSystem.slice(-this.maxContextMessages);
    return [...systemMessages, ...window];
  }

  /**
   * Build AgentMessage[] from the context window for use with the agent loop.
   * System messages are excluded (they should be injected as the system prompt).
   */
  toAgentMessages(conv: Conversation): AgentMessage[] {
    const window = this.getContextWindow(conv);
    return window
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  }

  /** Extract system messages from the conversation for use as system prompt context. */
  getSystemContext(conv: Conversation): string[] {
    return conv.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);
  }

  /** List all conversation metadata by reading the conversations directory. */
  async list(): Promise<ConversationMeta[]> {
    const files = this.vault.listMarkdownFiles();
    const convFiles = files.filter((f) => f.path.startsWith(CONVERSATIONS_DIR + "/"));
    const metas: ConversationMeta[] = [];

    for (const file of convFiles) {
      try {
        const content = await this.vault.read(file.path);
        const meta = parseFrontmatter(content);
        if (meta) metas.push(meta);
      } catch {
        // Skip unreadable files
      }
    }

    return metas.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /** Load a conversation from vault by scanning for the matching ID in frontmatter. */
  private async loadFromVault(id: string): Promise<Conversation | null> {
    const files = this.vault.listMarkdownFiles();
    const convFiles = files.filter((f) => f.path.startsWith(CONVERSATIONS_DIR + "/"));

    for (const file of convFiles) {
      try {
        const content = await this.vault.read(file.path);
        const conv = parseConversationFile(content);
        if (conv && conv.meta.id === id) {
          this.conversations.set(id, conv);
          return conv;
        }
      } catch {
        // Skip unreadable files
      }
    }

    return null;
  }

  /** Persist a conversation as a Markdown file with YAML frontmatter. */
  private async persist(conv: Conversation): Promise<void> {
    await this.ensureFolder();
    const path = this.conversationPath(conv.meta.topic);
    const content = serializeConversation(conv);

    if (this.vault.exists(path)) {
      await this.vault.modify(path, content);
    } else {
      await this.vault.create(path, content);
    }
  }

  private conversationPath(topic: string): string {
    const safeTopic = topic.replace(/[/\\:*?"<>|]/g, "-").slice(0, 100);
    return `${CONVERSATIONS_DIR}/${safeTopic}.md`;
  }

  private async ensureFolder(): Promise<void> {
    if (!this.vault.exists("AI Copilot")) {
      await this.vault.createFolder("AI Copilot");
    }
    if (!this.vault.exists(CONVERSATIONS_DIR)) {
      await this.vault.createFolder(CONVERSATIONS_DIR);
    }
  }
}

/** Generate a short random ID. */
function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** Serialize a conversation to Markdown with YAML frontmatter. */
export function serializeConversation(conv: Conversation): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`id: ${conv.meta.id}`);
  lines.push(`topic: ${conv.meta.topic}`);
  lines.push(`model: ${conv.meta.model}`);
  lines.push(`created: ${conv.meta.createdAt}`);
  lines.push(`updated: ${conv.meta.updatedAt}`);
  lines.push("---");
  lines.push("");

  for (const msg of conv.messages) {
    const ts = new Date(msg.timestamp).toISOString();
    lines.push(`## ${msg.role} (${ts})`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}

/** Parse YAML frontmatter from a conversation file. */
export function parseFrontmatter(content: string): ConversationMeta | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const id = extractYamlField(yaml, "id");
  const topic = extractYamlField(yaml, "topic");
  const model = extractYamlField(yaml, "model");
  const createdAt = extractYamlField(yaml, "created");
  const updatedAt = extractYamlField(yaml, "updated");

  if (!id || !topic) return null;

  return {
    id,
    topic,
    model: model ?? "unknown",
    createdAt: createdAt ?? "",
    updatedAt: updatedAt ?? "",
  };
}

/** Parse a full conversation file (frontmatter + messages). */
export function parseConversationFile(content: string): Conversation | null {
  const meta = parseFrontmatter(content);
  if (!meta) return null;

  // Extract body after frontmatter
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  const body = bodyMatch?.[1] ?? "";

  const messages: ConversationMessage[] = [];
  // Match ## role (timestamp) sections
  const sectionPattern = /## (user|assistant|system) \((\S+)\)\n\n([\s\S]*?)(?=\n## (?:user|assistant|system) \(|$)/g;
  let m;
  while ((m = sectionPattern.exec(body)) !== null) {
    const role = m[1] as ConversationMessage["role"];
    const timestamp = new Date(m[2]).getTime();
    const msgContent = m[3].trimEnd();
    messages.push({ role, content: msgContent, timestamp });
  }

  return { meta, messages };
}

function extractYamlField(yaml: string, field: string): string | null {
  const regex = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const match = yaml.match(regex);
  return match ? match[1].trim() : null;
}
