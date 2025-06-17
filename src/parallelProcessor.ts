export class ParallelProcessor<T, R> {
  private concurrency: number;
  private activeCount: number = 0;
  private queue: Array<() => void> = [];

  constructor(concurrency: number = 4) {
    this.concurrency = concurrency;
  }

  async process(
    items: T[],
    processor: (item: T) => Promise<R>
  ): Promise<Array<{ item: T; result?: R; error?: Error }>> {
    const results: Array<{ item: T; result?: R; error?: Error }> = [];

    await Promise.all(
      items.map((item, index) =>
        this.enqueue(async () => {
          try {
            const result = await processor(item);
            results[index] = { item, result };
          } catch (error) {
            results[index] = { item, error: error as Error };
          }
        })
      )
    );

    return results;
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      const run = async () => {
        this.activeCount++;
        try {
          await fn();
        } finally {
          this.activeCount--;
          if (this.queue.length > 0) {
            const next = this.queue.shift();
            next?.();
          }
          resolve();
        }
      };

      if (this.activeCount < this.concurrency) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }
}
