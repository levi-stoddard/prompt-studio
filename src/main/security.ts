import { app, type BrowserWindow, type Session } from 'electron';
import { CHANNELS } from '../shared/channels';

export const APP_ORIGIN = 'app://promptstudio';

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // CodeMirror injects its theme as <style> elements.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Deny every browser permission and block all renderer network traffic except the bundled app:// files. */
export function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setSpellCheckerEnabled(false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = details.url.startsWith(`${APP_ORIGIN}/`) || details.url.startsWith('devtools://') || details.url.startsWith('data:');
    callback({ cancel: !ok });
  });
}

export function hardenWebContents(): void {
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (ev, url) => {
      if (!url.startsWith(`${APP_ORIGIN}/`)) ev.preventDefault();
    });
    wc.on('will-redirect', (ev, url) => {
      if (!url.startsWith(`${APP_ORIGIN}/`)) ev.preventDefault();
    });
    wc.on('will-attach-webview', (ev) => ev.preventDefault());
  });
}

export function isTrustedSender(frameUrl: string | undefined, isMainWindow: boolean): boolean {
  return isMainWindow && !!frameUrl && frameUrl.startsWith(`${APP_ORIGIN}/`);
}

export function windowPreferences(preload: string) {
  return {
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    devTools: !app.isPackaged,
  };
}

/** Security status measured in the live window (not just the configuration that was requested). */
export async function securityReport(win: BrowserWindow | null) {
  let live: Record<string, unknown> = {};
  try {
    live = win
      ? await win.webContents.executeJavaScript(
          `({ requireAvailable: typeof require !== 'undefined', processAvailable: typeof process !== 'undefined', bridgeKeys: Object.keys(window.ps || {}), sandboxed: !!(window.psEnv && window.psEnv.sandboxed), contextIsolated: !!(window.psEnv && window.psEnv.contextIsolated) })`,
        )
      : {};
  } catch {
    live = {};
  }
  return {
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    sandbox: live.sandboxed === true,
    contextIsolation: live.contextIsolated === true,
    nodeIntegration: live.requireAvailable === true || live.processAvailable === true,
    bridge: live.bridgeKeys ?? [],
    webviewTag: false,
    devTools: !app.isPackaged,
    contentSecurityPolicy: CSP,
    rendererNetwork: 'Blocked: the window can load only bundled app:// files. Gemini calls run in the main process.',
    ipcChannels: CHANNELS.length,
  };
}
