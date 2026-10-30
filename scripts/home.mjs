// Base and install directories for the scripts; mirrors defaultHome() in src/main/paths.ts.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const home = process.env.PROMPTSTUDIO_HOME || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'PromptStudio');
export const installDir = process.env.PROMPTSTUDIO_INSTALL_DIR || join(home, 'app');
