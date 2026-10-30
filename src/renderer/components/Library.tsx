import { useEffect, useMemo, useState } from 'react';
import { call, fmtTime, type Boot, type Rule, type TargetProfile } from '../api';
import { Modal } from './common';

type Draft = { id?: string; scope: 'global' | 'project' | 'target'; projectId: string | null; targetId: string | null; category: string; title: string; body: string; protected: boolean };
const blank = (): Draft => ({ scope: 'global', projectId: null, targetId: null, category: 'General', title: '', body: '', protected: false });

export function LibraryModal({ boot, onClose, onRules, notify }: { boot: Boot; onClose(): void; onRules(r: Rule[]): void; notify(m: string, k?: 'info' | 'error' | 'ok'): void }) {
  const [tab, setTab] = useState<'rules' | 'targets'>('rules');
  const [rules, setRules] = useState<Rule[]>(boot.rules);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<{ version: number; title: string; body: string; protected: boolean; createdAt: string }[]>([]);
  const [filter, setFilter] = useState<'all' | 'global' | 'project' | 'target'>('all');

  const reload = async () => {
    const r = await call<Rule[]>('rules:list');
    setRules(r);
    onRules(r);
  };

  const edit = async (r: Rule) => {
    setDraft({ id: r.id, scope: r.scope, projectId: r.projectId, targetId: r.targetId, category: r.category, title: r.title, body: r.body, protected: r.protected });
    setHistory(await call('rules:history', { id: r.id }));
  };

  const save = async () => {
    if (!draft) return;
    try {
      const id = await call<string>('rules:save', draft);
      await reload();
      notify(draft.id ? 'Rule saved as a new version.' : 'Rule created.', 'ok');
      setDraft({ ...draft, id: id ?? draft.id });
      setHistory(await call('rules:history', { id: id ?? draft.id }));
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const scopeLabel = (r: Rule) =>
    r.scope === 'global' ? 'Global' : r.scope === 'project' ? `Project: ${boot.projects.find((p) => p.id === r.projectId)?.name ?? '?'}` : `Target: ${boot.targets.find((t) => t.id === r.targetId)?.name ?? '?'}`;

  const shown = useMemo(() => rules.filter((r) => filter === 'all' || r.scope === filter), [rules, filter]);

  return (
    <Modal title="Instruction Library" onClose={onClose} wide testId="library-modal">
      <div className="tabs">
        <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>
          Rules
        </button>
        <button className={tab === 'targets' ? 'on' : ''} onClick={() => setTab('targets')}>
          Target AI profiles
        </button>
        <div className="spacer" />
        <button className="btn small ghost" onClick={() => call<string | null>('export:library').then((p) => p && notify(`Library exported to ${p}`, 'ok'))}>
          Export library…
        </button>
      </div>
      {tab === 'rules' && (
        <div className="library">
          <div className="lib-list">
            <div className="row">
              <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
                <option value="all">All levels</option>
                <option value="global">Global</option>
                <option value="project">Project</option>
                <option value="target">Target AI</option>
              </select>
              <div className="spacer" />
              <button className="btn small primary" onClick={() => { setDraft(blank()); setHistory([]); }} data-testid="rule-new">
                New rule
              </button>
            </div>
            {shown.map((r) => (
              <div key={r.id} className={`lib-item ${draft?.id === r.id ? 'on' : ''} ${r.enabled ? '' : 'disabled'}`} onClick={() => edit(r)} data-testid="rule-item">
                <div className="row">
                  <input type="checkbox" checked={r.enabled} title={r.enabled ? 'Enabled' : 'Disabled'} onClick={(e) => e.stopPropagation()} onChange={(e) => call('rules:setEnabled', { id: r.id, enabled: e.target.checked }).then(reload)} />
                  <strong>{r.title}</strong>
                </div>
                <div className="meta">
                  {r.protected && <span className="tag prot">protected</span>} <span className="tag">{scopeLabel(r)}</span> <span className="tag">{r.category}</span> v{r.version}
                </div>
              </div>
            ))}
          </div>
          <div className="lib-edit">
            {!draft && <div className="hint">Select a rule to edit it, or create a new one. Rules are never deleted; disable a rule to stop applying it. Every edit is kept as a new version.</div>}
            {draft && (
              <>
                <div className="form-grid">
                  <label>Level</label>
                  <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as any })} data-testid="rule-scope">
                    <option value="global">Global — all prompts</option>
                    <option value="project">Project — one project only</option>
                    <option value="target">Target AI — one assistant only</option>
                  </select>
                  {draft.scope === 'project' && (
                    <>
                      <label>Project</label>
                      <select value={draft.projectId ?? ''} onChange={(e) => setDraft({ ...draft, projectId: e.target.value || null })}>
                        <option value="">Choose…</option>
                        {boot.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {draft.scope === 'target' && (
                    <>
                      <label>Target AI</label>
                      <select value={draft.targetId ?? ''} onChange={(e) => setDraft({ ...draft, targetId: e.target.value || null })} data-testid="rule-target">
                        <option value="">Choose…</option>
                        {boot.targets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <label>Category</label>
                  <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
                  <label>Title</label>
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="rule-title" />
                  <label>Rule text</label>
                  <textarea rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} data-testid="rule-body" />
                  <label>Protected</label>
                  <label className="inline">
                    <input type="checkbox" checked={draft.protected} onChange={(e) => setDraft({ ...draft, protected: e.target.checked })} data-testid="rule-protected" /> Appended word-for-word to every prompt it applies to; the optimizer may flag conflicts but can never change it.
                  </label>
                </div>
                <div className="row">
                  <button className="btn primary" disabled={!draft.title.trim() || !draft.body.trim()} onClick={save} data-testid="rule-save">
                    {draft.id ? 'Save as new version' : 'Create rule'}
                  </button>
                </div>
                {history.length > 0 && (
                  <>
                    <h4>Version history</h4>
                    {history.map((h) => (
                      <div key={h.version} className="version">
                        <strong>v{h.version}</strong> · {h.title} {h.protected && <span className="tag prot">protected</span>} <span className="meta">{fmtTime(h.createdAt)}</span>
                        <div className="meta">{h.body}</div>
                        <button className="link" onClick={() => setDraft({ ...draft, title: h.title, body: h.body, protected: h.protected })}>
                          Load this text into the editor
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {tab === 'targets' && <TargetsEditor targets={boot.targets} notify={notify} />}
    </Modal>
  );
}

function TargetsEditor({ targets, notify }: { targets: TargetProfile[]; notify(m: string, k?: 'info' | 'error' | 'ok'): void }) {
  const [list, setList] = useState(targets);
  const [edit, setEdit] = useState<Partial<TargetProfile> | null>(null);
  useEffect(() => setList(targets), [targets]);
  const save = async () => {
    try {
      const t = await call<TargetProfile>('targets:save', edit);
      setList((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [...l, t]));
      notify('Target profile saved.', 'ok');
      setEdit(t);
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };
  return (
    <div className="library">
      <div className="lib-list">
        <button className="btn small primary" onClick={() => setEdit({ name: '', url: 'https://', guidance: '', format: 'markdown' })}>
          Add target AI
        </button>
        {list.map((t) => (
          <div key={t.id} className={`lib-item ${edit?.id === t.id ? 'on' : ''}`} onClick={() => setEdit(t)}>
            <strong>{t.name}</strong>
            <div className="meta">{t.url}</div>
          </div>
        ))}
      </div>
      <div className="lib-edit">
        {edit && (
          <div className="form-grid">
            <label>Name</label>
            <input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <label>Web address</label>
            <input value={edit.url ?? ''} onChange={(e) => setEdit({ ...edit, url: e.target.value })} />
            <label>Format</label>
            <select value={edit.format} onChange={(e) => setEdit({ ...edit, format: e.target.value as any })}>
              <option value="markdown">Markdown headings</option>
              <option value="xml">XML-tagged sections</option>
            </select>
            <label>Formatting guidance</label>
            <textarea rows={8} value={edit.guidance ?? ''} onChange={(e) => setEdit({ ...edit, guidance: e.target.value })} />
            <span />
            <div>
              <button className="btn primary" onClick={save}>
                Save profile
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
