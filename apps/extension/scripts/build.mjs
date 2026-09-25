import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const { manifest_version, name, ...rest } = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
const base = { manifest_version, name, version: pkg.version, ...rest };

const targets = {
  chrome: base,
  firefox: {
    ...base,
    // Firefox MV3 has no extension service workers; it runs the same module as a background script.
    background: { scripts: [base.background.service_worker], type: 'module' },
    browser_specific_settings: {
      gecko: {
        id: 'enve-memory@envemedia.com',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

await rm(dist, { recursive: true, force: true });
for (const [target, manifest] of Object.entries(targets)) {
  const out = join(dist, target);
  await mkdir(out, { recursive: true });
  await cp(src, out, { recursive: true, filter: (path) => !path.endsWith('manifest.json') && !path.endsWith('.DS_Store') });
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${target} → ${out}`);
}
