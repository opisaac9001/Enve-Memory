import type { Context } from './context.ts';
import { clampLimit } from './items.ts';
import type { ProjectService } from './projects.ts';
import type { Change } from './types.ts';

interface ChangeRow {
  id: string;
  at: string;
  actor: string;
  device_id: string;
  entity: Change['entity'];
  entity_id: string;
  op: string;
  project_id: string | null;
  data: string | null;
}

export class ActivityService {
  private readonly ctx: Context;
  private readonly projects: ProjectService;

  constructor(ctx: Context, projects: ProjectService) {
    this.ctx = ctx;
    this.projects = projects;
  }

  /** Newest first. */
  recent({ project, entityId }: { project?: string; entityId?: string } = {}, limit?: number): Change[] {
    const where: string[] = [];
    const params: string[] = [];
    if (project !== undefined) {
      where.push('project_id = ?');
      params.push(this.projects.resolve(project).id);
    }
    if (entityId !== undefined) {
      where.push('entity_id = ?');
      params.push(entityId);
    }
    return this.ctx
      .all<ChangeRow>(
        `SELECT * FROM changes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`,
        ...params, clampLimit(limit),
      )
      .map((row) => ({
        id: row.id,
        at: row.at,
        actor: row.actor,
        deviceId: row.device_id,
        entity: row.entity,
        entityId: row.entity_id,
        op: row.op,
        projectId: row.project_id,
        data: row.data === null ? null : (JSON.parse(row.data) as Record<string, unknown>),
      }));
  }
}
