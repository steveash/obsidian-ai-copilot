export interface NoteChunk {
  chunkId: string;
  path: string;
  heading: string;
  text: string;
  order: number;
}

function normalizeHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim() || "(untitled section)";
}

export function chunkMarkdownByHeading(path: string, markdown: string, maxChars = 1200): NoteChunk[] {
  const lines = markdown.split(/\r?\n/);
  const chunks: NoteChunk[] = [];
  let currentHeading = "Document";
  let buffer: string[] = [];
  let order = 0;

  const flush = () => {
    if (!buffer.length) return;
    const raw = buffer.join("\n").trim();
    buffer = [];
    if (!raw) return;

    if (raw.length <= maxChars) {
      chunks.push({
        chunkId: `${path}#${order++}`,
        path,
        heading: currentHeading,
        text: raw,
        order
      });
      return;
    }

    // fallback split for large sections
    for (let i = 0; i < raw.length; i += maxChars) {
      chunks.push({
        chunkId: `${path}#${order++}`,
        path,
        heading: currentHeading,
        text: raw.slice(i, i + maxChars),
        order
      });
    }
  };

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      currentHeading = normalizeHeading(line);
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (!chunks.length) {
    chunks.push({ chunkId: `${path}#0`, path, heading: "Document", text: markdown.slice(0, maxChars), order: 0 });
  }
  return chunks;
}
