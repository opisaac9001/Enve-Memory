import { type Context, newId, normalizeTag, oneOf, required } from './context.ts';
import { invalid, notFound } from './errors.ts';
import type { ItemService } from './items.ts';
import type { ProjectService } from './projects.ts';
import { ITEM_TYPES, type ItemDetail, type ItemType } from './types.ts';

export interface RuleConditions {
  /** Any of these types. */
  types?: ItemType[];
  /** Link host is one of these, or a subdomain of one. */
  domains?: string[];
  /** Title, note or archived text contains any of these words or phrases (case-insensitive). */
  keywords?: string[];
  /** Saved by a client whose actor starts with this, e.g. `mcp:` or `api:Chrome`. */
  source?: string;
}

export interface RuleActions {
  tags?: string[];
  /** Project id; only applied to items that aren't in a project yet. */
  project?: string;
}

export interface Rule {
  id: string;
  name: string;
  conditions: RuleConditions;
  actions: RuleActions;
  enabled: boolean;
  createdAt: string;
}

interface RuleRow {
  id: string;
  name: string;
  conditions: string;
  actions: string;
  enabled: number;
  created_at: string;
}

const toRule = (row: RuleRow): Rule => ({
  id: row.id,
  name: row.name,
  conditions: JSON.parse(row.conditions) as RuleConditions,
  actions: JSON.parse(row.actions) as RuleActions,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
});

export interface CreateRuleInput {
  name: string;
  conditions: RuleConditions;
  /** `project` may be a name, slug or id; it's stored as the id. */
  actions: RuleActions;
}

/** "When a link from github.com is saved, tag it #code and file it in Development." Applied by core, so every client gets it. */
export class RuleService {
  private readonly ctx: Context;
  private readonly items: ItemService;
  private readonly projects: ProjectService;

  constructor(ctx: Context, items: ItemService, projects: ProjectService) {
    this.ctx = ctx;
    this.items = items;
    this.projects = projects;
  }

  create(input: CreateRuleInput): Rule {
    const name = required(input.name, 'Rule name');
    const conditions = normalizeConditions(input.conditions);
    const actions: RuleActions = {};
    if (input.actions.tags?.length) actions.tags = [...new Set(input.actions.tags.map(normalizeTag))];
    if (input.actions.project) actions.project = this.projects.resolve(input.actions.project).id;
    if (!actions.tags && !actions.project) throw invalid('A rule needs at least one action: tags or a project.');
    const id = newId();
    this.ctx.run(
      `INSERT INTO rules (id, name, conditions, actions, created_at) VALUES (?, ?, ?, ?, ?)`,
      id, name, JSON.stringify(conditions), JSON.stringify(actions), this.ctx.now(),
    );
    return this.get(id);
  }

  list(): Rule[] {
    return this.ctx.all<RuleRow>(`SELECT * FROM rules ORDER BY created_at`).map(toRule);
  }

  get(id: string): Rule {
    const row = this.ctx.get<RuleRow>(`SELECT * FROM rules WHERE id = ?`, id);
    if (!row) throw notFound(`No rule with id "${id}".`);
    return toRule(row);
  }

  setEnabled(id: string, enabled: boolean): Rule {
    this.get(id);
    this.ctx.run(`UPDATE rules SET enabled = ? WHERE id = ?`, enabled ? 1 : 0, id);
    return this.get(id);
  }

  delete(id: string): void {
    this.get(id);
    this.ctx.run(`DELETE FROM rules WHERE id = ?`, id);
  }

  /** Runs every enabled rule against an item. Idempotent: tags are added once and a filed item is never moved. */
  apply(itemId: string): string[] {
    const rules = this.list().filter((r) => r.enabled);
    if (rules.length === 0) return [];
    const item = this.items.get(itemId);
    const matched = rules.filter((rule) => matches(rule.conditions, item));
    let filed = item.project !== null;
    for (const rule of matched) {
      const previous = this.ctx.actor;
      this.ctx.actor = `rule:${rule.name}`;
      try {
        const missing = (rule.actions.tags ?? []).filter((t) => !item.tags.includes(t));
        if (missing.length) this.items.tag(item.id, { add: missing });
        if (!filed && rule.actions.project && this.ctx.get(`SELECT 1 FROM projects WHERE id = ?`, rule.actions.project)) {
          this.items.update(item.id, { project: rule.actions.project });
          filed = true;
        }
      } finally {
        this.ctx.actor = previous;
      }
    }
    return matched.map((r) => r.id);
  }
}

function normalizeConditions(conditions: RuleConditions): RuleConditions {
  const out: RuleConditions = {};
  if (conditions.types?.length) out.types = conditions.types.map((t) => oneOf(t, ITEM_TYPES, 'item type'));
  if (conditions.domains?.length) {
    out.domains = conditions.domains.map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean);
  }
  if (conditions.keywords?.length) out.keywords = conditions.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (conditions.source?.trim()) out.source = conditions.source.trim();
  if (Object.keys(out).length === 0) throw invalid('A rule needs at least one condition: types, domains, keywords or source.');
  return out;
}

function matches(conditions: RuleConditions, item: ItemDetail): boolean {
  if (conditions.types && !conditions.types.includes(item.type)) return false;
  if (conditions.domains) {
    if (!item.url) return false;
    const host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, '');
    if (!conditions.domains.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  }
  if (conditions.keywords) {
    const text = `${item.title}\n${item.body}\n${item.content}`.toLowerCase();
    if (!conditions.keywords.some((k) => text.includes(k))) return false;
  }
  if (conditions.source && !item.source.startsWith(conditions.source)) return false;
  return true;
}
