import { useCallback, useEffect, useRef, useState } from 'react';
import type { Args, Bridge, Command, Method, Result } from '../../shared/ipc.ts';

declare global {
  interface Window {
    enve: Bridge;
  }
}

export class CallFailed extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function call<M extends Method>(method: M, ...args: Args<M>): Promise<Result<M>> {
  const envelope = await window.enve.call(method, ...args);
  if (!envelope.ok) throw new CallFailed(envelope.error.code, envelope.error.message);
  return envelope.value as Result<M>;
}

const changeListeners = new Set<() => void>();
window.enve.on('changed', () => {
  for (const listener of changeListeners) listener();
});

export function onChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => void changeListeners.delete(listener);
}

export function onCommand(listener: (command: Command | 'capture-focus') => void): () => void {
  return window.enve.on('command', (command) => listener(command as Command));
}

export interface Live<T> {
  data: T | undefined;
  error: CallFailed | null;
  reload: () => void;
}

/** Loads data and reloads it whenever the library changes (our writes, workers, MCP servers, the CLI). */
export function useLive<T>(load: () => Promise<T>, deps: readonly unknown[]): Live<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<CallFailed | null>(null);
  const request = useRef(0);
  const run = useCallback(() => {
    const id = ++request.current;
    load().then(
      (value) => {
        if (id !== request.current) return;
        setData(value);
        setError(null);
      },
      (err: unknown) => {
        if (id !== request.current) return;
        setError(err instanceof CallFailed ? err : new CallFailed('internal', String(err)));
      },
    );
  }, deps);
  useEffect(() => {
    run();
    return onChanged(run);
  }, [run]);
  return { data, error, reload: run };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
