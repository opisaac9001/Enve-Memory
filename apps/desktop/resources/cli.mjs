// The packaged MCP/CLI entry point: runs the CLI bundled inside the app so its imports resolve against the app's node_modules.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

await import(pathToFileURL(join(import.meta.dirname, 'app.asar', 'dist', 'cli.mjs')).href);
