import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { root, targets } from './bundle.mjs';

rmSync(join(root, 'dist'), { recursive: true, force: true });
await Promise.all(Object.values(targets).map((options) => esbuild(options)));
await vite({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
console.log('Built apps/desktop/dist');
