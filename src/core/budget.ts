import type { PriceEntry } from './pricing';
import type { Usage } from './types';

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthKey(d: Date): string {
  return localDate(d).slice(0, 7);
}

export function priceFor(table: PriceEntry[], model: string, on: Date): PriceEntry | null {
  const day = localDate(on);
  const candidates = table.filter((p) => p.model === model && p.effectiveFrom <= day).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return candidates[0] ?? null;
}

export function costOf(price: PriceEntry, usage: Usage): number {
  const long = price.longThreshold !== undefined && usage.inputTokens > price.longThreshold;
  const inRate = long ? (price.inputPerMLong ?? price.inputPerM) : price.inputPerM;
  const outRate = long ? (price.outputPerMLong ?? price.outputPerM) : price.outputPerM;
  return (usage.inputTokens * inRate + (usage.outputTokens + usage.thinkingTokens) * outRate) / 1_000_000;
}

/** Conservative token estimate (real English text averages ~4 characters per token). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

/**
 * Worst-case cost of one call: a generous input estimate plus every allowed output token.
 * Gemini's maxOutputTokens limits thinking and visible output combined, so it bounds both.
 */
export function worstCaseCost(price: PriceEntry, inputChars: number, maxOutputTokens: number): number {
  return costOf(price, { inputTokens: estimateTokens(inputChars), outputTokens: maxOutputTokens, thinkingTokens: 0 });
}

export type BudgetLevel = 'ok' | 'warn' | 'critical' | 'exhausted';

export interface BudgetStatus {
  month: string;
  limitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  fraction: number;
  level: BudgetLevel;
}

export function budgetStatus(month: string, limitUsd: number, spentUsd: number, warnAt = 0.75, criticalAt = 0.9): BudgetStatus {
  const fraction = limitUsd > 0 ? spentUsd / limitUsd : 1;
  const level: BudgetLevel = fraction >= 1 ? 'exhausted' : fraction >= criticalAt ? 'critical' : fraction >= warnAt ? 'warn' : 'ok';
  return { month, limitUsd, spentUsd, remainingUsd: Math.max(0, limitUsd - spentUsd), fraction, level };
}

export interface GateDecision {
  allowed: boolean;
  reason: string;
}

/** Decide whether a billable call may start. Blocks if the worst case could exceed the per-request limit or the allowance. */
export function gateBillableCall(status: BudgetStatus, worstCase: number, perRequestLimit = Infinity): GateDecision {
  if (worstCase > perRequestLimit) {
    return { allowed: false, reason: `Blocked: this request could cost up to $${worstCase.toFixed(3)}, above your per-request limit of $${perRequestLimit.toFixed(2)}. Lower the output limit, choose a cheaper model, or raise the per-request limit in Settings.` };
  }
  if (status.level === 'exhausted') {
    return { allowed: false, reason: `This month's Gemini allowance of $${status.limitUsd.toFixed(2)} is used up ($${status.spentUsd.toFixed(2)} recorded). Billable generation resumes on the 1st of next month, or if you raise the allowance in Settings.` };
  }
  if (status.spentUsd + worstCase > status.limitUsd) {
    return {
      allowed: false,
      reason: `Blocked: this request could cost up to $${worstCase.toFixed(3)}, but only $${status.remainingUsd.toFixed(3)} of the $${status.limitUsd.toFixed(2)} monthly allowance remains.`,
    };
  }
  return { allowed: true, reason: '' };
}
