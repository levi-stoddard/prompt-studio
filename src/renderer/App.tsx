import { useCallback, useEffect, useState } from 'react';
import { call, fmtTime, type Boot, type BudgetStatus, type SessionSummary } from './api';
import { BudgetMeter } from './components/common';
import { Composer } from './components/Composer';
import { LibraryModal } from './components/Library';
import { ProjectModal } from './components/Projects';
import { SessionView } from './components/Session';
import { SettingsModal } from './components/Settings';

type Toast = { id: number; msg: string; kind: 'info' | 'error' | 'ok' };
const GENERAL = '__general__';

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState<string>(GENERAL);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [current, setCurrent] = useState<string | 'new'>('new');
  const [autoGen, setAutoGen] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'settings' | 'library' | 'project' | 'project-new'>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState('');

  const projectId = projectKey === GENERAL ? null : projectKey;

  const notify = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4500);
  }, []);

  const reloadBoot = useCallback(async () => {
    try {
      setBoot(await call<Boot>('app:bootstrap'));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const reloadSessions = useCallback(async () => {
    setSessions(await call<SessionSummary[]>('sessions:list', { projectId }));
  }, [projectId]);

  const refreshBudget = useCallback(async () => {
    const r = await call<{ budget: BudgetStatus }>('budget:get');
    setBoot((b) => (b ? { ...b, budget: r.budget } : b));
  }, []);

  useEffect(() => {
    void reloadBoot();
  }, [reloadBoot]);

  useEffect(() => {
    reloadSessions().catch((e) => notify(e.message, 'error'));
    setCurrent('new');
  }, [reloadSessions, notify]);

  if (error) return <div className="fatal">Prompt Studio could not load: {error}</div>;
  if (!boot) return <div className="empty">Loading Prompt Studio…</div>;

  const project = boot.projects.find((p) => p.id === projectId) ?? null;
  const shown = sessions.filter((s) => !search || s.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">◆</span> Prompt Studio
        </div>
        <label className="side-label">Workspace</label>
        <div className="row">
          <select className="grow" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} data-testid="project-select">
            <option value={GENERAL}>General</option>
            {boot.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {project && (
            <button className="btn small ghost" title="Project settings and folders" onClick={() => setModal('project')} data-testid="project-settings">
              ⚙
            </button>
          )}
          <button className="btn small ghost" title="New project" onClick={() => setModal('project-new')} data-testid="project-new">
            ＋
          </button>
        </div>
        <button className="btn primary block" onClick={() => setCurrent('new')} data-testid="new-prompt">
          ＋ New prompt
        </button>
        <input className="search" placeholder="Search prompts…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="session-list" data-testid="session-list">
          {shown.length === 0 && <div className="hint">No prompts yet.</div>}
          {shown.map((s) => (
            <button key={s.id} className={`session-item ${current === s.id ? 'on' : ''}`} onClick={() => setCurrent(s.id)} data-testid="session-item">
              <span className="t">{s.title}</span>
              <span className="meta">
                {boot.targets.find((t) => t.id === s.targetId)?.name} · {s.mode === 'challenge' ? 'Challenge' : 'Preserve'} · {s.status === 'approved' ? '✔ approved' : 'draft'} · {fmtTime(s.updatedAt)}
              </span>
            </button>
          ))}
        </div>
        <div className="side-foot">
          <button className="btn ghost block" onClick={() => setModal('library')} data-testid="open-library">
            Instruction Library
          </button>
          <button className="btn ghost block" onClick={() => setModal('settings')} data-testid="open-settings">
            Settings
          </button>
        </div>
      </aside>

      <main className="main">
        {current === 'new' ? (
          <Composer
            key={projectKey}
            boot={boot}
            projectId={projectId}
            notify={notify}
            onCreated={async (id, generate) => {
              await reloadSessions();
              setAutoGen(generate ? id : null);
              setCurrent(id);
            }}
          />
        ) : (
          <SessionView key={current} boot={boot} sessionId={current} onChanged={reloadSessions} notify={notify} onBudgetChanged={refreshBudget} autoGenerate={autoGen === current} onAutoGenerated={() => setAutoGen(null)} />
        )}
      </main>

      <footer className="status">
        <BudgetMeter budget={boot.budget} provider={boot.settings.provider} onClick={() => setModal('settings')} />
        <span className="muted">{boot.settings.provider === 'gemini' ? (boot.keyConfigured ? `Gemini key configured · ${boot.settings.model}` : 'Gemini selected, but no API key is configured') : 'Offline mock optimizer'}</span>
        <div className="spacer" />
        <span className="muted" title="All data is stored locally">
          Local data: {boot.paths.home}
        </span>
      </footer>

      <div className="toasts" data-testid="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} data-testid={`toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>

      {modal === 'settings' && <SettingsModal boot={boot} onBoot={setBoot} onClose={() => setModal(null)} notify={notify} />}
      {modal === 'library' && (
        <LibraryModal
          boot={boot}
          onRules={(rules) => setBoot((b) => (b ? { ...b, rules } : b))}
          onClose={() => {
            setModal(null);
            void reloadBoot();
          }}
          notify={notify}
        />
      )}
      {(modal === 'project' || modal === 'project-new') && (
        <ProjectModal
          project={modal === 'project' ? project : null}
          onClose={() => setModal(null)}
          notify={notify}
          onSaved={async (p) => {
            await reloadBoot();
            setProjectKey(p.id);
          }}
        />
      )}
    </div>
  );
}
