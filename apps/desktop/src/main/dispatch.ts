import { AiError } from '@enve-memory/ai';
import { MemoryError } from '@enve-memory/core';
import { type Api, type CallError, type Envelope, type Method, isMethod } from '../shared/ipc.ts';

export type Handlers = { [M in Method]: (...args: Parameters<Api[M]>) => ReturnType<Api[M]> | Promise<ReturnType<Api[M]>> };

/** A failure the user can act on, raised by desktop handlers themselves. */
export class DesktopError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function toCallError(error: unknown): CallError {
  if (error instanceof MemoryError || error instanceof DesktopError) return { code: error.code, message: error.message };
  if (error instanceof AiError) return { code: 'ai', message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'internal', message: message || 'Something went wrong.' };
}

/**
 * Runs one allow-listed handler. Unknown names (including inherited ones like `constructor` or `__proto__`) never
 * reach an object lookup, and every failure becomes a `{ code, message }` the UI can show.
 */
export async function dispatch(handlers: Handlers, method: unknown, args: unknown): Promise<Envelope> {
  if (!isMethod(method) || !Object.hasOwn(handlers, method)) {
    return { ok: false, error: { code: 'unknown_method', message: `Unknown method ${JSON.stringify(method)}.` } };
  }
  if (!Array.isArray(args)) return { ok: false, error: { code: 'invalid', message: 'Arguments must be a list.' } };
  const handler = handlers[method] as (...a: unknown[]) => unknown;
  try {
    return { ok: true, value: await handler(...args) };
  } catch (error) {
    return { ok: false, error: toCallError(error) };
  }
}
