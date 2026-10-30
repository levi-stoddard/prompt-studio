import { randomUUID } from 'node:crypto';
import { buildGeneratePayload, buildRevisePayload, payloadChars } from '../core/assemble';
import { budgetStatus, costOf, gateBillableCall, monthKey, priceFor, worstCaseCost, type BudgetStatus } from '../core/budget';
import { missingProtected, selectRules, withBindingBlock, applyRecommendation } from '../core/rules';
import { scanSecrets } from '../core/secrets';
import { ProviderError, type AppliedRule, type ContextExcerpt, type LlmProvider, type Mode, type PromptPayload, type ProviderId, type GenerateRequest, type ReviseRequest, type TargetProfile, type Usage } from '../core/types';
import type { PriceEntry } from '../core/pricing';
import { sha256, type Store } from './db';
import type { Excerpt } from './projectFs';

export interface Pick {
  folderId: string;
  relPath: string;
}

export interface PreviewInput {
  sessionId: string;
  kind: 'generate' | 'revise';
  excerpts: Pick[];
  instruction?: string;
  selection?: { start: number; end: number } | null;
}

export interface PreviewSummary {
  previewId: string;
  kind: 'generate' | 'revise';
  provider: ProviderId;
  model: string;
  billable: boolean;
  targetName: string;
  mode: Mode;
  rules: { title: string; scope: string; protected: boolean; version: number }[];
  excerpts: { label: string; chars: number; text: string; truncated: boolean }[];
  commentCount: number;
  requestChars: number;
  worstCaseUsd: number;
  budget: BudgetStatus;
  canRun: boolean;
  blockReason: string;
  secretFindings: { where: string; type: string }[];
}

export interface RunResult {
  status: 'ok' | 'error' | 'blocked';
  message: string;
  versionId?: string;
}

interface Prepared {
  summary: PreviewSummary;
  sessionId: string;
  kind: 'generate' | 'revise';
  target: TargetProfile;
  rules: AppliedRule[];
  payload: PromptPayload;
  req: GenerateRequest | ReviseRequest;
  excerpts: ContextExcerpt[];
  price: PriceEntry | null;
  workingSha: string;
  selection: { start: number; end: number } | null;
  createdAt: number;
}

export interface GenerationDeps {
  store: Store;
  /** Returns null for gemini when no API key is configured. */
  providerFor: (id: ProviderId) => LlmProvider | null;
  readExcerpt: (root: string, rel: string, charLimit: number) => Promise<Excerpt>;
  now?: () => Date;
  log?: (level: 'info' | 'warn' | 'error', event: string, meta?: Record<string, unknown>) => void;
}

const PREVIEW_TTL_MS = 15 * 60 * 1000;

export function currentBudget(store: Store, now: Date): BudgetStatus {
  const s = store.getSettings();
  const month = monthKey(now);
  return budgetStatus(month, s.monthlyLimitUsd, store.monthSpent(month), s.warnAt, s.criticalAt);
}

export class GenerationService {
  private pending = new Map<string, Prepared>();
  private running = false;
  private readonly now: () => Date;
  private readonly log: NonNullable<GenerationDeps['log']>;

  constructor(private readonly deps: GenerationDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
  }

  rulesFor(sessionId: string): AppliedRule[] {
    const s = this.deps.store.sessionRow(sessionId);
    return selectRules(this.deps.store.listRules(), s.project_id, s.target_id);
  }

  async preview(input: PreviewInput): Promise<PreviewSummary> {
    const { store } = this.deps;
    const session = store.sessionRow(input.sessionId);
    const settings = store.getSettings();
    const target = store.getTarget(session.target_id);
    if (!target) throw new Error('Target AI profile not found.');
    const project = session.project_id ? store.getProject(session.project_id) : null;
    const rules = selectRules(store.listRules(), session.project_id, session.target_id);
    const original = store.versions(input.sessionId)[0].text;
    const working: string = session.working_text;

    // Project excerpts: only from folders authorized for this prompt's own project.
    const excerpts: ContextExcerpt[] = [];
    const excerptInfo: PreviewSummary['excerpts'] = [];
    const findings: PreviewSummary['secretFindings'] = [];
    for (const pick of input.excerpts) {
      const folder = store.getFolder(pick.folderId);
      if (!folder || folder.projectId !== session.project_id) throw new Error('That folder is not authorized for this project.');
      const ex = await this.deps.readExcerpt(folder.path, pick.relPath, settings.excerptCharLimit);
      const folderName = folder.path.split(/[\\/]/).filter(Boolean).pop() ?? 'folder';
      const label = `${folderName}/${pick.relPath}`;
      excerpts.push({ label, text: ex.text });
      excerptInfo.push({ label, chars: ex.text.length, text: ex.text, truncated: ex.truncated });
      for (const f of ex.findings) findings.push({ where: label, type: f.type });
    }

    let req: GenerateRequest | ReviseRequest;
    let payload: PromptPayload;
    let selection: { start: number; end: number } | null = null;
    let commentCount = 0;
    const base = { original, mode: session.mode as Mode, target, rules, excerpts, projectName: project?.name ?? null };
    if (input.kind === 'generate') {
      req = base;
      payload = buildGeneratePayload(req);
    } else {
      if (input.selection && input.selection.end > input.selection.start && input.selection.end <= working.length) selection = input.selection;
      const selText = selection ? working.slice(selection.start, selection.end) : '';
      const open = store.comments(input.sessionId).filter((c) => c.status === 'open');
      const relevant = selection ? open.filter((c) => selText.includes(c.quote) || c.quote.includes(selText)) : open;
      commentCount = relevant.length;
      req = { ...base, current: working, comments: relevant.map((c) => ({ quote: c.quote, body: c.body })), instruction: input.instruction?.trim() ?? '', selection: selection ? { ...selection, text: selText } : null };
      payload = buildRevisePayload(req);
      if (relevant.length === 0 && !req.instruction) throw new Error('Add a comment or type a revision instruction first.');
    }

    // Never send credentials: scan everything that would leave the computer.
    for (const f of scanSecrets(payload.user)) if (!findings.some((x) => x.type === f.type)) findings.push({ where: 'prompt text or comments', type: f.type });
    for (const r of rules) for (const f of scanSecrets(r.body)) findings.push({ where: `rule "${r.title}"`, type: f.type });

    const providerId = settings.provider;
    const billable = providerId === 'gemini';
    const provider = this.deps.providerFor(providerId);
    const model = billable ? settings.model : 'mock-optimizer';
    const requestChars = payloadChars(payload);
    const price = billable ? priceFor(settings.prices, model, this.now()) : null;
    const worstCaseUsd = price ? worstCaseCost(price, requestChars, settings.maxOutputTokens) : 0;
    const budget = currentBudget(store, this.now());

    let blockReason = '';
    if (findings.length) blockReason = `Possible credentials detected (${findings.map((f) => `${f.type} in ${f.where}`).join('; ')}). Remove them before generating.`;
    else if (!provider) blockReason = 'No Gemini API key is configured. Add one in Settings, or switch to the offline mock.';
    else if (billable && !price) blockReason = `No price is configured for model "${model}", so its cost cannot be tracked. Add a price in Settings.`;
    else if (billable) {
      const gate = gateBillableCall(budget, worstCaseUsd, settings.maxCostPerRequestUsd);
      if (!gate.allowed) blockReason = gate.reason;
    }

    const summary: PreviewSummary = {
      previewId: randomUUID(),
      kind: input.kind,
      provider: providerId,
      model,
      billable,
      targetName: target.name,
      mode: session.mode,
      rules: rules.map((r) => ({ title: r.title, scope: r.scope, protected: r.protected, version: r.version })),
      excerpts: excerptInfo,
      commentCount,
      requestChars,
      worstCaseUsd,
      budget,
      canRun: blockReason === '',
      blockReason,
      secretFindings: findings,
    };
    if (blockReason) {
      // Blocked attempts are kept in the audit log even though nothing is sent.
      store.insertGeneration({ sessionId: input.sessionId, kind: input.kind, provider: providerId, model, mode: session.mode, targetId: target.id, status: 'blocked', error: blockReason, requestChars, worstCaseUsd, rules });
      this.log('warn', 'generation.blocked', { reason: findings.length ? 'secrets' : !provider ? 'no_key' : !price && billable ? 'no_price' : 'budget' });
    }
    this.prune();
    this.pending.set(summary.previewId, { summary, sessionId: input.sessionId, kind: input.kind, target, rules, payload, req, excerpts, price, workingSha: sha256(working), selection, createdAt: Date.now() });
    return summary;
  }

  private prune(): void {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [k, v] of this.pending) if (v.createdAt < cutoff) this.pending.delete(k);
  }

  async run(previewId: string): Promise<RunResult> {
    const p = this.pending.get(previewId);
    this.pending.delete(previewId);
    if (!p) return { status: 'error', message: 'This preview expired. Please press Generate again.' };
    if (this.running) return { status: 'error', message: 'Another generation is already running.' };
    const { store } = this.deps;
    const settings = store.getSettings();
    const s = p.summary;

    const record = (status: string, error: string) =>
      store.insertGeneration({ sessionId: p.sessionId, kind: p.kind, provider: s.provider, model: s.model, mode: s.mode, targetId: p.target.id, status, error, requestChars: s.requestChars, worstCaseUsd: s.worstCaseUsd, rules: p.rules });

    if (!s.canRun) return { status: 'blocked', message: s.blockReason };
    if (s.provider !== settings.provider || (s.billable && s.model !== settings.model)) return { status: 'error', message: 'Settings changed since the preview. Please press Generate again.' };
    if (sha256(store.sessionRow(p.sessionId).working_text) !== p.workingSha) return { status: 'error', message: 'The draft changed since the preview. Please try again.' };

    // Re-check the allowance at the moment of sending.
    if (s.billable) {
      const gate = gateBillableCall(currentBudget(store, this.now()), s.worstCaseUsd, settings.maxCostPerRequestUsd);
      if (!gate.allowed) {
        record('blocked', gate.reason);
        this.log('warn', 'generation.blocked', { reason: 'budget' });
        return { status: 'blocked', message: gate.reason };
      }
    }
    const provider = this.deps.providerFor(s.provider);
    if (!provider) return { status: 'blocked', message: 'No Gemini API key is configured.' };

    this.running = true;
    store.checkpoint(p.sessionId, 'Manual edit (saved before generation)');
    const genId = record('running', '');
    if (s.billable) {
      store.addTransmission(genId, 'instruction', 'System instruction, original prompt, rules and comments', p.payload.system + p.payload.user);
      for (const e of p.excerpts) store.addTransmission(genId, 'project_excerpt', e.label, e.text);
    }
    const month = monthKey(this.now());
    const recordUsage = (usage: Usage | null, model: string) => {
      if (s.billable && p.price) {
        const estimated = usage === null;
        const u = usage ?? { inputTokens: Math.ceil(s.requestChars / 3), outputTokens: settings.maxOutputTokens, thinkingTokens: 0 };
        store.addUsage({ generationId: genId, provider: 'gemini', model, ...u, costUsd: estimated ? s.worstCaseUsd : costOf(p.price, u), estimated, month });
      } else if (usage) {
        store.addUsage({ generationId: genId, provider: 'mock', model, ...usage, costUsd: 0, estimated: false, month });
      }
    };

    try {
      if (p.kind === 'generate') {
        const res = await provider.generate(p.req as GenerateRequest, p.payload, s.model);
        recordUsage(res.usage, res.model);
        const text = withBindingBlock(res.data.optimizedPrompt, p.rules, p.target);
        const v = store.addVersion(p.sessionId, 'generated', text, `Generated (${s.mode === 'challenge' ? 'Challenge & Redesign' : 'Preserve Intent'}) by ${res.model}`, genId);
        if (s.mode === 'challenge') store.addRecommendations(genId, p.sessionId, res.data.recommendations);
        store.finishGeneration(genId, { status: 'ok', outputVersionId: v.id, changes: res.data.changes, conflicts: res.data.conflicts, questions: res.data.questions });
        this.log('info', 'generation.ok', { kind: p.kind, provider: s.provider, model: res.model, recs: res.data.recommendations.length });
        return { status: 'ok', message: 'Draft generated.', versionId: v.id };
      }
      const req = p.req as ReviseRequest;
      const res = await provider.revise(req, p.payload, s.model);
      recordUsage(res.usage, res.model);
      const merged = p.selection ? req.current.slice(0, p.selection.start) + res.data.revisedText + req.current.slice(p.selection.end) : res.data.revisedText;
      const text = withBindingBlock(merged, p.rules, p.target);
      const v = store.addVersion(p.sessionId, 'revision', text, p.selection ? 'Revised selected passage' : 'Revised whole prompt', genId);
      store.finishGeneration(genId, { status: 'ok', outputVersionId: v.id, changes: res.data.changes, conflicts: res.data.conflicts });
      this.log('info', 'generation.ok', { kind: p.kind, provider: s.provider, model: res.model });
      return { status: 'ok', message: 'Revision created.', versionId: v.id };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError(String((e as Error)?.message ?? e), 'unknown', false);
      if (pe.usage) recordUsage(pe.usage, s.model);
      store.finishGeneration(genId, { status: 'error', error: pe.message });
      this.log('error', 'generation.error', { kind: p.kind, provider: s.provider, code: pe.code });
      return { status: 'error', message: pe.message };
    } finally {
      this.running = false;
    }
  }

  acceptRecommendation(recId: string): string {
    const { store } = this.deps;
    const rec = store.getRecommendation(recId);
    if (rec.status !== 'pending') throw new Error('This recommendation was already decided.');
    store.checkpoint(rec.sessionId, 'Manual edit (saved before accepting recommendation)');
    const working = store.sessionRow(rec.sessionId).working_text;
    const v = store.addVersion(rec.sessionId, 'accepted', applyRecommendation(working, rec.findText, rec.replacementText), `Accepted recommendation: ${rec.title}`, null);
    store.decideRecommendation(recId, 'accepted');
    return v.id;
  }

  approve(sessionId: string, force: boolean): { approved: boolean; missing: string[]; versionId?: string } {
    const { store } = this.deps;
    const working = store.sessionRow(sessionId).working_text;
    const missing = missingProtected(working, this.rulesFor(sessionId)).map((r) => r.title);
    if (missing.length && !force) return { approved: false, missing };
    const v = store.approve(sessionId, missing);
    return { approved: true, missing, versionId: v.id };
  }
}
