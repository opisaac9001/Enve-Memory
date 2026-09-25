import type { Answer } from '@enve-memory/ai';
import type {
  ApiClient, Backup, Change, ClientScope, CreateProjectInput, CreateRuleInput, CreateTaskInput, Decision, ExportSummary, Graph, Item,
  ItemDetail, ItemFilter, ItemType, Project, ProjectBriefing, RecordDecisionInput, Rule, SaveLinkInput, SaveNoteInput, SearchHit,
  Settings, SyncResult, Task, UpdateItemInput, UpdateProjectInput, UpdateTaskInput,
} from '@enve-memory/core';
import type { ImportResult } from '@enve-memory/importers';

export type ThemeMode = 'system' | 'dark' | 'light';

export type LibraryStats = { projects: number; tags: number; tagNames: string[] } & Record<ItemType, number>;

export interface AppInfo {
  version: string;
  home: string;
  database: string;
  platform: string;
  isPackaged: boolean;
  schemaVersion: number;
  deviceId: string;
  stats: LibraryStats;
  inboxCount: number;
  aiEnabled: boolean;
  /** Any MCP or API client has used the library, or a token exists. */
  aiClientsSeen: boolean;
}

export interface Prefs {
  theme: ThemeMode;
  lan: boolean;
  shortcut: string;
  shortcutRegistered: boolean;
}

export interface ListedItem extends Item {
  tags: string[];
}

export interface ProjectSummary extends Project {
  openTasks: number;
}

export interface MemoryVersion {
  id: string;
  at: string;
  actor: string;
  memory: string;
}

export interface ApiStatus {
  running: boolean;
  url: string | null;
  port: number;
  lan: boolean;
  lanUrls: string[];
  error: string | null;
}

export interface IndexStatus {
  enabled: boolean;
  model: string | null;
  indexed: number;
  pending: number;
  chunks: number;
}

export interface ProviderOption {
  id: string;
  label: string;
  baseUrl: string;
  needsKey: boolean;
  defaultModel: string | null;
  /** Sends item text to a third party's servers. */
  cloud: boolean;
}

export interface AiStatus {
  provider: string;
  model: string;
  baseUrl: string;
  enrich: boolean;
  enrichSince: string;
  providers: ProviderOption[];
  /** Providers with a key saved in the encrypted store. */
  keys: string[];
  encryptionAvailable: boolean;
  error: string | null;
}

export interface AiConfig {
  provider: string;
  model: string;
  baseUrl: string;
  /** A key typed but not saved yet; falls back to the stored one. */
  apiKey?: string;
}

export interface McpSetup {
  command: string;
  args: string[];
  env: Record<string, string>;
  claudeCode: string;
  codex: string;
  json: string;
  httpUrl: string;
  claudeAvailable: boolean;
}

export interface PairLink {
  url: string;
  link: string;
  qr: string;
}

export interface PairResult {
  client: ApiClient;
  token: string;
  links: PairLink[];
}

export interface SyncStatus {
  folder: string;
  encrypted: boolean;
  running: boolean;
  /** The folder is encrypted and this library has no key yet. */
  needsPassphrase: boolean;
  last: { at: string; result: SyncResult | null; error: string | null } | null;
}

export const IMPORT_KINDS = ['bookmarks', 'markdown', 'csv', 'enve'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface ItemPage {
  items: ListedItem[];
  /** Cursor for the next page, or null when this was the last one. */
  next: string | null;
}

export interface TaskQuery {
  project?: string;
  status?: string;
  tag?: string;
}

/**
 * Every call the renderer can make. Main implements exactly these keys (the handler map is typed against this),
 * and nothing else reaches core.
 */
export interface Api {
  'app.info': () => AppInfo;
  'app.openLibraryFolder': () => void;
  'app.openExternal': (url: string) => void;
  'prefs.get': () => Prefs;
  'prefs.setTheme': (theme: ThemeMode) => Prefs;

  'items.list': (filter?: ItemFilter, limit?: number) => ListedItem[];
  'items.page': (filter: ItemFilter, cursor: string | null, limit: number) => ItemPage;
  'items.inbox': () => ListedItem[];
  'items.get': (id: string) => ItemDetail;
  'items.saveNote': (input: SaveNoteInput) => ItemDetail;
  'items.saveLink': (input: SaveLinkInput) => { item: ItemDetail; created: boolean };
  'items.update': (id: string, input: UpdateItemInput) => ItemDetail;
  'items.tag': (id: string, change: { add?: string[]; remove?: string[] }) => ItemDetail;
  'items.archive': (id: string) => ItemDetail;
  'items.unarchive': (id: string) => ItemDetail;
  'items.delete': (id: string) => void;
  'items.acceptSuggestions': (id: string) => ItemDetail;
  'items.enrich': (id: string) => ItemDetail;
  'items.retryIngest': (id: string) => ItemDetail;
  'items.retryFailed': () => number;
  'items.openFile': (id: string) => void;
  'files.save': (paths: string[], project?: string) => ItemDetail[];

  'projects.list': (status?: string) => ProjectSummary[];
  'projects.create': (input: CreateProjectInput) => Project;
  'projects.update': (ref: string, input: UpdateProjectInput) => Project;
  'projects.setMemory': (ref: string, memory: string) => Project;
  'projects.briefing': (ref: string) => ProjectBriefing;
  'projects.memoryHistory': (ref: string) => MemoryVersion[];
  'decisions.record': (input: RecordDecisionInput) => Decision;

  'tasks.list': (query?: TaskQuery, limit?: number) => Task[];
  'tasks.create': (input: CreateTaskInput) => Task;
  'tasks.update': (id: string, input: UpdateTaskInput) => Task;

  'search.hybrid': (text: string, filter?: ItemFilter, limit?: number) => SearchHit[];
  'graph.get': (project?: string) => Graph;
  'activity.recent': (query?: { project?: string; entityId?: string }, limit?: number) => Change[];

  'settings.get': () => Settings;
  'settings.set': (key: 'fetchLinks' | 'semanticSearch', value: boolean) => Settings;
  'index.status': () => IndexStatus;

  'ai.status': () => AiStatus;
  'ai.configure': (config: { provider: string; model: string; baseUrl: string }) => AiStatus;
  'ai.setKey': (provider: string, key: string | null) => AiStatus;
  'ai.models': (config: AiConfig) => string[];
  'ai.test': (config: AiConfig) => string;
  'ai.setEnrich': (on: boolean) => AiStatus;
  'ai.ask': (question: string, project?: string) => Answer;

  'clients.list': () => ApiClient[];
  'clients.create': (name: string, scopes: ClientScope[]) => { client: ApiClient; token: string };
  'clients.pair': (name: string) => PairResult;
  'clients.revoke': (id: string) => ApiClient;
  'api.status': () => ApiStatus;
  'api.setLan': (lan: boolean) => ApiStatus;
  'mcp.setup': () => McpSetup;
  'mcp.addToClaudeCode': () => { ok: boolean; output: string };

  'backups.list': () => Backup[];
  'backups.create': () => Backup;
  'backups.restore': (file: string) => { saved: string };
  'exports.run': () => ExportSummary | null;

  'rules.list': () => Rule[];
  'rules.create': (input: CreateRuleInput) => Rule;
  'rules.setEnabled': (id: string, enabled: boolean) => Rule;
  'rules.delete': (id: string) => void;
  'imports.run': (kind: ImportKind, project?: string) => ImportResult | null;

  'sync.status': () => SyncStatus;
  'sync.pickFolder': () => string | null;
  'sync.start': (folder: string, passphrase: string | null) => SyncStatus;
  'sync.unlock': (passphrase: string) => SyncStatus;
  'sync.now': () => SyncStatus;
  'sync.stop': () => SyncStatus;

  'capture.open': () => void;
  'capture.close': () => void;
}

export type Method = keyof Api;
/**
 * The runtime allow-list: every method and whether it changes the library (after a write, main kicks the background
 * workers and tells every window to refresh). Typed as a full Record so adding a method to `Api` without listing it
 * here fails to compile.
 */
export const METHOD_KINDS: Record<Method, 'read' | 'write'> = {
  'app.info': 'read',
  'app.openLibraryFolder': 'read',
  'app.openExternal': 'read',
  'prefs.get': 'read',
  'prefs.setTheme': 'read',
  'items.list': 'read',
  'items.page': 'read',
  'items.inbox': 'read',
  'items.get': 'read',
  'items.saveNote': 'write',
  'items.saveLink': 'write',
  'items.update': 'write',
  'items.tag': 'write',
  'items.archive': 'write',
  'items.unarchive': 'write',
  'items.delete': 'write',
  'items.acceptSuggestions': 'write',
  'items.enrich': 'write',
  'items.retryIngest': 'write',
  'items.retryFailed': 'write',
  'items.openFile': 'read',
  'files.save': 'write',
  'projects.list': 'read',
  'projects.create': 'write',
  'projects.update': 'write',
  'projects.setMemory': 'write',
  'projects.briefing': 'read',
  'projects.memoryHistory': 'read',
  'decisions.record': 'write',
  'tasks.list': 'read',
  'tasks.create': 'write',
  'tasks.update': 'write',
  'search.hybrid': 'read',
  'graph.get': 'read',
  'activity.recent': 'read',
  'settings.get': 'read',
  'settings.set': 'write',
  'index.status': 'read',
  'ai.status': 'read',
  'ai.configure': 'write',
  'ai.setKey': 'write',
  'ai.models': 'read',
  'ai.test': 'read',
  'ai.setEnrich': 'write',
  'ai.ask': 'read',
  'clients.list': 'read',
  'clients.create': 'write',
  'clients.pair': 'write',
  'clients.revoke': 'write',
  'api.status': 'read',
  'api.setLan': 'read',
  'mcp.setup': 'read',
  'mcp.addToClaudeCode': 'read',
  'backups.list': 'read',
  'backups.create': 'read',
  'backups.restore': 'read',
  'exports.run': 'read',
  'rules.list': 'read',
  'rules.create': 'write',
  'rules.setEnabled': 'write',
  'rules.delete': 'write',
  'imports.run': 'write',
  'sync.status': 'read',
  'sync.pickFolder': 'read',
  'sync.start': 'write',
  'sync.unlock': 'write',
  'sync.now': 'write',
  'sync.stop': 'write',
  'capture.open': 'read',
  'capture.close': 'read',
};

export const isMethod = (value: unknown): value is Method => typeof value === 'string' && Object.hasOwn(METHOD_KINDS, value);

export type Args<M extends Method> = Parameters<Api[M]>;
export type Result<M extends Method> = Awaited<ReturnType<Api[M]>>;

export interface CallError {
  code: string;
  message: string;
}

export type Envelope<T = unknown> = { ok: true; value: T } | { ok: false; error: CallError };

/** Events main pushes to renderers. `command` carries a menu/shortcut action such as `search` or `new-note`. */
export const EVENTS = ['changed', 'command'] as const;
export type EventName = (typeof EVENTS)[number];

export const COMMANDS = ['search', 'new-note', 'save-link', 'settings', 'import'] as const;
export type Command = (typeof COMMANDS)[number];

/** What preload exposes as `window.enve`. */
export interface Bridge {
  call(method: string, ...args: unknown[]): Promise<Envelope>;
  on(event: EventName, listener: (...payload: unknown[]) => void): () => void;
  pathForFile(file: File): string;
  platform: string;
}
