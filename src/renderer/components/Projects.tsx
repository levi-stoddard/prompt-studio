import { useEffect, useState } from 'react';
import { call, fmtTime, type Folder, type Project } from '../api';
import { Modal } from './common';

export function ProjectModal({ project, onClose, onSaved, notify }: { project: Project | null; onClose(): void; onSaved(p: Project): void; notify(m: string, k?: 'info' | 'error' | 'ok'): void }) {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [current, setCurrent] = useState<Project | null>(project);

  useEffect(() => {
    if (current) call<Folder[]>('folders:list', { projectId: current.id }).then(setFolders);
  }, [current]);

  const save = async () => {
    try {
      if (current) {
        await call('projects:update', { id: current.id, name, description });
        const p = { ...current, name, description };
        setCurrent(p);
        onSaved(p);
      } else {
        const p = await call<Project>('projects:create', { name, description });
        setCurrent(p);
        onSaved(p);
      }
      notify('Project saved.', 'ok');
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  const addFolder = async () => {
    if (!current) return;
    const f = await call<Folder | null>('folders:add', { projectId: current.id });
    if (f) {
      setFolders(await call('folders:list', { projectId: current.id }));
      notify('Folder authorized for read-only access.', 'ok');
    }
  };

  return (
    <Modal title={current ? `Project: ${current.name}` : 'New project'} onClose={onClose} testId="project-modal">
      <div className="form-grid">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} data-testid="project-name" />
        <label>Description</label>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional. Not sent to Gemini." />
        <span />
        <div>
          <button className="btn primary" disabled={!name.trim()} onClick={save} data-testid="project-save">
            {current ? 'Save' : 'Create project'}
          </button>
        </div>
      </div>
      {current && (
        <>
          <h3>Authorized folders (read-only)</h3>
          <p className="hint">Prompt Studio can read these folders to let you attach excerpts to a prompt. It never modifies, renames, moves or deletes anything in them. Credentials, keys, .env files, databases and version-control folders are always blocked.</p>
          {folders.length === 0 && <div className="hint">No folders authorized.</div>}
          {folders.map((f) => (
            <div key={f.id} className="row folder-row" data-testid="folder-row">
              <span className="grow" title={f.path}>
                📁 {f.path}
              </span>
              <span className="meta">since {fmtTime(f.authorizedAt)}</span>
              <button className="link" onClick={() => call('folders:revoke', { folderId: f.id }).then(() => call<Folder[]>('folders:list', { projectId: current.id })).then(setFolders)}>
                Revoke
              </button>
            </div>
          ))}
          <button className="btn" onClick={addFolder} data-testid="folder-add">
            Authorize a folder…
          </button>
        </>
      )}
    </Modal>
  );
}
