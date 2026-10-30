import { useState } from 'react';
import { call, type Boot } from '../api';
import { ModeToggle, TargetChips } from './common';

export function Composer({ boot, projectId, onCreated, notify }: { boot: Boot; projectId: string | null; onCreated(id: string, generate: boolean): void; notify(m: string, k?: 'info' | 'error' | 'ok'): void }) {
  const [title, setTitle] = useState('');
  const [targetId, setTargetId] = useState(boot.targets[0]?.id ?? 'chatgpt');
  const [mode, setMode] = useState<'preserve' | 'challenge'>('preserve');
  const [original, setOriginal] = useState('');
  const project = boot.projects.find((p) => p.id === projectId);

  const create = async (generate: boolean) => {
    try {
      const id = await call<string>('sessions:create', { projectId, title, targetId, mode, original });
      onCreated(id, generate);
    } catch (e: any) {
      notify(e.message, 'error');
    }
  };

  return (
    <div className="composer" data-testid="composer">
      <h1>New prompt</h1>
      <p className="muted">
        {project ? (
          <>
            Project: <strong>{project.name}</strong> — project rules and authorized folders apply.
          </>
        ) : (
          <>General mode — only global and target-AI rules apply.</>
        )}
      </p>
      <label className="field-label">Which assistant is this prompt for?</label>
      <TargetChips targets={boot.targets} value={targetId} onChange={setTargetId} />
      <label className="field-label">How should Gemini optimize it?</label>
      <ModeToggle value={mode} onChange={setMode} />
      <label className="field-label">Your instruction, in your own words</label>
      <textarea className="original-input" value={original} onChange={(e) => setOriginal(e.target.value)} placeholder="Describe what you want the AI to do…" data-testid="original-input" />
      <input className="title-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional — defaults to the first line)" data-testid="title-input" />
      <div className="row">
        <button className="btn primary big" disabled={!original.trim()} onClick={() => create(true)} data-testid="create-generate">
          Create and generate
        </button>
        <button className="btn" disabled={!original.trim()} onClick={() => create(false)} data-testid="create-only">
          Create only{project ? ' (attach project files first)' : ''}
        </button>
      </div>
      <p className="hint">Your original text is saved unchanged. Every draft, edit and revision is kept as a separate version you can compare and restore.</p>
    </div>
  );
}
