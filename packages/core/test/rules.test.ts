import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnveMemory, MemoryError } from '@enve-memory/core';

const open = () => {
  const memory = EnveMemory.open({ inMemory: true, actor: 'test' });
  memory.settings.set('fetchLinks', false);
  return memory;
};

test('rules tag and file matching items as they are saved, from any client', () => {
  const memory = open();
  memory.projects.create({ name: 'Development' });
  const rule = memory.rules.create({
    name: 'GitHub links',
    conditions: { types: ['bookmark'], domains: ['https://www.github.com/'] },
    actions: { tags: ['#Code'], project: 'development' },
  });
  assert.deepEqual(rule.conditions.domains, ['github.com']);
  assert.deepEqual(rule.actions.tags, ['code']);

  memory.actor = 'mcp:claude-code';
  const repo = memory.items.saveLink({ url: 'https://gist.github.com/someone/abc' }).item;
  const detail = memory.items.get(repo.id);
  assert.deepEqual(detail.tags, ['code']);
  assert.equal(detail.project?.name, 'Development');
  assert.ok(memory.activity.recent({ entityId: repo.id }).some((c) => c.actor === 'rule:GitHub links'));

  const other = memory.items.saveLink({ url: 'https://example.com' }).item;
  assert.deepEqual(memory.items.get(other.id).tags, []);
});

test('keyword rules re-run once a page is archived, and never move a filed item', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage' });
  memory.projects.create({ name: 'Elsewhere' });
  memory.rules.create({ name: 'Garage stuff', conditions: { keywords: ['rolling code'] }, actions: { tags: ['garage'], project: 'garage' } });

  const link = memory.items.saveLink({ url: 'https://example.com/article' }).item;
  assert.deepEqual(memory.items.get(link.id).tags, []);
  memory.items.setSource(link.id, { title: 'Openers', content: 'How the Rolling Code works', metadata: {} });
  assert.deepEqual(memory.items.get(link.id).tags, ['garage']);
  assert.equal(memory.items.get(link.id).project?.name, 'Garage');

  const filed = memory.items.saveNote({ body: 'rolling code notes', project: 'elsewhere' });
  assert.equal(memory.items.get(filed.id).project?.name, 'Elsewhere');
  assert.deepEqual(memory.items.get(filed.id).tags, ['garage']);
});

test('source rules target a client; disabled rules do nothing; bad rules are refused', () => {
  const memory = open();
  const rule = memory.rules.create({ name: 'From agents', conditions: { source: 'mcp:' }, actions: { tags: ['from-ai'] } });
  memory.actor = 'mcp:codex';
  assert.deepEqual(memory.items.saveNote({ body: 'agent note' }).tags, ['from-ai']);
  memory.actor = 'cli';
  assert.deepEqual(memory.items.saveNote({ body: 'my note' }).tags, []);

  memory.rules.setEnabled(rule.id, false);
  memory.actor = 'mcp:codex';
  assert.deepEqual(memory.items.saveNote({ body: 'another agent note' }).tags, []);
  memory.rules.delete(rule.id);
  assert.deepEqual(memory.rules.list(), []);

  assert.throws(() => memory.rules.create({ name: 'x', conditions: {}, actions: { tags: ['a'] } }), MemoryError);
  assert.throws(() => memory.rules.create({ name: 'x', conditions: { keywords: ['a'] }, actions: {} }), /at least one action/);
  assert.throws(() => memory.rules.create({ name: 'x', conditions: { types: ['video' as 'note'] }, actions: { tags: ['a'] } }), /Unknown item type/);
});

test('the graph links items to projects, tags and each other', () => {
  const memory = open();
  memory.projects.create({ name: 'Garage' });
  const spec = memory.items.saveLink({ url: 'https://example.com/spec', title: 'Spec', project: 'garage', tags: ['protocol'] }).item;
  const note = memory.items.saveNote({ body: 'Summary of the spec', tags: ['protocol'] });
  memory.items.relate(note.id, spec.id, 'derived_from');

  const graph = memory.graph();
  const kinds = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  assert.equal(kinds.get(spec.id), 'item');
  assert.equal(kinds.get('tag:protocol'), 'tag');
  assert.equal([...kinds.values()].filter((k) => k === 'project').length, 1);
  const edge = (from: string, to: string) => graph.edges.find((e) => e.from === from && e.to === to)?.kind;
  assert.equal(edge(note.id, spec.id), 'derived_from');
  assert.equal(edge(spec.id, 'tag:protocol'), 'tagged');
  assert.equal(edge(spec.id, memory.projects.resolve('garage').id), 'in_project');
  assert.equal(memory.graph({ project: 'garage' }).nodes.filter((n) => n.kind === 'item').length, 1);
});
