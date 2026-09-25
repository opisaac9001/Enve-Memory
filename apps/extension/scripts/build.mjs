import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const { manifest_version, name, ...rest } = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
const base = { manifest_version, name, version: pkg.version, ...rest };

const { side_panel, ...firefoxBase } = base;
const { 'open-panel': openPanel, ...firefoxCommands } = base.commands;

const targets = {
  chrome: base,
  firefox: {
    ...firefoxBase,
    // Firefox MV3 has no extension service workers; it runs the same module as a background script.
    background: { scripts: [base.background.service_worker], type: 'module' },
    permissions: base.permissions.filter((permission) => permission !== 'sidePanel'),
    sidebar_action: {
      default_panel: side_panel.default_path,
      default_title: base.name,
      default_icon: base.action.default_icon,
      open_at_install: false,
    },
    commands: { ...firefoxCommands, _execute_sidebar_action: { suggested_key: openPanel.suggested_key, description: openPanel.description } },
    browser_specific_settings: {
      gecko: {
        id: 'enve-memory@envemedia.com',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

// Tests can't click the browser's permission prompt, so their build holds the optional permissions from the start.
if (process.argv.includes('--e2e')) {
  const { optional_permissions, ...rest } = base;
  targets['chrome-e2e'] = { ...rest, permissions: [...base.permissions, ...optional_permissions] };
}

await rm(dist, { recursive: true, force: true });
for (const [target, manifest] of Object.entries(targets)) {
  const out = join(dist, target);
  await mkdir(out, { recursive: true });
  await cp(src, out, { recursive: true, filter: (path) => !path.endsWith('manifest.json') && !path.endsWith('.DS_Store') });
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${target} → ${out}`);
}
