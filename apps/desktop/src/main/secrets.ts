import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DesktopError } from './dispatch.ts';

/** The slice of Electron's `safeStorage` the store needs; injectable so tests don't touch the OS keychain. */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface SecretFile {
  version: 1;
  secrets: Record<string, string>;
}

/**
 * Provider API keys, encrypted with the OS credential store (Keychain, DPAPI, libsecret) and kept in a file beside the
 * library. Never in SQLite, so backups, exports and sync never carry them.
 */
export class SecretStore {
  private readonly file: string;
  private readonly cipher: Cipher;
  private cache = new Map<string, string>();

  constructor(file: string, cipher: Cipher) {
    this.file = file;
    this.cipher = cipher;
  }

  get available(): boolean {
    return this.cipher.isEncryptionAvailable();
  }

  names(): string[] {
    return Object.keys(this.read().secrets).sort();
  }

  get(name: string): string | undefined {
    if (this.cache.has(name)) return this.cache.get(name);
    const encoded = this.read().secrets[name];
    if (encoded === undefined) return undefined;
    const value = this.cipher.decryptString(Buffer.from(encoded, 'base64'));
    this.cache.set(name, value);
    return value;
  }

  set(name: string, value: string): void {
    if (!this.available) {
      throw new DesktopError('unavailable', 'This computer has no OS credential store available, so the key can’t be saved securely.');
    }
    const file = this.read();
    file.secrets[name] = this.cipher.encryptString(value).toString('base64');
    this.write(file);
    this.cache.set(name, value);
  }

  delete(name: string): void {
    const file = this.read();
    delete file.secrets[name];
    this.write(file);
    this.cache.delete(name);
  }

  private read(): SecretFile {
    if (!existsSync(this.file)) return { version: 1, secrets: {} };
    const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as SecretFile;
    return { version: 1, secrets: { ...parsed.secrets } };
  }

  private write(file: SecretFile): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
