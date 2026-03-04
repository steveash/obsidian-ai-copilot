const API_KEY_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi
];

export function redactSensitive(input: string): string {
  let output = input;
  for (const pattern of API_KEY_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}
