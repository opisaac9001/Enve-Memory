import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

export function writeBlob(ctx: Context, sha256: string, data: Uint8Array): void {
  const path = blobPath(ctx, sha256);
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

export function removeBlobIfUnused(ctx: Context, sha256: string): void {
  if (!ctx.attachmentsDir) return;
  if (ctx.get(`SELECT 1 FROM attachments WHERE sha256 = ? LIMIT 1`, sha256)) return;
  rmSync(blobPath(ctx, sha256), { force: true });
}
