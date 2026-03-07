export interface IndexQueueStats {
  pending: number;
  running: boolean;
  processed: number;
  failed: number;
  lastError?: string;
  lastRunAt?: number;
}

export class BackgroundIndexingQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  private processed = 0;
  private failed = 0;
  private lastError: string | undefined;
  private lastRunAt: number | undefined;

  enqueue(job: () => Promise<void>) {
    this.queue.push(job);
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      if (!job) break;
      try {
        await job();
        this.processed += 1;
      } catch (err) {
        this.failed += 1;
        this.lastError = err instanceof Error ? err.message : String(err);
      } finally {
        this.lastRunAt = Date.now();
      }
    }
    this.running = false;
  }

  stats(): IndexQueueStats {
    return {
      pending: this.queue.length,
      running: this.running,
      processed: this.processed,
      failed: this.failed,
      lastError: this.lastError,
      lastRunAt: this.lastRunAt
    };
  }
}
