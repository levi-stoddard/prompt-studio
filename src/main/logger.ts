import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSecrets } from '../core/secrets';

// Metadata-only log. Prompt text, file contents and API keys are never passed to the logger;
// everything is additionally run through the secret redactor as a second line of defence.

let logDir: string | null = null;
let extraSecrets: string[] = [];

export function initLogger(dir: string): void {
  logDir = dir;
}

/** Register a known secret (the API key) so it is scrubbed even if it does not match a pattern. */
export function registerSecret(value: string | null): void {
  extraSecrets = value ? [value] : [];
}

export function scrub(text: string): string {
  let t = redactSecrets(text);
  for (const s of extraSecrets) if (s) t = t.split(s).join('[REDACTED API key]');
  return t;
}

export function log(level: 'info' | 'warn' | 'error', event: string, meta: Record<string, unknown> = {}): void {
  if (!logDir) return;
  const line = scrub(JSON.stringify({ t: new Date().toISOString(), level, event, ...meta }));
  try {
    appendFileSync(join(logDir, `app-${new Date().toISOString().slice(0, 7)}.log`), line + '\n', 'utf8');
  } catch {
    // Logging must never break the app.
  }
}
