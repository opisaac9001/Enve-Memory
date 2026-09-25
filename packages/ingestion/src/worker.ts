import type { EnveMemory } from '@enve-memory/core';
import type { FetchOptions } from './fetch.ts';
import { processPending } from './ingest.ts';

/** Drains pending items in the background of a long-running process. kick() after anything that queues work. */
export class IngestWorker {
  private readonly memory: EnveMemory;
  private readonly options: FetchOptions;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(memory: EnveMemory, options: FetchOptions = {}) {
    this.memory = memory;
    this.options = options;
  }

  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.drain()
      .catch((error: unknown) => console.error('ingest:', error))
      .finally(() => {
        this.running = null;
      });
  }

  /** Resolves once nothing is queued; for tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    do {
      this.again = false;
      while ((await processPending(this.memory, this.options)) > 0);
    } while (this.again);
  }
}
