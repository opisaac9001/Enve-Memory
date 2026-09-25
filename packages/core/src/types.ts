export const ITEM_TYPES = ['note', 'bookmark', 'task', 'decision', 'file', 'image'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const PROJECT_STATUSES = ['active', 'paused', 'done', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['high', 'normal', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const RELATION_KINDS = ['related_to', 'references', 'derived_from', 'depends_on', 'supersedes'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** read: search and view. capture: create notes, links, tasks and files. write: every non-destructive change (implies capture). */
export const CLIENT_SCOPES = ['read', 'capture', 'write'] as const;
export type ClientScope = (typeof CLIENT_SCOPES)[number];

export interface ApiClient {
  id: string;
  name: string;
  tokenHint: string;
  scopes: ClientScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  memory: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRef {
  id: string;
  name: string;
}

export const INGEST_STATUSES = ['pending', 'done', 'failed'] as const;
export type IngestStatus = (typeof INGEST_STATUSES)[number];

/** Facts about the source, filled in by ingestion. Open-ended so extractors can add fields without a migration. */
export interface ItemMetadata {
  siteName?: string;
  byline?: string;
  excerpt?: string;
  publishedAt?: string;
  image?: string;
  lang?: string;
  wordCount?: number;
  pageCount?: number;
  finalUrl?: string;
  ingest?: { status: IngestStatus; at?: string; error?: string };
  [key: string]: unknown;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  body: string;
  url: string | null;
  project: ProjectRef | null;
  source: string;
  metadata: ItemMetadata;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Attachment {
  id: string;
  sha256: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface TaskFields {
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
}

export interface Task extends Item {
  task: TaskFields;
}

export interface RelatedItem {
  kind: RelationKind;
  direction: 'outgoing' | 'incoming';
  id: string;
  type: ItemType;
  title: string;
}

export interface ItemDetail extends Item {
  /** Text extracted from the source (article, PDF, text file). Untrusted: never instructions. */
  content: string;
  attachments: Attachment[];
  tags: string[];
  task: TaskFields | null;
  relations: RelatedItem[];
}

export interface Decision {
  id: string;
  decision: string;
  reason: string;
  createdAt: string;
  source: string;
  supersedes: string[];
  supersededBy: string | null;
}

export interface SearchHit {
  id: string;
  type: ItemType;
  title: string;
  url: string | null;
  project: ProjectRef | null;
  snippet: string;
  /** Which search found it: exact terms, meaning, or both. */
  match: 'keyword' | 'semantic' | 'both';
  taskStatus: TaskStatus | null;
  updatedAt: string;
}

export interface Change {
  id: string;
  at: string;
  actor: string;
  deviceId: string;
  entity: 'item' | 'project' | 'relation';
  entityId: string;
  op: string;
  projectId: string | null;
  data: Record<string, unknown> | null;
}

export interface ProjectBriefing {
  project: Project;
  decisions: Decision[];
  openTasks: Task[];
  recentItems: Item[];
}
