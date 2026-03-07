import { chunkMarkdownByHeading } from "./chunker";
import type { PersistentVectorIndex } from "./vector-index";
import { formatChunkContent } from "./retrieval-context";

export interface IndexableNote {
  path: string;
  content: string;
  mtime?: number;
}

export function toIndexedChunks(note: IndexableNote, chunkSize: number) {
  return chunkMarkdownByHeading(note.path, note.content, chunkSize).map((chunk) => ({
    id: chunk.chunkId,
    path: chunk.path,
    content: formatChunkContent(chunk.path, chunk.heading, chunk.text),
    mtime: note.mtime
  }));
}

export async function syncIndexedNote(
  index: PersistentVectorIndex,
  note: IndexableNote,
  model: string,
  chunkSize: number
): Promise<number> {
  const chunks = toIndexedChunks(note, chunkSize);
  return index.indexChunks(chunks, model);
}

export async function removeIndexedNote(index: PersistentVectorIndex, path: string): Promise<void> {
  await index.removePath(path);
}
