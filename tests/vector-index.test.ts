import { describe, expect, it } from "vitest";
import { InMemoryVectorStorage, PersistentVectorIndex } from "../src/vector-index";

class MockProvider {
  calls = 0;
  async embed(text: string): Promise<number[]> {
    this.calls += 1;
    return [text.length, 1];
  }
}

describe("PersistentVectorIndex", () => {
  it("caches by content hash and model", async () => {
    const storage = new InMemoryVectorStorage();
    const provider = new MockProvider();
    const idx = new PersistentVectorIndex(storage, provider);

    const a1 = await idx.getOrCreate("a.md#0", "a.md", "hello", "m1");
    const a2 = await idx.getOrCreate("a.md#0", "a.md", "hello", "m1");
    expect(a1).toEqual(a2);
    expect(provider.calls).toBe(1);

    await idx.getOrCreate("a.md#0", "a.md", "hello world", "m1");
    expect(provider.calls).toBe(2);

    await idx.getOrCreate("a.md#0", "a.md", "hello world", "m2");
    expect(provider.calls).toBe(3);
  });
});
