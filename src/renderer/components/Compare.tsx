import { useMemo, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import { KIND_LABEL, fmtTime, type Version } from '../api';

interface Props {
  versions: Version[];
  workingText: string;
  onRestore(versionId: string): void;
  readOnly: boolean;
  initialLeft?: string;
}

const CURRENT = '__current__';

export function Compare({ versions, workingText, onRestore, readOnly, initialLeft }: Props) {
  const [left, setLeft] = useState(initialLeft ?? versions[Math.max(0, versions.length - 2)]?.id ?? CURRENT);
  const [right, setRight] = useState(CURRENT);
  const textOf = (id: string) => (id === CURRENT ? workingText : (versions.find((v) => v.id === id)?.text ?? ''));
  const parts = useMemo(() => diffWordsWithSpace(textOf(left), textOf(right)), [left, right, versions, workingText]);
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const p of parts) {
      const words = p.value.split(/\s+/).filter(Boolean).length;
      if (p.added) added += words;
      else if (p.removed) removed += words;
    }
    return { added, removed };
  }, [parts]);

  const options = (
    <>
      <option value={CURRENT}>Current draft (working copy)</option>
      {[...versions].reverse().map((v) => (
        <option key={v.id} value={v.id}>
          v{v.seq} · {KIND_LABEL[v.kind] ?? v.kind} · {fmtTime(v.createdAt)}
        </option>
      ))}
    </>
  );

  return (
    <div className="compare" data-testid="compare">
      <div className="compare-bar">
        <label>
          Left
          <select value={left} onChange={(e) => setLeft(e.target.value)} data-testid="compare-left">
            {options}
          </select>
        </label>
        <span className="compare-stats">
          <span className="add">+{stats.added}</span> <span className="del">−{stats.removed}</span> words
        </span>
        <label>
          Right
          <select value={right} onChange={(e) => setRight(e.target.value)} data-testid="compare-right">
            {options}
          </select>
        </label>
      </div>
      <div className="compare-cols">
        <div className="compare-col">
          <div className="compare-col-head">
            <span>{left === CURRENT ? 'Current draft' : `Version ${versions.find((v) => v.id === left)?.seq}`}</span>
            {left !== CURRENT && !readOnly && (
              <button className="btn small" onClick={() => onRestore(left)} data-testid="restore-left">
                Restore this version
              </button>
            )}
          </div>
          <pre>
            {parts.map((p, i) => (p.added ? null : <span key={i} className={p.removed ? 'diff-del' : ''}>{p.value}</span>))}
          </pre>
        </div>
        <div className="compare-col">
          <div className="compare-col-head">
            <span>{right === CURRENT ? 'Current draft' : `Version ${versions.find((v) => v.id === right)?.seq}`}</span>
            {right !== CURRENT && !readOnly && (
              <button className="btn small" onClick={() => onRestore(right)}>
                Restore this version
              </button>
            )}
          </div>
          <pre>
            {parts.map((p, i) => (p.removed ? null : <span key={i} className={p.added ? 'diff-add' : ''}>{p.value}</span>))}
          </pre>
        </div>
      </div>
    </div>
  );
}
