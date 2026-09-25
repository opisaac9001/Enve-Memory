import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { AiError, PROVIDERS, type ProviderId, ask, createProvider, enrichItem, isProviderId } from '@enve-memory/ai';
import { lanUrls, pairingLink } from '@enve-memory/api';
import { type Item, MemoryError, pageCursor } from '@enve-memory/core';
import { importBookmarks, importCsv, importEnveExport, importMarkdownFolder } from '@enve-memory/importers';
import { ingestItem } from '@enve-memory/ingestion';
import { type BrowserWindow, dialog, shell } from 'electron';
import QRCode from 'qrcode';
import { type AiConfig, type AiStatus, type AppInfo, IMPORT_KINDS, type ImportKind, type ListedItem, type Prefs, type SyncStatus, type ThemeMode } from '../shared/ipc.ts';
import { DesktopError, type Handlers } from './dispatch.ts';
import type { Library } from './library.ts';
import { type LaunchContext, claudeAddArgs, findExecutable, mcpLaunch, setupSnippets } from './mcp.ts';
import type { PrefsFile } from './prefs.ts';
import type { SecretStore } from './secrets.ts';

export interface HandlerContext {
  library: Library;
  secrets: SecretStore;
  prefs: PrefsFile;
  version: string;
  isPackaged: boolean;
  launch: LaunchContext;
  shortcutRegistered: () => boolean;
  applyTheme: (theme: ThemeMode) => void;
  parentWindow: () => BrowserWindow | undefined;
  openCapture: () => void;
  closeCapture: () => void;
}

const CLOUD_PROVIDERS = new Set(['openai', 'anthropic', 'gemini', 'openrouter']);
const NON_TASK = (type: string) => type !== 'task' && type !== 'decision';

const str = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new DesktopError('invalid', `${name} must be text.`);
  return value;
};

export function createHandlers(ctx: HandlerContext): Handlers {
  const { library, secrets, prefs } = ctx;
  const memory = () => library.memory;

  // Lists don't carry tags; gather them per tag (most-used first) rather than loading every item's full text.
  const withTags = (items: Item[]): ListedItem[] => {
    const tags = new Map(items.map((item) => [item.id, [] as string[]]));
    if (items.length) {
      for (const tag of memory().stats().tagNames.slice(0, 200)) {
        for (const tagged of memory().items.list({ tag, includeArchived: true }, 200)) tags.get(tagged.id)?.push(tag);
      }
    }
    return items.map((item) => ({ ...item, tags: tags.get(item.id)!.sort() }));
  };

  const inbox = () => memory().items.list({ inbox: true }, 200).filter((item) => NON_TASK(item.type));

  const providerId = (value: string): ProviderId => {
    if (!isProviderId(value)) throw new DesktopError('invalid', `Unknown AI provider "${value}".`);
    return value;
  };

  const adHocProvider = (config: AiConfig) => {
    const id = providerId(config.provider);
    if (id === 'none') throw new AiError('Choose a provider first.');
    return createProvider({
      provider: id,
      model: config.model || PROVIDERS[id].defaultModel || 'default',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey || secrets.get(id),
    });
  };

  const requireProvider = () => {
    const provider = library.provider();
    if (!provider) throw new AiError(library.aiError ?? 'Set up an AI provider in Settings → AI first.');
    return provider;
  };

  const aiStatus = (): AiStatus => {
    const settings = memory().settings.all();
    if (settings.aiProvider !== 'none') library.provider();
    return {
      provider: settings.aiProvider,
      model: settings.aiModel,
      baseUrl: settings.aiBaseUrl,
      enrich: settings.aiEnrich,
      enrichSince: settings.aiEnrichSince,
      providers: Object.entries(PROVIDERS).map(([id, info]) => ({
        id, label: info.label, baseUrl: info.baseUrl, needsKey: info.needsKey, defaultModel: info.defaultModel ?? null, cloud: CLOUD_PROVIDERS.has(id),
      })),
      keys: secrets.names(),
      encryptionAvailable: secrets.available,
      error: settings.aiProvider === 'none' ? null : library.aiError,
    };
  };

  const prefsView = (): Prefs => ({
    theme: prefs.get('theme'), lan: prefs.get('lan'), shortcut: prefs.get('shortcut'), shortcutRegistered: ctx.shortcutRegistered(),
  });

  const syncStatus = (): SyncStatus => {
    const last = library.lastSync;
    return {
      folder: memory().settings.get('syncFolder'),
      encrypted: memory().sync.encrypted,
      running: library.syncRunning,
      needsPassphrase: Boolean(last?.error && /Enter its passphrase/i.test(last.error)),
      last,
    };
  };

  const launch = () => mcpLaunch(ctx.launch);

  const pick = async (options: Electron.OpenDialogOptions): Promise<string | null> => {
    const parent = ctx.parentWindow();
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return picked.canceled ? null : picked.filePaths[0] ?? null;
  };

  const IMPORT_DIALOGS: Record<ImportKind, Electron.OpenDialogOptions> = {
    bookmarks: { title: 'Choose a bookmarks file exported from your browser', properties: ['openFile'], filters: [{ name: 'Bookmarks', extensions: ['html', 'htm'] }] },
    markdown: { title: 'Choose a folder of Markdown notes', properties: ['openDirectory'] },
    csv: { title: 'Choose a CSV file', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] },
    enve: { title: 'Choose an Enve Memory export folder', properties: ['openDirectory'] },
  };

  return {
    'app.info': (): AppInfo => {
      const m = memory();
      const stats = m.stats();
      return {
        version: ctx.version,
        home: m.paths!.home,
        database: m.paths!.database,
        platform: process.platform,
        isPackaged: ctx.isPackaged,
        schemaVersion: m.schemaVersion,
        deviceId: m.deviceId,
        stats,
        inboxCount: inbox().length,
        aiEnabled: m.settings.get('aiProvider') !== 'none',
        aiClientsSeen: m.clients.list().length > 0 || m.activity.recent({}, 200).some((c) => /^(mcp|api)(:|$)/.test(c.actor)),
      };
    },
    'app.openLibraryFolder': async () => {
      await shell.openPath(memory().paths!.home);
    },
    'app.openExternal': async (url) => {
      const parsed = new URL(str(url, 'URL'));
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new DesktopError('invalid', 'Only web and mail links open outside the app.');
      await shell.openExternal(parsed.href);
    },
    'prefs.get': prefsView,
    'prefs.setTheme': (theme) => {
      if (!['system', 'dark', 'light'].includes(theme)) throw new DesktopError('invalid', `Unknown theme "${theme}".`);
      prefs.set('theme', theme);
      ctx.applyTheme(theme);
      return prefsView();
    },

    'items.list': (filter, limit) => withTags(memory().items.list(filter, limit)),
    'items.page': (filter, cursor, limit) => {
      const items = memory().items.list({ ...filter, before: cursor ?? undefined }, limit);
      return { items: withTags(items), next: items.length === limit ? pageCursor(items[items.length - 1]!) : null };
    },
    'items.inbox': () => withTags(inbox()),
    'items.get': (id) => memory().items.get(id),
    'items.saveNote': (input) => memory().items.saveNote(input),
    'items.saveLink': (input) => memory().items.saveLink(input),
    'items.update': (id, input) => memory().items.update(id, input),
    'items.tag': (id, change) => memory().items.tag(id, change),
    'items.archive': (id) => memory().items.archive(id),
    'items.unarchive': (id) => memory().items.unarchive(id),
    'items.delete': (id) => memory().items.delete(id),
    'items.acceptSuggestions': (id) => memory().items.acceptSuggestions(id),
    'items.enrich': (id) => enrichItem(memory(), requireProvider(), id),
    'items.retryIngest': (id) => ingestItem(memory(), id),
    'items.retryFailed': () => memory().items.retryFailedIngest(),
    'items.openFile': async (id) => {
      const { attachment, data } = memory().files.read(id);
      // Opened from a temp copy under its real name, so the OS picks the right app and edits can't touch the stored blob.
      const dir = join(tmpdir(), 'enve-memory', id);
      mkdirSync(dir, { recursive: true });
      const target = join(dir, attachment.filename);
      writeFileSync(target, data);
      const error = await shell.openPath(target);
      if (error) throw new DesktopError('open_failed', error);
    },
    'files.save': (paths, project) => {
      if (!Array.isArray(paths) || paths.length === 0) throw new DesktopError('invalid', 'Drop at least one file.');
      return paths.map((path) => {
        const file = str(path, 'File path');
        if (!isAbsolute(file) || !statSync(file).isFile()) throw new DesktopError('invalid', `${file} is not a file. Folders can’t be saved yet.`);
        return memory().files.saveFromPath(file, { project }).item;
      });
    },

    'projects.list': (status) => {
      const m = memory();
      return m.projects.list(status).map((project) => ({ ...project, openTasks: m.tasks.list({ project: project.id }, 200).length }));
    },
    'projects.create': (input) => memory().projects.create(input),
    'projects.update': (ref, input) => memory().projects.update(ref, input),
    'projects.setMemory': (ref, text) => memory().projects.setMemory(ref, str(text, 'Memory')),
    'projects.briefing': (ref) => memory().briefing(ref),
    'projects.memoryHistory': (ref) =>
      memory()
        .activity.recent({ project: ref }, 200)
        .filter((c) => c.entity === 'project' && c.op === 'set_memory')
        .map((c) => ({ id: c.id, at: c.at, actor: c.actor, memory: String(c.data?.memory ?? '') })),
    'decisions.record': (input) => memory().decisions.record(input),

    'tasks.list': (query, limit) => memory().tasks.list(query, limit),
    'tasks.create': (input) => memory().tasks.create(input),
    'tasks.update': (id, input) => memory().tasks.update(id, input),

    'search.hybrid': (text, filter, limit) => memory().search.hybrid(str(text, 'Search'), filter, limit),
    'activity.recent': (query, limit) => memory().activity.recent(query, limit),
    'graph.get': (project) => memory().graph(project ? { project } : {}),

    'settings.get': () => memory().settings.all(),
    'settings.set': (key, value) => {
      if (key !== 'fetchLinks' && key !== 'semanticSearch') throw new DesktopError('invalid', `"${key}" can’t be changed here.`);
      if (typeof value !== 'boolean') throw new DesktopError('invalid', `${key} is on or off.`);
      memory().settings.set(key, value);
      if (key === 'semanticSearch') library.attachEmbedder();
      return memory().settings.all();
    },
    'index.status': () => {
      const model = library.embedderModel;
      const enabled = memory().settings.get('semanticSearch');
      if (!model) return { enabled, model: null, indexed: 0, pending: 0, chunks: 0 };
      return { enabled, model, ...memory().embeddings.status(model) };
    },

    'ai.status': aiStatus,
    'ai.configure': ({ provider, model, baseUrl }) => {
      const id = providerId(provider);
      const settings = memory().settings;
      settings.set('aiProvider', id);
      if (id === 'none') {
        settings.set('aiEnrich', false);
      } else {
        settings.set('aiModel', str(model, 'Model').trim() || PROVIDERS[id].defaultModel || '');
        settings.set('aiBaseUrl', str(baseUrl, 'Base URL').trim());
      }
      return aiStatus();
    },
    'ai.setKey': (provider, key) => {
      const id = providerId(provider);
      if (key === null || key.trim() === '') secrets.delete(id);
      else secrets.set(id, key.trim());
      return aiStatus();
    },
    'ai.models': async (config) => (await adHocProvider(config).listModels()).sort(),
    'ai.test': async (config) => {
      const reply = await adHocProvider(config).complete({
        system: 'You are a connectivity check. Reply with the single word OK.',
        prompt: 'Reply with OK.',
        maxTokens: 256,
      });
      return reply.trim().slice(0, 200) || '(empty reply)';
    },
    'ai.setEnrich': (on) => {
      const settings = memory().settings;
      if (on) {
        requireProvider();
        settings.set('aiEnrichSince', new Date().toISOString());
      }
      settings.set('aiEnrich', Boolean(on));
      return aiStatus();
    },
    'ai.ask': (question, project) => ask(memory(), requireProvider(), str(question, 'Question'), project ? { project } : {}),

    'clients.list': () => memory().clients.list(),
    'clients.create': (name, scopes) => memory().clients.create(name, scopes),
    'clients.pair': async (name) => {
      const { client, token } = memory().clients.create(name, ['read', 'write']);
      const links = await Promise.all(
        lanUrls(library.apiStatus.port).map(async (url) => {
          const link = pairingLink(url, token, client.name);
          return { url, link, qr: await QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: 'M' }) };
        }),
      );
      return { client, token, links };
    },
    'clients.revoke': (id) => memory().clients.revoke(id),
    'api.status': () => library.apiStatus,
    'api.setLan': async (lan) => {
      prefs.set('lan', Boolean(lan));
      return library.setLan(Boolean(lan));
    },
    'mcp.setup': () => ({
      ...setupSnippets(launch(), library.apiStatus.url ?? `http://127.0.0.1:${library.apiStatus.port}`),
      claudeAvailable: findExecutable('claude') !== null,
    }),
    'mcp.addToClaudeCode': () => {
      const claude = findExecutable('claude');
      if (!claude) throw new DesktopError('not_found', 'The `claude` command isn’t installed. Copy the command instead.');
      return new Promise((resolve) => {
        execFile(claude, claudeAddArgs(launch()), { timeout: 30_000 }, (error, stdout, stderr) => {
          resolve({ ok: !error, output: [stdout, stderr, error && !stderr ? error.message : ''].filter(Boolean).join('\n').trim() });
        });
      });
    },

    'backups.list': () => memory().backups.list(),
    'backups.create': () => memory().backups.create('manual'),
    'backups.restore': (file) => library.restore(str(file, 'Snapshot')),
    'exports.run': async () => {
      const folder = await pick({ title: 'Choose where to export', properties: ['openDirectory', 'createDirectory'] });
      if (!folder) return null;
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
      const summary = memory().exports.write(join(folder, `Enve Memory Export ${stamp}`));
      shell.showItemInFolder(summary.path);
      return summary;
    },

    'rules.list': () => memory().rules.list(),
    'rules.create': (input) => memory().rules.create(input),
    'rules.setEnabled': (id, enabled) => memory().rules.setEnabled(id, Boolean(enabled)),
    'rules.delete': (id) => memory().rules.delete(id),
    'imports.run': async (kind, project) => {
      if (!IMPORT_KINDS.includes(kind)) throw new DesktopError('invalid', `Unknown import "${kind}".`);
      const source = await pick(IMPORT_DIALOGS[kind]);
      if (!source) return null;
      const m = memory();
      switch (kind) {
        case 'bookmarks':
          return importBookmarks(m, readFileSync(source, 'utf8'), { project });
        case 'markdown':
          return importMarkdownFolder(m, source, { project });
        case 'csv':
          return importCsv(m, readFileSync(source, 'utf8'), { project });
        case 'enve':
          return importEnveExport(m, source);
      }
    },

    'sync.status': syncStatus,
    'sync.pickFolder': () => pick({ title: 'Choose a folder your computers already sync', properties: ['openDirectory', 'createDirectory'] }),
    'sync.start': async (folder, passphrase) => {
      const dir = str(folder, 'Folder');
      if (!isAbsolute(dir)) throw new DesktopError('invalid', 'Choose a folder.');
      const m = memory();
      if (passphrase) m.sync.setPassphrase(passphrase, dir);
      else m.sync.forgetKey();
      m.settings.set('syncFolder', dir);
      await library.sync();
      return syncStatus();
    },
    'sync.unlock': async (passphrase) => {
      memory().sync.setPassphrase(str(passphrase, 'Passphrase'));
      await library.sync();
      return syncStatus();
    },
    'sync.now': async () => {
      if (!memory().settings.get('syncFolder')) throw new MemoryError('invalid', 'Choose a sync folder first.');
      await library.sync();
      return syncStatus();
    },
    'sync.stop': () => {
      const m = memory();
      m.sync.forgetKey();
      m.settings.set('syncFolder', '');
      library.lastSync = null;
      return syncStatus();
    },

    'capture.open': () => ctx.openCapture(),
    'capture.close': () => ctx.closeCapture(),
  };
}

