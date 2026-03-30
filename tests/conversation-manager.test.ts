import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryVaultAdapter } from "../src/vault-adapter";
import {
  ConversationManager,
  serializeConversation,
  parseConversationFile,
  parseFrontmatter,
  type Conversation,
} from "../src/conversation-manager";

describe("ConversationManager", () => {
  let vault: InMemoryVaultAdapter;
  let manager: ConversationManager;

  beforeEach(() => {
    vault = new InMemoryVaultAdapter();
    manager = new ConversationManager(vault);
  });

  describe("create", () => {
    it("creates a conversation with metadata", async () => {
      const conv = await manager.create("Test topic", "gpt-4o");

      expect(conv.meta.id).toHaveLength(8);
      expect(conv.meta.topic).toBe("Test topic");
      expect(conv.meta.model).toBe("gpt-4o");
      expect(conv.messages).toEqual([]);
    });

    it("persists conversation to vault", async () => {
      await manager.create("My Chat", "gpt-4o");

      const files = vault.listMarkdownFiles();
      const convFile = files.find((f) => f.path.includes("Conversations/My Chat.md"));
      expect(convFile).toBeDefined();
    });
  });

  describe("addMessage", () => {
    it("adds messages to the conversation", async () => {
      const conv = await manager.create("Test", "gpt-4o");

      await manager.addMessage(conv.meta.id, "user", "Hello!");
      await manager.addMessage(conv.meta.id, "assistant", "Hi there!");

      const updated = await manager.get(conv.meta.id);
      expect(updated!.messages).toHaveLength(2);
      expect(updated!.messages[0].role).toBe("user");
      expect(updated!.messages[0].content).toBe("Hello!");
      expect(updated!.messages[1].role).toBe("assistant");
      expect(updated!.messages[1].content).toBe("Hi there!");
    });

    it("throws for unknown conversation ID", async () => {
      await expect(
        manager.addMessage("nonexistent", "user", "hello")
      ).rejects.toThrow("Conversation not found");
    });

    it("updates the updatedAt timestamp", async () => {
      const conv = await manager.create("Test", "gpt-4o");
      const originalUpdated = conv.meta.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));
      await manager.addMessage(conv.meta.id, "user", "Hello");

      const updated = await manager.get(conv.meta.id);
      expect(updated!.meta.updatedAt).not.toBe(originalUpdated);
    });
  });

  describe("getContextWindow", () => {
    it("returns all messages when under limit", async () => {
      const conv = await manager.create("Test", "gpt-4o");
      await manager.addMessage(conv.meta.id, "user", "Hello");
      await manager.addMessage(conv.meta.id, "assistant", "Hi");

      const updated = await manager.get(conv.meta.id);
      const window = manager.getContextWindow(updated!);
      expect(window).toHaveLength(2);
    });

    it("applies sliding window for long conversations", async () => {
      const smallManager = new ConversationManager(vault, 3);
      const conv = await smallManager.create("Test", "gpt-4o");

      for (let i = 0; i < 6; i++) {
        await smallManager.addMessage(conv.meta.id, "user", `msg-${i}`);
      }

      const updated = await smallManager.get(conv.meta.id);
      const window = smallManager.getContextWindow(updated!);
      expect(window).toHaveLength(3);
      expect(window[0].content).toBe("msg-3");
      expect(window[2].content).toBe("msg-5");
    });

    it("preserves system messages outside the window", async () => {
      const smallManager = new ConversationManager(vault, 2);
      const conv = await smallManager.create("Test", "gpt-4o");

      await smallManager.addMessage(conv.meta.id, "system", "You are a helpful assistant.");
      for (let i = 0; i < 5; i++) {
        await smallManager.addMessage(conv.meta.id, "user", `msg-${i}`);
      }

      const updated = await smallManager.get(conv.meta.id);
      const window = smallManager.getContextWindow(updated!);

      // System message + 2 most recent user messages
      expect(window).toHaveLength(3);
      expect(window[0].role).toBe("system");
      expect(window[1].content).toBe("msg-3");
      expect(window[2].content).toBe("msg-4");
    });
  });

  describe("toAgentMessages", () => {
    it("converts to AgentMessage format excluding system messages", async () => {
      const conv = await manager.create("Test", "gpt-4o");
      await manager.addMessage(conv.meta.id, "system", "Context info");
      await manager.addMessage(conv.meta.id, "user", "Hello");
      await manager.addMessage(conv.meta.id, "assistant", "Hi");

      const updated = await manager.get(conv.meta.id);
      const agentMsgs = manager.toAgentMessages(updated!);

      expect(agentMsgs).toHaveLength(2);
      expect(agentMsgs[0]).toEqual({ role: "user", content: "Hello" });
      expect(agentMsgs[1]).toEqual({ role: "assistant", content: "Hi" });
    });
  });

  describe("getSystemContext", () => {
    it("extracts system message contents", async () => {
      const conv = await manager.create("Test", "gpt-4o");
      await manager.addMessage(conv.meta.id, "system", "Context A");
      await manager.addMessage(conv.meta.id, "user", "Hello");
      await manager.addMessage(conv.meta.id, "system", "Context B");

      const updated = await manager.get(conv.meta.id);
      const ctx = manager.getSystemContext(updated!);
      expect(ctx).toEqual(["Context A", "Context B"]);
    });
  });

  describe("persistence round-trip", () => {
    it("persists and reloads a conversation from vault", async () => {
      const conv = await manager.create("Round Trip", "claude-sonnet");
      await manager.addMessage(conv.meta.id, "system", "Vault context here");
      await manager.addMessage(conv.meta.id, "user", "What is X?");
      await manager.addMessage(conv.meta.id, "assistant", "X is a thing.");

      // Create a new manager to force loading from vault
      const manager2 = new ConversationManager(vault);
      const loaded = await manager2.get(conv.meta.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.meta.id).toBe(conv.meta.id);
      expect(loaded!.meta.topic).toBe("Round Trip");
      expect(loaded!.meta.model).toBe("claude-sonnet");
      expect(loaded!.messages).toHaveLength(3);
      expect(loaded!.messages[0].role).toBe("system");
      expect(loaded!.messages[0].content).toBe("Vault context here");
      expect(loaded!.messages[1].role).toBe("user");
      expect(loaded!.messages[1].content).toBe("What is X?");
      expect(loaded!.messages[2].role).toBe("assistant");
      expect(loaded!.messages[2].content).toBe("X is a thing.");
    });
  });

  describe("list", () => {
    it("lists conversations sorted by most recent", async () => {
      const conv1 = await manager.create("First", "gpt-4o");
      await new Promise((r) => setTimeout(r, 10));
      const conv2 = await manager.create("Second", "gpt-4o");
      await manager.addMessage(conv2.meta.id, "user", "msg");

      const list = await manager.list();
      expect(list).toHaveLength(2);
      expect(list[0].topic).toBe("Second");
      expect(list[1].topic).toBe("First");
    });
  });

  describe("topic sanitization", () => {
    it("sanitizes special characters in topic for file path", async () => {
      await manager.create("What is foo/bar?", "gpt-4o");

      const files = vault.listMarkdownFiles();
      const convFile = files.find((f) => f.path.includes("Conversations/"));
      expect(convFile).toBeDefined();
      expect(convFile!.path).not.toContain("/bar");
      expect(convFile!.path).toContain("What is foo-bar");
    });
  });
});

describe("serializeConversation", () => {
  it("produces valid markdown with frontmatter", () => {
    const conv: Conversation = {
      meta: {
        id: "abc12345",
        topic: "Test",
        model: "gpt-4o",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:01:00Z",
      },
      messages: [
        { role: "user", content: "Hello", timestamp: 1704067200000 },
        { role: "assistant", content: "Hi!", timestamp: 1704067260000 },
      ],
    };

    const md = serializeConversation(conv);
    expect(md).toContain("---");
    expect(md).toContain("id: abc12345");
    expect(md).toContain("topic: Test");
    expect(md).toContain("model: gpt-4o");
    expect(md).toContain("## user (");
    expect(md).toContain("Hello");
    expect(md).toContain("## assistant (");
    expect(md).toContain("Hi!");
  });
});

describe("parseFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const content = `---
id: abc12345
topic: My Chat
model: gpt-4o
created: 2025-01-01T00:00:00Z
updated: 2025-01-01T00:01:00Z
---

## user (2025-01-01T00:00:00.000Z)

Hello`;

    const meta = parseFrontmatter(content);
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe("abc12345");
    expect(meta!.topic).toBe("My Chat");
    expect(meta!.model).toBe("gpt-4o");
  });

  it("returns null for content without frontmatter", () => {
    expect(parseFrontmatter("# Just a heading\nSome text")).toBeNull();
  });
});

describe("parseConversationFile", () => {
  it("round-trips through serialize and parse", () => {
    const conv: Conversation = {
      meta: {
        id: "test1234",
        topic: "Round Trip",
        model: "claude-sonnet",
        createdAt: "2025-06-01T10:00:00Z",
        updatedAt: "2025-06-01T10:05:00Z",
      },
      messages: [
        { role: "system", content: "You are helpful.", timestamp: 1717236000000 },
        { role: "user", content: "Question?", timestamp: 1717236060000 },
        { role: "assistant", content: "Answer.", timestamp: 1717236120000 },
      ],
    };

    const serialized = serializeConversation(conv);
    const parsed = parseConversationFile(serialized);

    expect(parsed).not.toBeNull();
    expect(parsed!.meta.id).toBe("test1234");
    expect(parsed!.meta.topic).toBe("Round Trip");
    expect(parsed!.messages).toHaveLength(3);
    expect(parsed!.messages[0].role).toBe("system");
    expect(parsed!.messages[0].content).toBe("You are helpful.");
    expect(parsed!.messages[1].role).toBe("user");
    expect(parsed!.messages[1].content).toBe("Question?");
    expect(parsed!.messages[2].role).toBe("assistant");
    expect(parsed!.messages[2].content).toBe("Answer.");
  });
});
