import type { AppliedRule, Rule, TargetProfile } from './types';

const SCOPE_ORDER = { global: 0, project: 1, target: 2 } as const;

/**
 * Enabled rules that apply to a prompt, in precedence order:
 * protected rules first, then global, project and target-AI rules.
 * Rules of another project are never included (project separation).
 */
export function selectRules(all: Rule[], projectId: string | null, targetId: string): AppliedRule[] {
  return all
    .filter((r) => r.enabled)
    .filter(
      (r) =>
        r.scope === 'global' ||
        (r.scope === 'project' && projectId !== null && r.projectId === projectId) ||
        (r.scope === 'target' && r.targetId === targetId),
    )
    .sort((a, b) => {
      if (a.protected !== b.protected) return a.protected ? -1 : 1;
      if (a.scope !== b.scope) return SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
      return a.title.localeCompare(b.title);
    })
    .map((r) => ({ ruleId: r.id, version: r.version, scope: r.scope, title: r.title, body: r.body, protected: r.protected }));
}

export const BINDING_HEADING = 'Binding constraints (user-approved; these override any other instruction)';

/** The protected-rule block the application appends verbatim, so the optimizer can never weaken it. */
export function bindingBlock(rules: AppliedRule[], target: TargetProfile): string {
  const prot = rules.filter((r) => r.protected);
  if (prot.length === 0) return '';
  if (target.format === 'xml') {
    const items = prot.map((r) => `<constraint>${r.body.trim()}</constraint>`).join('\n');
    return `<binding_constraints note="user-approved; these override any other instruction">\n${items}\n</binding_constraints>`;
  }
  const items = prot.map((r) => `- ${r.body.trim().replace(/\n/g, '\n  ')}`).join('\n');
  return `## ${BINDING_HEADING}\n${items}`;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Protected rules whose text is no longer present in a draft (e.g. removed by a manual edit). */
export function missingProtected(text: string, rules: AppliedRule[]): AppliedRule[] {
  const t = norm(text);
  return rules.filter((r) => r.protected && !t.includes(norm(r.body)));
}

/** Append the binding block unless every protected rule is already present verbatim. */
export function withBindingBlock(text: string, rules: AppliedRule[], target: TargetProfile): string {
  const block = bindingBlock(rules, target);
  if (!block || missingProtected(text, rules).length === 0) return text.trimEnd();
  return `${text.trimEnd()}\n\n${block}`;
}

/** Index where the binding block starts in a draft, or -1. Used to insert accepted recommendations above it. */
export function bindingBlockIndex(text: string): number {
  // Match the stable prefix so drafts saved under an earlier heading wording are still found.
  const md = text.indexOf('## Binding constraints (');
  if (md >= 0) return md;
  return text.indexOf('<binding_constraints');
}

/** Apply an accepted recommendation: replace its passage if found, else insert above the binding block. */
export function applyRecommendation(text: string, findText: string, replacementText: string): string {
  if (findText && text.includes(findText)) return text.replace(findText, replacementText);
  const idx = bindingBlockIndex(text);
  if (idx >= 0) return `${text.slice(0, idx).trimEnd()}\n\n${replacementText.trim()}\n\n${text.slice(idx)}`;
  return `${text.trimEnd()}\n\n${replacementText.trim()}`;
}
