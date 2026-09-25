import { type Context, required } from './context.ts';
import { invalid } from './errors.ts';
import type { ItemService } from './items.ts';
import type { ProjectService } from './projects.ts';
import type { Decision } from './types.ts';

export interface RecordDecisionInput {
  project: string;
  decision: string;
  reason?: string;
  supersedes?: string[];
}

interface DecisionRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
  source: string;
  supersedes: string | null;
  superseded_by: string | null;
}

/** An append-only decision log per project. Decisions are items, so they are searchable like everything else. */
export class DecisionService {
  private readonly ctx: Context;
  private readonly items: ItemService;
  private readonly projects: ProjectService;

  constructor(ctx: Context, items: ItemService, projects: ProjectService) {
    this.ctx = ctx;
    this.items = items;
    this.projects = projects;
  }

  record(input: RecordDecisionInput): Decision {
    const project = this.projects.resolve(input.project);
    const decision = required(input.decision, 'Decision');
    const superseded = (input.supersedes ?? []).map((id) => {
      const row = this.items.row(id);
      if (row.type !== 'decision' || row.project_id !== project.id) {
        throw invalid(`Item "${id}" is not a decision in ${project.name}.`);
      }
      return row.id;
    });
    const id = this.ctx.tx(() => {
      const id = this.items.insert({ type: 'decision', title: decision, body: input.reason, project: project.id });
      for (const old of superseded) this.items.link(id, old, 'supersedes', project.id);
      return id;
    });
    return this.list(project.id).find((d) => d.id === id)!;
  }

  /** Oldest first, so the log reads as history. */
  list(projectRef: string, limit = 200): Decision[] {
    const project = this.projects.resolve(projectRef);
    return this.ctx
      .all<DecisionRow>(
        `SELECT * FROM (
           SELECT i.seq, i.id, i.title, i.body, i.created_at, i.source,
             (SELECT json_group_array(r.to_id) FROM relations r WHERE r.from_id = i.id AND r.kind = 'supersedes') AS supersedes,
             (SELECT r.from_id FROM relations r WHERE r.to_id = i.id AND r.kind = 'supersedes' LIMIT 1) AS superseded_by
           FROM items i
           WHERE i.type = 'decision' AND i.project_id = ?
           ORDER BY i.seq DESC LIMIT ?
         ) ORDER BY seq`,
        project.id, limit,
      )
      .map((row) => ({
        id: row.id,
        decision: row.title,
        reason: row.body,
        createdAt: row.created_at,
        source: row.source,
        supersedes: row.supersedes ? (JSON.parse(row.supersedes) as string[]) : [],
        supersededBy: row.superseded_by,
      }));
  }
}
