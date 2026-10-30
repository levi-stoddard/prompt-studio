import { app, BrowserWindow, dialog, Menu, protocol, session, type MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { MockProvider } from '../core/mock';
import { dailyBackup, snapshotBackup } from './backup';
import { Credentials } from './credentials';
import { SCHEMA_VERSION, Store } from './db';
import { GeminiProvider } from './gemini';
import { GenerationService } from './generation';
import { registerIpc } from './ipc';
import { initLogger, log, registerSecret } from './logger';
import { appPaths, ensureDirs } from './paths';
import { readExcerpt } from './projectFs';
import { APP_ORIGIN, CSP, hardenSession, hardenWebContents, windowPreferences } from './security';

const paths = appPaths();
let win: BrowserWindow | null = null;
let store: Store | null = null;

// Keep every Chromium/Electron file (cache, local storage, crash dumps) under the app's own directory.
try {
  ensureDirs(paths);
  app.setPath('userData', paths.electron);
  app.setPath('sessionData', paths.electron);
  app.setPath('logs', paths.logs);
  app.setPath('crashDumps', join(paths.electron, 'crashes'));
} catch (e) {
  app.whenReady().then(() => {
    dialog.showErrorBox('Prompt Studio cannot start', `The data folder ${paths.home} is not available.\n\n${String((e as Error).message)}`);
    app.quit();
  });
}

app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
hardenWebContents();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start).catch((e) => {
    log('error', 'startup.failed', { message: String(e?.message ?? e) });
    dialog.showErrorBox('Prompt Studio could not start', String(e?.stack ?? e));
    app.quit();
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serveRenderer(): void {
  const root = normalize(join(__dirname, '..', 'renderer'));
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'promptstudio') return new Response('Not found', { status: 404 });
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.readFile(file);
      return new Response(data, {
        headers: {
          'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function buildMenu(): void {
  const view: MenuItemConstructorOptions[] = [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }];
  if (!app.isPackaged) view.unshift({ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'quit', label: 'Exit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: view },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    ]),
  );
}

async function start(): Promise<void> {
  initLogger(paths.logs);
  log('info', 'startup', { version: app.getVersion(), packaged: app.isPackaged });

  store = new Store(paths.db);
  const before = store.schemaVersion();
  if (before > 0 && before < SCHEMA_VERSION) snapshotBackup(store, paths.backups, `pre-migration-v${before}`);
  store.migrate();
  try {
    dailyBackup(store, paths.backups);
  } catch (e) {
    log('warn', 'backup.failed', { message: String((e as Error).message) });
  }

  const creds = new Credentials(paths.secrets);
  registerSecret(creds.get());
  const s = store;
  const mock = new MockProvider();
  const gen = new GenerationService({
    store: s,
    providerFor: (id) => {
      if (id === 'mock') return mock;
      const key = creds.get();
      if (!key) return null;
      const st = s.getSettings();
      return new GeminiProvider(key, { maxOutputTokens: st.maxOutputTokens, temperature: st.temperature, retries: st.autoRetry ? 2 : 0 });
    },
    readExcerpt,
    log,
  });

  hardenSession(session.defaultSession);
  serveRenderer();
  buildMenu();
  registerIpc({ store: s, paths, creds, gen, getWindow: () => win });

  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    title: 'Prompt Studio',
    backgroundColor: '#14161b',
    show: false,
    webPreferences: windowPreferences(join(__dirname, '..', 'preload', 'preload.js')),
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });
  await win.loadURL(`${APP_ORIGIN}/index.html`);
}

app.on('window-all-closed', () => {
  store?.close();
  store = null;
  app.quit();
});
