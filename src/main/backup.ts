import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { localDate } from '../core/budget';
import type { Store } from './db';

// Backups are snapshots taken with VACUUM INTO. The app never deletes or rotates backup files.

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export function dailyBackup(store: Store, dir: string): string | null {
  const name = `auto-${localDate(new Date())}.db`;
  const file = join(dir, name);
  if (existsSync(file)) return null;
  store.snapshotTo(file);
  return file;
}

export function snapshotBackup(store: Store, dir: string, label: string): string {
  const file = join(dir, `${label}-${stamp()}.db`);
  store.snapshotTo(file);
  return file;
}

export function listBackups(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse() : [];
}
