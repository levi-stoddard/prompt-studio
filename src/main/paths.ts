import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

/** Default base directory: %LOCALAPPDATA%\PromptStudio (machine-local, not roamed). */
export function defaultHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'PromptStudio');
}

export interface AppPaths {
  home: string;
  data: string;
  db: string;
  secrets: string;
  electron: string;
  backups: string;
  exports: string;
  logs: string;
}

/** All application state lives under one directory: PROMPTSTUDIO_HOME if set, else defaultHome() (tests use a temp home). */
export function appPaths(home = process.env.PROMPTSTUDIO_HOME || defaultHome()): AppPaths {
  return {
    home,
    data: join(home, 'data'),
    db: join(home, 'data', 'promptstudio.db'),
    secrets: join(home, 'data', 'secrets'),
    electron: join(home, 'data', 'electron'),
    backups: join(home, 'backups'),
    exports: join(home, 'exports'),
    logs: join(home, 'logs'),
  };
}

export function ensureDirs(p: AppPaths): void {
  for (const d of [p.data, p.secrets, p.electron, p.backups, p.exports, p.logs]) mkdirSync(d, { recursive: true });
}
