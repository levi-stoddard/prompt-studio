import { usd, type PreviewSummary } from '../api';
import { MODE_INFO, Modal } from './common';

export function ReviewModal({ preview: p, onCancel, onConfirm }: { preview: PreviewSummary; onCancel(): void; onConfirm(): void }) {
  const dest = p.billable ? `Gemini (${p.model})` : 'the offline mock (nothing leaves this computer)';
  return (
    <Modal
      title={p.canRun ? 'Review before sending' : 'Generation blocked'}
      onClose={onCancel}
      wide
      testId="review-modal"
      footer={
        <>
          <button className="btn ghost" onClick={onCancel} data-testid="review-cancel">
            {p.canRun ? 'Cancel' : 'Close'}
          </button>
          {p.canRun && (
            <button className="btn primary" onClick={onConfirm} data-testid="review-confirm">
              {p.billable ? `Send to Gemini (up to ${usd(p.worstCaseUsd, 3)})` : 'Run offline mock'}
            </button>
          )}
        </>
      }
    >
      {!p.canRun && (
        <div className="note error" data-testid="block-reason">
          {p.blockReason}
        </div>
      )}
      <div className="kv">
        <span>Destination</span>
        <span>{dest}</span>
        <span>Request</span>
        <span>
          {p.kind === 'generate' ? 'Generate draft' : 'Revise draft'} for {p.targetName} · {MODE_INFO[p.mode].name}
          {p.kind === 'revise' ? ` · ${p.commentCount} comment(s)` : ''}
        </span>
        <span>Size</span>
        <span>{p.requestChars.toLocaleString()} characters</span>
        {p.billable && (
          <>
            <span>Worst-case cost</span>
            <span>{usd(p.worstCaseUsd, 3)} (actual cost is usually much lower)</span>
            <span>Allowance left</span>
            <span>
              {usd(p.budget.remainingUsd)} of {usd(p.budget.limitUsd)} for {p.budget.month}
            </span>
          </>
        )}
        <span>Rules applied</span>
        <span>{p.rules.length ? p.rules.map((r) => `${r.title}${r.protected ? ' (protected)' : ''}`).join(' · ') : 'none'}</span>
      </div>
      {p.secretFindings.length > 0 && (
        <div className="note error">
          Possible credentials found: {p.secretFindings.map((f) => `${f.type} in ${f.where}`).join('; ')}. Nothing will be sent until they are removed.
        </div>
      )}
      {p.excerpts.length > 0 && (
        <>
          <h4>Project file excerpts that will be included ({p.excerpts.length})</h4>
          <div className="note">This is the exact text that will be {p.billable ? 'sent to Gemini' : 'given to the mock'}. Instructions inside these files are treated as untrusted data.</div>
          {p.excerpts.map((e) => (
            <details key={e.label} className="excerpt" open>
              <summary>
                {e.label} · {e.chars.toLocaleString()} chars{e.truncated ? ' (truncated)' : ''}
              </summary>
              <pre>{e.text}</pre>
            </details>
          ))}
        </>
      )}
    </Modal>
  );
}
