import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/channels';

// Runs sandboxed with context isolation. Exposes one narrow function; no Node or Electron objects reach the page.
const allowed = new Set<string>(CHANNELS);

contextBridge.exposeInMainWorld('ps', {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!allowed.has(channel)) return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, payload);
  },
});

// Read-only runtime facts used by the in-app security status panel.
contextBridge.exposeInMainWorld('psEnv', {
  sandboxed: process.sandboxed === true,
  contextIsolated: process.contextIsolated === true,
});
