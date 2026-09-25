import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Context } from './context.ts';
import { MemoryError } from './errors.ts';
import type { Attachment } from './types.ts';

export interface AttachmentRow {
  id: string;
  item_id: string;
  sha256: string;
  filename: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export const toAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  sha256: row.sha256,
  filename: row.filename,
  mimeType: row.mime_type,
  size: row.size,
  createdAt: row.created_at,
});

/** Content-addressed: attachments/ab/abcdef…, so identical files are stored once. */
export function blobPath(ctx: Context, sha256: string): string {
  if (!ctx.attachmentsDir) throw new MemoryError('invalid', 'Files need an on-disk library.');
  return join(ctx.attachmentsDir, sha256.slice(0, 2), sha256);
}

/** Unreferenced blobs wait here for the life of the daily backups, so restoring a recent snapshot finds its files. */
export const TRASH_DIR = '.trash';
export const TRASH_DAYS = 30;

export function writeBlob(ctx: Context, sha256: string, data: Uint8Array): void {
  const path = blobPath(ctx, sha256);
  if (existsSync(path)) return;
  const trashed = join(ctx.attachmentsDir!, TRASH_DIR, sha256);
  if (existsSync(trashed)) {
    mkdirSync(dirname(path), { recursive: true });
    renameSync(trashed, path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

export function removeBlobIfUnused(ctx: Context, sha256: string): void {
  if (!ctx.attachmentsDir) return;
  if (ctx.get(`SELECT 1 FROM attachments WHERE sha256 = ? LIMIT 1`, sha256)) return;
  const path = blobPath(ctx, sha256);
  if (!existsSync(path)) return;
  const trash = join(ctx.attachmentsDir, TRASH_DIR);
  mkdirSync(trash, { recursive: true });
  renameSync(path, join(trash, sha256));
  const now = new Date();
  utimesSync(join(trash, sha256), now, now);
}

/** Brings back trashed blobs a restored database refers to, and empties trash older than TRASH_DAYS. */
export function reconcileBlobs(attachmentsDir: string, referenced: Set<string>, now = Date.now()): { restored: number; purged: number } {
  const trash = join(attachmentsDir, TRASH_DIR);
  if (!existsSync(trash)) return { restored: 0, purged: 0 };
  let restored = 0;
  let purged = 0;
  for (const name of readdirSync(trash)) {
    const path = join(trash, name);
    if (referenced.has(name)) {
      const target = join(attachmentsDir, name.slice(0, 2), name);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(path, target);
      restored++;
    } else if (now - statSync(path).mtimeMs > TRASH_DAYS * 86_400_000) {
      rmSync(path, { force: true });
      purged++;
    }
  }
  return { restored, purged };
}
