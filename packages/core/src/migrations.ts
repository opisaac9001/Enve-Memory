export interface Migration {
  name: string;
  sql: string;
}

// Append only. A migration's position is its schema version; never edit or reorder a shipped entry.
export const MIGRATIONS: readonly Migration[] = [
  {
    name: 'initial',
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        memory TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      -- seq is the rowid alias items_fts is keyed on; an implicit rowid can be renumbered by VACUUM.
      CREATE TABLE items (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        url TEXT,
        project_id TEXT REFERENCES projects(id),
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      ) STRICT;
      CREATE INDEX items_project ON items(project_id, updated_at);
      CREATE INDEX items_type ON items(type, updated_at);
      CREATE INDEX items_url ON items(url) WHERE url IS NOT NULL;

      CREATE TABLE tasks (
        item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'open',
        priority INTEGER NOT NULL DEFAULT 2,
        due_at TEXT,
        completed_at TEXT
      ) STRICT;
      CREATE INDEX tasks_status ON tasks(status, due_at);

      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE item_tags (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (item_id, tag_id)
      ) STRICT;
      CREATE INDEX item_tags_tag ON item_tags(tag_id);

      CREATE TABLE relations (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (from_id, to_id, kind)
      ) STRICT;
      CREATE INDEX relations_to ON relations(to_id);

      CREATE TABLE changes (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        op TEXT NOT NULL,
        project_id TEXT,
        data TEXT CHECK (data IS NULL OR json_valid(data)),
        at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX changes_entity ON changes(entity, entity_id);
      CREATE INDEX changes_project ON changes(project_id, seq);

      CREATE VIRTUAL TABLE items_fts USING fts5(
        title, body, url,
        content = 'items',
        content_rowid = 'seq',
        tokenize = 'porter unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, title, body, url) VALUES (new.seq, new.title, new.body, new.url);
      END;
      CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, body, url) VALUES ('delete', old.seq, old.title, old.body, old.url);
      END;
      CREATE TRIGGER items_fts_update AFTER UPDATE OF title, body, url ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, body, url) VALUES ('delete', old.seq, old.title, old.body, old.url);
        INSERT INTO items_fts(rowid, title, body, url) VALUES (new.seq, new.title, new.body, new.url);
      END;
    `,
  },
  {
    name: 'api_clients',
    sql: `
      -- Local HTTP/MCP clients. Only a SHA-256 of each token is stored. Not user content, so not in the change log.
      CREATE TABLE api_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL,
        scopes TEXT NOT NULL CHECK (json_valid(scopes)),
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      ) STRICT;
    `,
  },
  {
    name: 'content_and_attachments',
    sql: `
      -- content is text extracted from the source (web article, PDF, text file): untrusted, kept apart from the user's own body.
      ALTER TABLE items ADD COLUMN content TEXT NOT NULL DEFAULT '';
      ALTER TABLE items ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata));
      CREATE INDEX items_ingest ON items(json_extract(metadata, '$.ingest.status')) WHERE json_extract(metadata, '$.ingest.status') = 'pending';

      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        sha256 TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX attachments_item ON attachments(item_id);
      CREATE INDEX attachments_sha ON attachments(sha256);

      DROP TRIGGER items_fts_insert;
      DROP TRIGGER items_fts_delete;
      DROP TRIGGER items_fts_update;
      DROP TABLE items_fts;
      CREATE VIRTUAL TABLE items_fts USING fts5(
        title, body, url, content,
        content = 'items',
        content_rowid = 'seq',
        tokenize = 'porter unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, title, body, url, content) VALUES (new.seq, new.title, new.body, new.url, new.content);
      END;
      CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, body, url, content) VALUES ('delete', old.seq, old.title, old.body, old.url, old.content);
      END;
      CREATE TRIGGER items_fts_update AFTER UPDATE OF title, body, url, content ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, body, url, content) VALUES ('delete', old.seq, old.title, old.body, old.url, old.content);
        INSERT INTO items_fts(rowid, title, body, url, content) VALUES (new.seq, new.title, new.body, new.url, new.content);
      END;
      INSERT INTO items_fts(items_fts) VALUES ('rebuild');
    `,
  },
];
