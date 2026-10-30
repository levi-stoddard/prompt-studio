import { safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The Gemini API key is encrypted with Windows DPAPI (Electron safeStorage), bound to this Windows
// user account. Only the main process ever holds the plaintext; the window only learns whether a key exists.

export class Credentials {
  private readonly file: string;

  constructor(secretsDir: string) {
    this.file = join(secretsDir, 'gemini-api-key.dpapi');
  }

  available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  has(): boolean {
    return existsSync(this.file);
  }

  set(key: string): void {
    const k = key.trim();
    if (!/^[A-Za-z0-9_\-.]{20,200}$/.test(k)) throw new Error('That does not look like a Gemini API key.');
    if (!this.available()) throw new Error('Windows secure storage is not available, so the key was not saved.');
    writeFileSync(this.file, safeStorage.encryptString(k));
  }

  get(): string | null {
    if (!this.has() || !this.available()) return null;
    try {
      return safeStorage.decryptString(readFileSync(this.file));
    } catch {
      return null;
    }
  }

  /** Removes only the app's own encrypted key file, at the user's request. */
  clear(): void {
    if (this.has()) rmSync(this.file);
  }
}
