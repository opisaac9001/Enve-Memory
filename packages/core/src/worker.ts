/**
 * Runs a batch step until it reports no work left, one drain at a time. kick() after anything that
 * might queue work; kicks during a drain schedule one more pass instead of a second concurrent drain.
 */
export class DrainWorker {
  private readonly name: string;
  private readonly step: () => Promise<number>;
  private readonly after?: () => void;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(name: string, step: () => Promise<number>, after?: () => void) {
    this.name = name;
    this.step = step;
    this.after = after;
  }

  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.drain()
      .catch((error: unknown) => console.error(`${this.name}:`, error))
      .finally(() => {
        this.running = null;
      });
  }

  /** Resolves once nothing is queued; for tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    let worked = false;
    do {
      this.again = false;
      while ((await this.step()) > 0) worked = true;
    } while (this.again);
    if (worked) this.after?.();
  }
}
