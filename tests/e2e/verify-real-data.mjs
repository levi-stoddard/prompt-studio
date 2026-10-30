// Post-install check against a COPY of the real database (the original is opened read-only and never
// modified). Runs the current build, which verify-security has confirmed is byte-identical to the
// installed app. Uses a fake API key and counts network calls; no Gemini request is ever sent.
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { home as appHome } from '../../scripts/home.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const realDb = process.env.PROMPTSTUDIO_REAL_DB || join(appHome, 'data', 'promptstudio.db');
const home = join(tmpdir(), `promptstudio-realcopy-${Date.now()}`);
mkdirSync(join(home, 'data'), { recursive: true });
const copyDb = join(home, 'data', 'promptstudio.db');
{
  const src = new DatabaseSync(realDb, { readOnly: true });
  src.exec(`VACUUM INTO '${copyDb.replace(/'/g, "''")}'`);
  src.close();
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const launch = async () => {
  // Network is disabled: fetch always fails (and is counted), and Node's HTTP goes to a dead proxy.
  const offline = { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '' };
  const app = await electron.launch({ executablePath: electronPath, args: [root], env: { ...process.env, ...offline, PROMPTSTUDIO_HOME: home } });
  const page = await app.firstWindow();
  await page.waitForSelector('.app', { timeout: 20000 });
  await app.evaluate(() => {
    globalThis.__fetchCalls = 0;
    globalThis.fetch = async () => {
      globalThis.__fetchCalls++;
      throw new TypeError('fetch failed: network disabled in tests');
    };
  });
  return { app, page };
};
const ipc = async (page, c, p) => {
  const r = await page.evaluate(([c, p]) => window.ps.invoke(c, p), [c, p]);
  if (!r.ok) throw new Error(`${c}: ${r.error}`);
  return r.data;
};

let { app, page } = await launch();
let fetchTotal = 0;
let sessionId;
try {
  const boot = await ipc(page, 'app:bootstrap');
  const s = boot.settings;
  check('Selected model is gemini-3.8-flash', s.model === 'gemini-3.8-flash', s.model);
  check('Engine is Gemini', s.provider === 'gemini', s.provider);
  check('Per-request limit is $0.10', s.maxCostPerRequestUsd === 0.1, s.maxCostPerRequestUsd);
  check('Automatic paid retries are disabled', s.autoRetry === false, s.autoRetry);
  check('Monthly allowance is $20', s.monthlyLimitUsd === 20 && boot.budget.limitUsd === 20, s.monthlyLimitUsd);
  check('Recorded spend carried over ($0.0047)', Math.abs(boot.budget.spentUsd - 0.0047325) < 1e-9, boot.budget.spentUsd);
  check('Instruction library intact (6 rules, 2 protected)', boot.rules.length === 6 && boot.rules.filter((r) => r.protected).length === 2, boot.rules.length);
  const sessions = await ipc(page, 'sessions:list', { projectId: null });
  sessionId = sessions[0]?.id;
  const d = sessionId && (await ipc(page, 'sessions:get', { id: sessionId }));
  check('Live-test prompt and its versions present', sessions.length === 1 && d.versions.length === 2 && d.versions[1].kind === 'generated', `${sessions.length} prompt(s), ${d?.versions.length} versions`);

  await ipc(page, 'key:set', { key: 'fake-key-for-offline-verification-0000' });
  const ok = await ipc(page, 'gen:preview', { sessionId, kind: 'generate', excerpts: [] });
  check('Normal request allowed under the limits (preview only, not sent)', ok.canRun && ok.worstCaseUsd <= 0.1, `worst case $${ok.worstCaseUsd.toFixed(4)}`);
  await ipc(page, 'settings:update', { maxOutputTokens: 32768 });
  const big = await ipc(page, 'gen:preview', { sessionId, kind: 'generate', excerpts: [] });
  check('$0.10 per-request safeguard blocks a costlier request', !big.canRun && /per-request limit/.test(big.blockReason), `worst case $${big.worstCaseUsd.toFixed(4)}`);
  await ipc(page, 'settings:update', { maxOutputTokens: 8192 });
} catch (e) {
  check('Unexpected error (first launch)', false, e.message);
}
fetchTotal += await app.evaluate(() => globalThis.__fetchCalls);
await app.close();

// Simulate a nearly used-up month in the copy, then confirm the allowance blocks generation.
{
  const db = new DatabaseSync(copyDb);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  db.prepare("INSERT INTO usage (id,generation_id,provider,model,input_tokens,output_tokens,thinking_tokens,cost_usd,estimated,month,created_at) VALUES (?,NULL,'gemini','simulated',0,0,0,19.99,0,?,?)").run(randomUUID(), month, now.toISOString());
  db.close();
}
({ app, page } = await launch());
try {
  const blocked = await ipc(page, 'gen:preview', { sessionId, kind: 'generate', excerpts: [] });
  check('$20 monthly allowance blocks generation when nearly used up', !blocked.canRun && /remains|used up/.test(blocked.blockReason), blocked.blockReason);
  check('Budget indicator shows critical level', (await page.locator('[data-testid=budget-meter].critical').count()) === 1);
} catch (e) {
  check('Unexpected error (second launch)', false, e.message);
}
fetchTotal += await app.evaluate(() => globalThis.__fetchCalls);
await app.close();
check('No network requests were made (no Gemini calls)', fetchTotal === 0, fetchTotal);

{
  const src = new DatabaseSync(realDb, { readOnly: true });
  const n = src.prepare('SELECT COUNT(*) n FROM usage').get().n;
  src.close();
  check('Real database unchanged (still 1 usage record)', n === 1, n);
}
rmSync(home, { recursive: true, force: true });
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
