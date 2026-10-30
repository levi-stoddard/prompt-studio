import { useEffect, useState } from 'react';
import { call, fmtTime, usd, type Boot, type BudgetStatus } from '../api';
import { Modal } from './common';

interface UsageRow {
  createdAt: string;
  model: string;
  kind: string | null;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
  estimated: boolean;
}

export function SettingsModal({ boot, onClose, onBoot, notify }: { boot: Boot; onClose(): void; onBoot(b: Boot): void; notify(m: string, k?: 'info' | 'error' | 'ok'): void }) {
  const s = boot.settings;
  const [key, setKey] = useState('');
  const [models, setModels] = useState<{ id: string; displayName: string; priced: boolean }[] | null>(null);
  const [model, setModel] = useState(s.model);
  const [limit, setLimit] = useState(String(s.monthlyLimitUsd));
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [prices, setPrices] = useState(JSON.stringify(s.prices, null, 1));
  const [busy, setBusy] = useState(false);

  const refreshBoot = async () => onBoot(await call<Boot>('app:bootstrap'));

  useEffect(() => {
    call<{ budget: BudgetStatus; usage: UsageRow[] }>('budget:get').then((r) => setUsage(r.usage));
  }, []);

  const update = async (patch: Record<string, unknown>, msg = 'Settings saved.') => {
    try {
      onBoot(await call<Boot>('settings:update', patch));
      notify(msg, 'ok');
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const saveKey = async () => {
    setBusy(true);
    try {
      await call('key:set', { key });
      setKey('');
      await refreshBoot();
      notify('API key saved, encrypted with Windows DPAPI.', 'ok');
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadModels = async () => {
    setBusy(true);
    try {
      setModels(await call('models:list'));
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const setBudget = async () => {
    const v = Number(limit);
    if (!Number.isFinite(v) || v < 0) return notify('Enter a valid amount.', 'error');
    const r = await call<{ changed: boolean }>('settings:setBudget', { limitUsd: v });
    await refreshBoot();
    notify(r.changed ? `Monthly allowance set to ${usd(v)}.` : 'Allowance unchanged.', r.changed ? 'ok' : 'info');
    if (!r.changed) setLimit(String(s.monthlyLimitUsd));
  };

  const priced = s.prices.some((p) => p.model === model);
  const sec = boot.security;
  const ok = (b: boolean) => <span className={b ? 'ok-text' : 'error-text'}>{b ? '✔' : '✘'}</span>;

  return (
    <Modal title="Settings" onClose={onClose} wide testId="settings-modal">
      <section>
        <h3>Optimizer engine</h3>
        <div className="radio-row">
          <label>
            <input type="radio" checked={s.provider === 'mock'} onChange={() => update({ provider: 'mock' }, 'Using the offline mock optimizer.')} data-testid="provider-mock" /> Offline mock (no network, no cost; for testing)
          </label>
          <label>
            <input type="radio" checked={s.provider === 'gemini'} onChange={() => update({ provider: 'gemini' }, 'Using Gemini.')} data-testid="provider-gemini" /> Google Gemini (billable; needs an API key)
          </label>
        </div>
      </section>

      <section>
        <h3>Gemini API key</h3>
        <p>
          Status: <strong data-testid="key-status">{boot.keyConfigured ? 'Configured — stored encrypted with Windows DPAPI on this account' : 'Not configured'}</strong>
          {!boot.secureStorage && <span className="error-text"> · Windows secure storage unavailable</span>}
        </p>
        <div className="row">
          <input type="password" className="grow" autoComplete="off" placeholder={boot.keyConfigured ? 'Paste a new key to replace the stored one' : 'Paste your Gemini API key'} value={key} onChange={(e) => setKey(e.target.value)} data-testid="key-input" />
          <button className="btn primary" disabled={!key || busy} onClick={saveKey} data-testid="key-save">
            Save key
          </button>
          {boot.keyConfigured && (
            <button className="btn ghost" onClick={() => call('key:clear').then(refreshBoot).then(() => notify('API key removed.', 'ok'))}>
              Remove key
            </button>
          )}
        </div>
        <p className="hint">The key is never shown again, never sent to this window, and never written to logs or exports.</p>
      </section>

      <section>
        <h3>Model</h3>
        <div className="row">
          <input className="grow" list="model-list" value={model} onChange={(e) => setModel(e.target.value)} data-testid="model-input" />
          <datalist id="model-list">
            {(models ?? s.prices.map((p) => ({ id: p.model, displayName: p.model, priced: true }))).map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </datalist>
          <button className="btn" onClick={() => update({ model: model.trim() }, `Model set to ${model.trim()}.`)} data-testid="model-save">
            Use model
          </button>
          <button className="btn ghost" disabled={!boot.keyConfigured || busy} onClick={loadModels} title="Lists the models your key can use. Listing models is not billed.">
            Load my available models
          </button>
        </div>
        {models && (
          <div className="model-grid">
            {models.map((m) => (
              <button key={m.id} className={`chip ${m.id === model ? 'on' : ''}`} onClick={() => setModel(m.id)} title={m.priced ? 'Price known' : 'No price configured — add one below before using'}>
                {m.id} {m.priced ? '' : '⚠'}
              </button>
            ))}
          </div>
        )}
        {!priced && <p className="error-text">No price is configured for “{model}”. Billable generation with it is blocked until you add one below.</p>}
      </section>

      <section>
        <h3>Per-request safeguards</h3>
        <div className="row">
          <label>
            Output limit (thinking + answer){' '}
            <input type="number" min={512} max={65536} step={512} defaultValue={s.maxOutputTokens} style={{ width: 100 }} onBlur={(e) => Number(e.target.value) !== s.maxOutputTokens && update({ maxOutputTokens: Number(e.target.value) })} data-testid="max-output" /> tokens
          </label>
          <label>
            Maximum cost per request $
            <input type="number" min={0.01} max={5} step={0.01} defaultValue={s.maxCostPerRequestUsd} style={{ width: 80 }} onBlur={(e) => Number(e.target.value) !== s.maxCostPerRequestUsd && update({ maxCostPerRequestUsd: Number(e.target.value) })} data-testid="max-cost" />
          </label>
        </div>
        <label className="inline">
          <input type="checkbox" checked={s.autoRetry} onChange={(e) => update({ autoRetry: e.target.checked }, e.target.checked ? 'Automatic retries on.' : 'Automatic retries off.')} data-testid="auto-retry" /> Automatically retry when Gemini is busy or rate-limited (up to 2 retries)
        </label>
        <p className="hint">Gemini counts thinking and the answer together against the output limit, so the worst case per request is the output limit × the model's output price, plus input. A request whose worst case exceeds the per-request maximum is refused before sending.</p>
      </section>

      <section>
        <h3>Monthly Gemini allowance</h3>
        <div className="row">
          <span>$</span>
          <input type="number" min={0} step={1} value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 100 }} data-testid="budget-input" />
          <button className="btn" onClick={setBudget}>
            Update allowance
          </button>
          <span>
            Recorded this month ({boot.budget.month}): <strong>{usd(boot.budget.spentUsd, 4)}</strong> of {usd(boot.budget.limitUsd)}
          </span>
        </div>
        <div className="note">
          Prompt Studio warns at 75% and 90%, and refuses to start any Gemini request whose worst-case cost could exceed what is left. Raising the allowance always asks for confirmation; the app never raises it on its own.
          <br />
          <strong>This is not an absolute ceiling on your Google bill.</strong> Google reports usage with a delay of up to about 10 minutes, other apps using the same key or project are not counted here, and prices can change. For a provider-side backstop, set a monthly spend cap for the project on the Spend page in Google AI Studio.
        </div>
        {usage.length > 0 && (
          <table className="usage">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Model</th>
                <th>Input</th>
                <th>Output+thinking</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u, i) => (
                <tr key={i}>
                  <td>{fmtTime(u.createdAt)}</td>
                  <td>{u.kind ?? '—'}</td>
                  <td>{u.model}</td>
                  <td>{u.inputTokens.toLocaleString()}</td>
                  <td>{(u.outputTokens + u.thinkingTokens).toLocaleString()}</td>
                  <td>
                    {usd(u.costUsd, 4)}
                    {u.estimated ? ' (est.)' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>Prices (USD per 1M tokens)</h3>
        <p className="hint">
          Paid-tier standard rates, verified on {boot.pricesVerifiedOn} from Google's pricing page. Thinking tokens are billed at the output rate. Entries with a later <code>effectiveFrom</code> take over on that date.
        </p>
        <textarea className="mono" rows={8} value={prices} onChange={(e) => setPrices(e.target.value)} />
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              try {
                void update({ prices: JSON.parse(prices) }, 'Prices saved.');
              } catch {
                notify('Prices must be valid JSON.', 'error');
              }
            }}
          >
            Save prices
          </button>
          <button className="btn ghost" onClick={() => call('external:openHelp', { topic: 'pricing' })}>
            Open Google pricing page
          </button>
        </div>
      </section>

      <section>
        <h3>Setting up paid Gemini access</h3>
        <ol className="steps">
          <li>In Google AI Studio, create a new project dedicated to Prompt Studio, so its usage stays separate from other tools.</li>
          <li>On that project, choose “Set up billing”: link a Cloud Billing account and prepay credits (minimum $5). Paid-tier prompts are not used to improve Google's products; free-tier prompts may be.</li>
          <li>On the Spend page, set the project's monthly spend cap (for example $20) as a backstop.</li>
          <li>Create an API key in that project, then paste it above. Do not paste it into any chat.</li>
        </ol>
        <div className="row">
          <button className="btn ghost" onClick={() => call('external:openHelp', { topic: 'aistudio' })}>Open AI Studio</button>
          <button className="btn ghost" onClick={() => call('external:openHelp', { topic: 'apikeys' })}>API keys page</button>
          <button className="btn ghost" onClick={() => call('external:openHelp', { topic: 'billing' })}>Billing guide</button>
          <button className="btn ghost" onClick={() => call('external:openHelp', { topic: 'terms' })}>Terms (data use)</button>
        </div>
      </section>

      <section>
        <h3>Data and backups</h3>
        <div className="kv">
          <span>Data folder</span>
          <span>{boot.paths.home}</span>
          <span>Database</span>
          <span>{boot.paths.db}</span>
          <span>Backups</span>
          <span>
            {boot.paths.backups} — latest: {boot.backups[0] ?? 'none yet'}
          </span>
        </div>
        <div className="row">
          <button className="btn" onClick={() => call<string>('backup:now', { chooseLocation: false }).then((p) => { notify(`Backup saved: ${p}`, 'ok'); return refreshBoot(); }).catch((e) => notify(e.message, 'error'))} data-testid="backup-now">
            Back up now
          </button>
          <button className="btn ghost" onClick={() => call<string | null>('backup:now', { chooseLocation: true }).then((p) => p && notify(`Backup copy saved: ${p}`, 'ok')).catch((e) => notify(e.message, 'error'))}>
            Save a backup copy elsewhere…
          </button>
          <button className="btn ghost" onClick={() => call('folder:openData')}>
            Open data folder
          </button>
        </div>
        <p className="hint">A snapshot is taken automatically on the first launch of each day. Backups are never deleted by the app.</p>
      </section>

      <section data-testid="security-status">
        <h3>Security status (measured in this window)</h3>
        <ul className="sec">
          <li>{ok(sec.sandbox)} Renderer sandbox</li>
          <li>{ok(sec.contextIsolation)} Context isolation</li>
          <li>{ok(!sec.nodeIntegration)} No Node.js access in the window</li>
          <li>{ok(sec.bridge.length === 1 && sec.bridge[0] === 'invoke')} Bridge exposes only <code>invoke</code> over {sec.ipcChannels} allow-listed channels</li>
          <li>{ok(!sec.webviewTag)} Webview tag disabled</li>
          <li>{ok(true)} {sec.rendererNetwork}</li>
          <li>{ok(sec.packaged ? !sec.devTools : true)} Developer tools {sec.devTools ? 'enabled (development build)' : 'disabled'}</li>
        </ul>
        <p className="hint">
          Electron {sec.electron} · Chromium {sec.chrome} · Prompt Studio {boot.appVersion} {sec.packaged ? '(installed build)' : '(development build)'}
        </p>
      </section>
    </Modal>
  );
}
