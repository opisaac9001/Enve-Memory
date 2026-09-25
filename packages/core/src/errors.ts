/** `locked`: an encrypted sync folder needs its passphrase. */
export type MemoryErrorCode = 'not_found' | 'invalid' | 'conflict' | 'schema' | 'locked';

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;

  constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
  }
}

export function invalid(message: string): MemoryError {
  return new MemoryError('invalid', message);
}

export function notFound(message: string): MemoryError {
  return new MemoryError('not_found', message);
}
