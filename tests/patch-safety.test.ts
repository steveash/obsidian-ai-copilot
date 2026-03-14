import { describe, expect, it } from "vitest";
import {
  checkPathProtected,
  checkEditSize,
  checkSecretTouching,
  runSafetyChecks
} from "../src/patch-safety";

describe("checkPathProtected", () => {
  it("blocks .obsidian/ paths", () => {
    const r = checkPathProtected(".obsidian/plugins/foo.json");
    expect(r.safe).toBe(false);
    expect(r.issues[0]).toContain(".obsidian/");
  });

  it("blocks .env files", () => {
    const r = checkPathProtected(".env");
    expect(r.safe).toBe(false);
  });

  it("allows normal note paths", () => {
    const r = checkPathProtected("notes/daily/2026-03-14.md");
    expect(r.safe).toBe(true);
  });

  it("supports custom protected paths", () => {
    const r = checkPathProtected("secret/keys.md", ["secret/"]);
    expect(r.safe).toBe(false);
  });
});

describe("checkEditSize", () => {
  it("passes for normal edits", () => {
    const r = checkEditSize("hello", "world");
    expect(r.safe).toBe(true);
  });

  it("blocks oversized find strings", () => {
    const big = "x".repeat(60_000);
    const r = checkEditSize(big, "y");
    expect(r.safe).toBe(false);
    expect(r.issues[0]).toContain("find string");
  });

  it("blocks oversized replace strings", () => {
    const big = "x".repeat(60_000);
    const r = checkEditSize("y", big);
    expect(r.safe).toBe(false);
    expect(r.issues[0]).toContain("replace string");
  });

  it("respects custom max size", () => {
    const r = checkEditSize("hello world", "x", 5);
    expect(r.safe).toBe(false);
  });
});

describe("checkSecretTouching", () => {
  it("blocks find strings containing API keys", () => {
    const r = checkSecretTouching("key is sk-abcdefghijklmnopqrstuvwx", "redacted");
    expect(r.safe).toBe(false);
    expect(r.issues[0]).toContain("find string");
  });

  it("blocks replace strings containing API keys", () => {
    const r = checkSecretTouching("placeholder", "sk-ant-abcdefghijklmnopqrstuvwx");
    expect(r.safe).toBe(false);
    expect(r.issues[0]).toContain("replace string");
  });

  it("blocks AWS access key patterns", () => {
    const r = checkSecretTouching("AKIAIOSFODNN7EXAMPLE", "redacted");
    expect(r.safe).toBe(false);
  });

  it("passes for normal text", () => {
    const r = checkSecretTouching("hello world", "goodbye world");
    expect(r.safe).toBe(true);
  });
});

describe("runSafetyChecks", () => {
  it("combines all checks", () => {
    const r = runSafetyChecks(".obsidian/config.json", "x".repeat(60_000), "y");
    expect(r.safe).toBe(false);
    expect(r.issues.length).toBeGreaterThan(1);
  });

  it("passes when all checks are clean", () => {
    const r = runSafetyChecks("notes/todo.md", "old text", "new text");
    expect(r.safe).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("can disable secret touching check", () => {
    const r = runSafetyChecks(
      "notes/keys.md",
      "sk-abcdefghijklmnopqrstuvwx",
      "redacted",
      { blockSecretTouching: false }
    );
    expect(r.safe).toBe(true);
  });
});
