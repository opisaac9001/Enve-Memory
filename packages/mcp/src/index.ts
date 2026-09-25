import type { EnveMemory } from '@enve-memory/core';
import { attachLocalEmbedder } from '@enve-memory/embeddings';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.ts';

export { SERVER_NAME, type ServerAccess, createServer } from './server.ts';

export function serveMemoryOverStdio(memory: EnveMemory, version: string) {
  attachLocalEmbedder(memory);
  return serveStdio(() => createServer(memory, version), { onerror: (error) => console.error(error) });
}
