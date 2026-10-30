import type { ReactNode } from 'react';
import { usd, type BudgetStatus, type TargetProfile } from '../api';

export function TargetChips({ targets, value, onChange, disabled }: { targets: TargetProfile[]; value: string; onChange(id: string): void; disabled?: boolean }) {
  return (
    <div className="chips" role="radiogroup" aria-label="Target AI">
      <span className="chips-label">Target</span>
      {targets.map((t) => (
        <button key={t.id} role="radio" aria-checked={value === t.id} className={`chip ${value === t.id ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(t.id)} data-testid={`target-${t.id}`}>
          {t.name}
        </button>
      ))}
    </div>
  );
}

export const MODE_INFO = {
  preserve: { name: 'Preserve Intent', desc: 'Improves clarity, structure and precision. Keeps your objective, constraints and approval requirements exactly as stated.' },
  challenge: { name: 'Challenge & Redesign', desc: 'Also evaluates your objective and proposes alternatives. Proposals are listed separately and only enter the prompt if you accept them.' },
} as const;

export function ModeToggle({ value, onChange, disabled, compact }: { value: 'preserve' | 'challenge'; onChange(m: 'preserve' | 'challenge'): void; disabled?: boolean; compact?: boolean }) {
  return (
    <div className={`mode-toggle ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="Optimization mode">
      {(['preserve', 'challenge'] as const).map((m) => (
        <button key={m} role="radio" aria-checked={value === m} className={`mode ${m} ${value === m ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(m)} title={MODE_INFO[m].desc} data-testid={`mode-${m}`}>
          <strong>{MODE_INFO[m].name}</strong>
          {!compact && <span>{MODE_INFO[m].desc}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide, footer, testId }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; footer?: ReactNode; testId?: string }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} data-testid={testId}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function BudgetMeter({ budget, provider, onClick }: { budget: BudgetStatus; provider: string; onClick(): void }) {
  const pct = Math.min(100, Math.round(budget.fraction * 100));
  const label = budget.level === 'exhausted' ? 'Allowance used up' : budget.level === 'critical' ? 'Over 90% used' : budget.level === 'warn' ? 'Over 75% used' : 'Within allowance';
  return (
    <button className={`budget ${budget.level}`} onClick={onClick} title={`Gemini spend recorded by Prompt Studio for ${budget.month}. ${label}.`} data-testid="budget-meter">
      <span>Gemini {budget.month}</span>
      <span className="bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span data-testid="budget-text">
        {usd(budget.spentUsd)} / {usd(budget.limitUsd)}
      </span>
      {budget.level !== 'ok' && <span className="budget-flag">{label}</span>}
      {provider === 'mock' && <span className="muted">· mock mode (no cost)</span>}
    </button>
  );
}
