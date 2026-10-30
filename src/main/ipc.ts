import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PRICES_SOURCE, PRICES_VERIFIED_ON } from '../core/pricing';
import { priceFor } from '../core/budget';
import { HELP_LINKS, type Channel } from '../shared/channels';
import { listBackups, snapshotBackup } from './backup';
import type { Credentials } from './credentials';
import type { Store } from './db';
import { listGeminiModels } from './gemini';
import { currentBudget, type GenerationService } from './generation';
import { log, registerSecret, scrub } from './logger';
import type { AppPaths } from './paths';
import { listFiles, readExcerpt } from './projectFs';
import { isTrustedSender, securityReport } from './security';

export interface IpcContext {
  store: Store;
  paths: AppPaths;
  creds: Credentials;
  gen: GenerationService;
  getWindow: () => BrowserWindow | null;
}

const id = z.string().min(1).max(100);
const text = (max: number) => z.string().max(max);
const mode = z.enum(['preserve', 'challenge']);
const scope = z.enum(['global', 'project', 'target']);
const priceEntry = z.object({
  model: z.string().min(1).max(100),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inputPerM: z.number().min(0).max(1000),
  outputPerM: z.number().min(0).max(1000),
  longThreshold: z.number().int().positive().optional(),
  inputPerMLong: z.number().min(0).max(1000).optional(),
  outputPerMLong: z.number().min(0).max(1000).optional(),
});

const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 80) || 'prompt';

export function registerIpc(ctx: IpcContext): void {
  const { store, paths, creds, gen } = ctx;

  function handle<S extends z.ZodTypeAny>(channel: Channel, schema: S, fn: (args: z.infer<S>) => unknown) {
    ipcMain.handle(channel, async (event, payload) => {
      const win = ctx.getWindow();
      if (!isTrustedSender(event.senderFrame?.url, !!win && event.sender === win.webContents)) {
        log('warn', 'ipc.untrusted', { channel });
        return { ok: false, error: 'Request refused: untrusted sender.' };
      }
      try {
        const args = schema.parse(payload ?? {});
        const data = await fn(args);
        return { ok: true, data: data ?? null };
      } catch (e) {
        const message = e instanceof z.ZodError ? `Invalid request: ${e.issues.map((i) => i.message).join('; ')}` : String((e as Error)?.message ?? e);
        log('error', 'ipc.error', { channel, message });
        return { ok: false, error: scrub(message) };
      }
    });
  }
  const none = z.object({}).passthrough();

  const bootstrap = async () => ({
    projects: store.listProjects(),
    targets: store.listTargets(),
    rules: store.listRules(),
    settings: store.getSettings(),
    budget: currentBudget(store, new Date()),
    keyConfigured: creds.has(),
    secureStorage: creds.available(),
    paths: { home: paths.home, db: paths.db, backups: paths.backups, exports: paths.exports, logs: paths.logs },
    backups: listBackups(paths.backups).slice(0, 5),
    security: await securityReport(ctx.getWindow()),
    appVersion: app.getVersion(),
    pricesVerifiedOn: PRICES_VERIFIED_ON,
    pricesSource: PRICES_SOURCE,
  });
  handle('app:bootstrap', none, bootstrap);

  // ---------- projects & folders ----------
  handle('projects:create', z.object({ name: text(120).min(1), description: text(2000).default('') }), (a) => store.createProject(a.name.trim(), a.description));
  handle('projects:update', z.object({ id, name: text(120).min(1), description: text(2000) }), (a) => store.updateProject(a.id, a.name.trim(), a.description));
  handle('folders:list', z.object({ projectId: id }), (a) => store.listFolders(a.projectId));
  handle('folders:add', z.object({ projectId: id }), async (a) => {
    if (!store.getProject(a.projectId)) throw new Error('Project not found.');
    const win = ctx.getWindow();
    const opts = { title: 'Authorize a project folder for READ-ONLY access', properties: ['openDirectory' as const] };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    const folder = store.addFolder(a.projectId, res.filePaths[0]);
    log('info', 'folder.authorized', { projectId: a.projectId });
    return folder;
  });
  handle('folders:revoke', z.object({ folderId: id }), (a) => store.revokeFolder(a.folderId));
  handle('folders:files', z.object({ folderId: id }), async (a) => {
    const f = store.getFolder(a.folderId);
    if (!f) throw new Error('Folder is not authorized.');
    return listFiles(f.path);
  });
  handle('folders:preview', z.object({ folderId: id, relPath: text(1000).min(1) }), async (a) => {
    const f = store.getFolder(a.folderId);
    if (!f) throw new Error('Folder is not authorized.');
    const ex = await readExcerpt(f.path, a.relPath, store.getSettings().excerptCharLimit);
    return { text: ex.text, truncated: ex.truncated, findings: ex.findings.map((x) => x.type) };
  });

  // ---------- sessions ----------
  handle('sessions:list', z.object({ projectId: id.nullable() }), (a) => store.listSessions(a.projectId));
  handle('sessions:create', z.object({ projectId: id.nullable(), title: text(200), targetId: id, mode, original: text(100_000).min(1) }), (a) => {
    if (a.projectId && !store.getProject(a.projectId)) throw new Error('Project not found.');
    if (!store.getTarget(a.targetId)) throw new Error('Target AI not found.');
    const title = a.title.trim() || a.original.trim().split('\n')[0].slice(0, 60);
    return store.createSession({ projectId: a.projectId, title, targetId: a.targetId, mode: a.mode, original: a.original });
  });
  handle('sessions:get', z.object({ id }), (a) => ({
    ...store.sessionDetail(a.id),
    applicableRules: gen.rulesFor(a.id),
  }));
  handle('sessions:update', z.object({ id, title: text(200).optional(), targetId: id.optional(), mode: mode.optional() }), (a) => {
    if (a.targetId && !store.getTarget(a.targetId)) throw new Error('Target AI not found.');
    store.updateSessionMeta(a.id, a);
  });
  handle('sessions:saveWorking', z.object({ id, text: text(200_000) }), (a) => {
    if (store.sessionRow(a.id).status === 'approved') throw new Error('This prompt is approved. Reopen it to edit.');
    store.saveWorking(a.id, a.text);
  });
  handle('sessions:checkpoint', z.object({ id, note: text(200).optional() }), (a) => store.checkpoint(a.id, a.note || 'Manual edit (saved)'));
  handle('sessions:restore', z.object({ id, versionId: id }), (a) => {
    const v = store.getVersion(a.versionId);
    if (v.sessionId !== a.id) throw new Error('Version belongs to another prompt.');
    store.checkpoint(a.id, 'Manual edit (saved before restore)');
    return store.addVersion(a.id, 'restored', v.text, `Restored from version ${v.seq}`, null);
  });
  handle('sessions:approve', z.object({ id, force: z.boolean().default(false) }), (a) => {
    const r = gen.approve(a.id, a.force);
    if (r.approved) log('info', 'prompt.approved', { missingProtected: r.missing.length });
    return r;
  });
  handle('sessions:reopen', z.object({ id }), (a) => store.reopen(a.id));

  // ---------- comments ----------
  handle('comments:add', z.object({ sessionId: id, start: z.number().int().min(0), end: z.number().int().min(0), quote: text(20_000).min(1), body: text(5000).min(1) }), (a) =>
    store.addComment(a.sessionId, { start: a.start, end: a.end, quote: a.quote, body: a.body }),
  );
  handle('comments:update', z.object({ id, body: text(5000).optional(), status: z.enum(['open', 'resolved']).optional() }), (a) => store.updateComment(a.id, a));

  // ---------- generation ----------
  handle(
    'gen:preview',
    z.object({
      sessionId: id,
      kind: z.enum(['generate', 'revise']),
      excerpts: z.array(z.object({ folderId: id, relPath: text(1000).min(1) })).max(20).default([]),
      instruction: text(5000).optional(),
      selection: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).nullable().optional(),
    }),
    (a) => gen.preview(a),
  );
  handle('gen:run', z.object({ previewId: id }), (a) => gen.run(a.previewId));
  handle('recs:decide', z.object({ id, decision: z.enum(['accepted', 'rejected']) }), (a) => {
    if (a.decision === 'accepted') return gen.acceptRecommendation(a.id);
    store.decideRecommendation(a.id, 'rejected');
    return null;
  });

  // ---------- library ----------
  handle('rules:list', none, () => store.listRules());
  const ruleInput = z.object({
    id: id.optional(),
    scope,
    projectId: id.nullable().default(null),
    targetId: id.nullable().default(null),
    category: text(60).min(1),
    title: text(200).min(1),
    body: text(10_000).min(1),
    protected: z.boolean(),
  });
  handle('rules:save', ruleInput, (a) => {
    if (a.scope === 'project' && (!a.projectId || !store.getProject(a.projectId))) throw new Error('Choose the project this rule applies to.');
    if (a.scope === 'target' && (!a.targetId || !store.getTarget(a.targetId))) throw new Error('Choose the target AI this rule applies to.');
    if (a.id) store.updateRule(a.id, a);
    else return store.createRule(a);
    return a.id;
  });
  handle('rules:setEnabled', z.object({ id, enabled: z.boolean() }), (a) => store.setRuleEnabled(a.id, a.enabled));
  handle('rules:history', z.object({ id }), (a) => store.ruleHistory(a.id));
  handle('targets:save', z.object({ id: id.optional(), name: text(60).min(1), url: z.string().url().startsWith('https://'), guidance: text(5000).min(1), format: z.enum(['xml', 'markdown']) }), (a) => store.saveTarget(a));

  // ---------- settings, budget, credentials ----------
  handle(
    'settings:update',
    z.object({
      provider: z.enum(['mock', 'gemini']).optional(),
      model: text(100).min(1).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxOutputTokens: z.number().int().min(512).max(65_536).optional(),
      maxCostPerRequestUsd: z.number().min(0.01).max(5).optional(),
      autoRetry: z.boolean().optional(),
      excerptCharLimit: z.number().int().min(500).max(50_000).optional(),
      prices: z.array(priceEntry).max(200).optional(),
    }),
    (a) => {
      for (const [k, v] of Object.entries(a)) if (v !== undefined) store.setSetting(k as any, v as any);
      return bootstrap();
    },
  );
  handle('settings:setBudget', z.object({ limitUsd: z.number().min(0).max(10_000) }), async (a) => {
    const current = store.getSettings().monthlyLimitUsd;
    if (a.limitUsd > current) {
      // Raising the allowance is confirmed in a native dialog owned by the main process.
      const win = ctx.getWindow();
      const opts = {
        type: 'warning' as const,
        title: 'Raise monthly Gemini allowance?',
        message: `Raise the monthly Gemini allowance from $${current.toFixed(2)} to $${a.limitUsd.toFixed(2)}?`,
        detail: 'Prompt Studio never raises the allowance on its own. This change applies from now on.',
        buttons: ['Cancel', 'Raise allowance'],
        defaultId: 0,
        cancelId: 0,
      };
      const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      if (res.response !== 1) return { changed: false, budget: currentBudget(store, new Date()) };
    }
    store.setSetting('monthlyLimitUsd', a.limitUsd);
    log('info', 'budget.changed', { from: current, to: a.limitUsd });
    return { changed: true, budget: currentBudget(store, new Date()) };
  });
  handle('budget:get', none, () => {
    const b = currentBudget(store, new Date());
    return { budget: b, usage: store.usageList(b.month) };
  });
  handle('key:set', z.object({ key: z.string().min(1).max(300) }), (a) => {
    creds.set(a.key);
    registerSecret(creds.get());
    log('info', 'key.saved', {});
    return true;
  });
  handle('key:clear', none, () => {
    creds.clear();
    registerSecret(null);
    log('info', 'key.cleared', {});
    return true;
  });
  handle('models:list', none, async () => {
    const key = creds.get();
    if (!key) throw new Error('No Gemini API key is configured.');
    const prices = store.getSettings().prices;
    const models = await listGeminiModels(key);
    return models.map((m) => ({ ...m, priced: priceFor(prices, m.id, new Date()) !== null }));
  });

  // ---------- clipboard, external, export, backup ----------
  handle('clipboard:copy', z.object({ sessionId: id, which: z.enum(['approved', 'working']) }), (a) => {
    const s = store.sessionRow(a.sessionId);
    let t: string;
    if (a.which === 'approved') {
      if (s.status !== 'approved' || !s.approved_version_id) throw new Error('Approve the prompt before copying the final version.');
      t = store.getVersion(s.approved_version_id).text;
    } else t = s.working_text;
    clipboard.writeText(t);
    return t.length;
  });
  handle('external:openTarget', z.object({ targetId: id }), async (a) => {
    const t = store.getTarget(a.targetId);
    if (!t || !/^https:\/\//.test(t.url)) throw new Error('This target has no valid https address.');
    // Opens the assistant's start page only. The prompt is never placed in the URL or sent anywhere.
    await shell.openExternal(t.url);
  });
  handle('external:openHelp', z.object({ topic: z.enum(Object.keys(HELP_LINKS) as [keyof typeof HELP_LINKS]) }), async (a) => {
    await shell.openExternal(HELP_LINKS[a.topic]);
  });
  handle('export:prompt', z.object({ sessionId: id }), async (a) => {
    const s = store.sessionRow(a.sessionId);
    const approved = s.status === 'approved' && s.approved_version_id;
    const body = approved ? store.getVersion(s.approved_version_id).text : s.working_text;
    const win = ctx.getWindow();
    const opts = { title: 'Export prompt', defaultPath: join(paths.exports, `${safeName(s.title)}${approved ? '' : ' (draft)'}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }] };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    writeFileSync(res.filePath, scrub(body), 'utf8');
    return res.filePath;
  });
  handle('export:library', none, async () => {
    const rules = store.listRules().map((r) => ({ ...r, history: store.ruleHistory(r.id) }));
    const win = ctx.getWindow();
    const opts = { title: 'Export instruction library', defaultPath: join(paths.exports, `instruction-library-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    writeFileSync(res.filePath, scrub(JSON.stringify({ exportedAt: new Date().toISOString(), rules }, null, 2)), 'utf8');
    return res.filePath;
  });
  handle('backup:now', z.object({ chooseLocation: z.boolean().default(false) }), async (a) => {
    if (!a.chooseLocation) return snapshotBackup(store, paths.backups, 'manual');
    const win = ctx.getWindow();
    const opts = { title: 'Save a backup copy of the Prompt Studio database', defaultPath: `promptstudio-backup-${new Date().toISOString().slice(0, 10)}.db`, filters: [{ name: 'SQLite database', extensions: ['db'] }] };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return null;
    store.snapshotTo(res.filePath);
    return res.filePath;
  });
  handle('folder:openData', none, async () => {
    await shell.openPath(paths.home);
  });
}
