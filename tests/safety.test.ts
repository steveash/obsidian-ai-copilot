import { describe, expect, it } from "vitest";
import { redactSensitive } from "../src/safety";

describe("redactSensitive", () => {
  it("redacts common API key formats", () => {
    const text = 'token sk-abcdefghijklmnopqrstuvwxyz12345 and api_key="abcdef1234567890abcd"';
    const out = redactSensitive(text);
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz12345");
    expect(out).not.toContain("abcdef1234567890abcd");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts Anthropic API keys", () => {
    const text = "key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz end";
    const out = redactSensitive(text);
    expect(out).not.toContain("sk-ant-");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts AWS access key IDs", () => {
    const text = "aws key AKIAIOSFODNN7EXAMPLE done";
    const out = redactSensitive(text);
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig";
    const out = redactSensitive(text);
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts AWS secret key assignments", () => {
    const text = 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
    const out = redactSensitive(text);
    expect(out).not.toContain("wJalrXUtnFEMI");
    expect(out).toContain("[REDACTED]");
  });

  it("preserves non-sensitive text", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    expect(redactSensitive(text)).toBe(text);
  });
});
