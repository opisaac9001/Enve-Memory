import { type AiProvider, type KeyLookup, enrichWorker, providerFor } from '@enve-memory/ai';
import { type ApiServer, createApiServer, lanUrls } from '@enve-memory/api';
import { type DrainWorker, EnveMemory, MemoryError, type SyncResult, pathsFor, restoreBackup } from '@enve-memory/core';
import { type LocalEmbedder, attachLocalEmbedder, indexWorker } from '@enve-memory/embeddings';
import type { ApiStatus, SyncStatus } from '../shared/ipc.ts';

export interface LibraryOptions {
  home: string;
  version: string;
  port: number;
  lan: boolean;
  keys: KeyLookup;
  /** Something in the library changed: our own write, a worker, the API, or another process. */
  onChanged: () => void;
}

const POLL_MS = 1500;
const BACKUP_MS = 10 * 60_000;
const SYNC_MS = 2 * 60_000;
const DESKTOP_ACTOR = 'desktop';

/** The open library plus everything that runs beside it in the main process: API server, workers, backups, sync. */
export class Library {
  private readonly options: LibraryOptions;
  private current: EnveMemory | null = null;
  private api: ApiServer | null = null;
  private embedder: LocalEmbedder | null = null;
  private indexer: DrainWorker | null = null;
  private enricher: DrainWorker | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private seen = { version: -1, change: '' };
  private syncing = false;
  apiStatus: ApiStatus;
  lastSync: SyncStatus['last'] = null;
  aiError: string | null = null;

  constructor(options: LibraryOptions) {
    this.options = options;
    this.apiStatus = { running: false, url: null, port: options.port, lan: options.lan, lanUrls: [], error: null };
  }

  get memory(): EnveMemory {
    if (!this.current) throw new MemoryError('invalid', 'The library is closed while it restarts. Try again in a moment.');
    return this.current;
  }

  get embedderModel(): string | null {
    return this.embedder?.model ?? null;
  }

  get syncRunning(): boolean {
    return this.syncing;
  }

  async start(): Promise<void> {
    this.current = EnveMemory.open({ home: this.options.home, actor: DESKTOP_ACTOR });
    this.attachEmbedder();
    this.enricher = enrichWorker(this.current, () => this.provider(), this.options.onChanged);
    await this.startApi();
    this.markSeen();
    this.kick();
    this.backup();
    this.timers = [
      setInterval(() => this.poll(), POLL_MS),
      setInterval(() => this.backup(), BACKUP_MS),
      setInterval(() => void this.sync(), SYNC_MS),
    ];
    void this.sync();
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.stopApi();
    await this.indexer?.idle();
    await this.enricher?.idle();
    this.current?.close();
    this.current = null;
  }

  /** The configured AI provider, or null when AI is off or misconfigured (the reason lands in `aiError`). */
  provider(): AiProvider | null {
    try {
      const provider = providerFor(this.memory, this.options.keys);
      this.aiError = null;
      return provider;
    } catch (error) {
      this.aiError = (error as Error).message;
      return null;
    }
  }

  attachEmbedder(): void {
    this.embedder = attachLocalEmbedder(this.memory);
    this.indexer = this.embedder ? indexWorker(this.memory, this.embedder) : null;
  }

  kick(): void {
    this.api?.ingest.kick();
    this.indexer?.kick();
    this.enricher?.kick();
  }

  /** After a desktop write: process anything it queued and tell every window. */
  afterWrite(): void {
    this.kick();
    this.options.onChanged();
  }

  async setLan(lan: boolean): Promise<ApiStatus> {
    await this.stopApi();
    this.apiStatus = { ...this.apiStatus, lan };
    await this.startApi();
    return this.apiStatus;
  }

  /** Swaps in a snapshot from this library's backups folder. Everything is closed first and reopened after. */
  async restore(file: string): Promise<{ saved: string }> {
    const backup = this.memory.backups.list().find((b) => b.file === file);
    if (!backup) throw new MemoryError('not_found', `No snapshot named "${file}".`);
    await this.stop();
    try {
      return restoreBackup(pathsFor(this.options.home), backup.path);
    } finally {
      await this.start();
      this.options.onChanged();
    }
  }

  async sync(): Promise<void> {
    const memory = this.current;
    if (!memory || this.syncing || !memory.settings.get('syncFolder')) return;
    this.syncing = true;
    this.options.onChanged();
    let result: SyncResult | null = null;
    try {
      // Yield first so the "syncing" state reaches the UI before the synchronous run blocks the main process.
      await new Promise((resolve) => setTimeout(resolve, 0));
      result = memory.withActor(DESKTOP_ACTOR, () => memory.sync.run());
      this.lastSync = { at: new Date().toISOString(), result, error: null, code: null };
    } catch (error) {
      this.lastSync = { at: new Date().toISOString(), result: null, error: (error as Error).message, code: error instanceof MemoryError ? error.code : null };
    } finally {
      this.syncing = false;
    }
    if (result && result.imported > 0) this.kick();
    this.options.onChanged();
  }

  private async startApi(): Promise<void> {
    const { lan } = this.apiStatus;
    const api = createApiServer(this.memory, {
      version: this.options.version,
      port: this.options.port,
      lan,
      afterWrite: () => {
        this.indexer?.kick();
        this.enricher?.kick();
        this.options.onChanged();
      },
    });
    this.api = api;
    try {
      const url = await api.listen();
      const port = Number(new URL(url).port);
      this.apiStatus = { running: true, url, port, lan, lanUrls: lan ? lanUrls(port) : [], error: null };
    } catch (error) {
      const inUse = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
      this.apiStatus = {
        running: false, url: null, port: this.options.port, lan, lanUrls: [],
        error: inUse
          ? `Port ${this.options.port} is already in use, probably by another Enve Memory or \`enve-memory serve\`. Everything else works; the browser extension and phone can’t connect to this app until the port is free.`
          : (error as Error).message,
      };
    }
  }

  private async stopApi(): Promise<void> {
    const api = this.api;
    this.api = null;
    if (!api) return;
    if (this.apiStatus.running) await api.close();
    else await api.ingest.idle();
    this.apiStatus = { ...this.apiStatus, running: false, url: null, lanUrls: [] };
  }

  private backup(): void {
    try {
      this.current?.backups.runSchedule();
    } catch (error) {
      console.error('backup:', error);
    }
  }

  private markSeen(): void {
    const memory = this.memory;
    this.seen = { version: memory.dataVersion, change: memory.activity.recent({}, 1)[0]?.id ?? '' };
  }

  /** MCP servers and the CLI write straight to SQLite; data_version is how this connection notices. */
  private poll(): void {
    const memory = this.current;
    if (!memory) return;
    try {
      const version = memory.dataVersion;
      const change = memory.activity.recent({}, 1)[0]?.id ?? '';
      if (version === this.seen.version && change === this.seen.change) return;
      if (version !== this.seen.version) this.kick();
      this.seen = { version, change };
      this.options.onChanged();
    } catch (error) {
      console.error('poll:', error);
    }
  }
}
