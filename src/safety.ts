const API_KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /(?:aws_?secret_?access_?key|secret_?key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}["']?/gi,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi
];

export function redactSensitive(input: string): string {
  let output = input;
  for (const pattern of API_KEY_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}
