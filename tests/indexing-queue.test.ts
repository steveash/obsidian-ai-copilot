import { describe, expect, it } from "vitest";
import { BackgroundIndexingQueue } from "../src/indexing-queue";

describe("background indexing queue", () => {
  it("processes jobs sequentially and tracks stats", async () => {
    const q = new BackgroundIndexingQueue();
    const out: number[] = [];

    q.enqueue(async () => {
      out.push(1);
    });
    q.enqueue(async () => {
      out.push(2);
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(out).toEqual([1, 2]);
    const stats = q.stats();
    expect(stats.processed).toBe(2);
    expect(stats.failed).toBe(0);
  });
});
