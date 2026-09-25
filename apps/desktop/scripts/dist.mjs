import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from './bundle.mjs';

// Electron is hoisted to the workspace root, where electron-builder can't see it, so pass the installed version explicitly.
const { version } = createRequire(import.meta.url)('electron/package.json');
const builder = join(root, '..', '..', 'node_modules', '.bin', 'electron-builder');

execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });
execFileSync(builder, ['--config', 'electron-builder.yml', `-c.electronVersion=${version}`, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
