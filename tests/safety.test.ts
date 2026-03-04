import { describe, expect, it } from "vitest";
import { redactSensitive } from "../src/safety";

describe("redactSensitive", () => {
  it("redacts common API key formats", () => {
    const text = 'token sk-abcdefghijklmnopqrstuvwxyz12345 and api_key="abcdef1234567890abcd"';
    const out = redactSensitive(text);
    expect(out).not.toContain("sk-");
    expect(out).not.toContain("abcdef1234567890abcd");
    expect(out).toContain("[REDACTED]");
  });
});
