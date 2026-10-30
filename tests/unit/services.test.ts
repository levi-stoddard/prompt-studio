import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/main/db';
import { GenerationService } from '../../src/main/generation';
import { GeminiProvider } from '../../src/main/gemini';
import { listFiles, readExcerpt, resolveInside } from '../../src/main/projectFs';
import { MockProvider } from '../../src/core/mock';
import { ProviderError, type LlmProvider } from '../../src/core/types';
import { monthKey } from '../../src/core/budget';
import { appPaths, defaultHome } from '../../src/main/paths';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ps-unit-'));
  store = new Store(join(dir, 'test.db'));
  store.migrate();
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function fakeGemini(over: Partial<LlmProvider> = {}): LlmProvider & { calls: number } {
  const p: any = {
    id: 'gemini',
    calls: 0,
    async generate() {
      p.calls++;
      return { data: { optimizedPrompt: 'Optimized prompt.', changes: [], recommendations: [{ title: 'R', rationale: 'x', findText: '', replacementText: 'extra' }], conflicts: [], questions: [] }, usage: { inputTokens: 2000, outputTokens: 1000, thinkingTokens: 1000 }, model: 'gemini-2.5-pro' };
    },
    async revise() {
      p.calls++;
      return { data: { revisedText: 'REVISED', changes: [], conflicts: [] }, usage: { inputTokens: 100, outputTokens: 10, thinkingTokens: 0 }, model: 'gemini-2.5-pro' };
    },
    ...over,
  };
  return p;
}

function service(provider: LlmProvider | null) {
  return new GenerationService({ store, providerFor: (id) => (id === 'mock' ? new MockProvider() : provider), readExcerpt });
}

describe('storage', () => {
  it('seeds six starter rules (two protected) and three targets', () => {
    expect(store.listRules()).toHaveLength(6);
    expect(store.listRules().filter((r) => r.protected)).toHaveLength(2);
    expect(store.listTargets().map((t) => t.id)).toEqual(['chatgpt', 'claude', 'gemini']);
  });

  it('keeps the original and every version; edits to rules create versions', () => {
    const id = store.createSession({ projectId: null, title: 't', targetId: 'chatgpt', mode: 'preserve', original: 'orig' });
    store.saveWorking(id, 'edited');
    store.checkpoint(id);
    expect(store.checkpoint(id)).toBeNull();
    expect(store.versions(id).map((v) => [v.kind, v.text])).toEqual([['original', 'orig'], ['edit', 'edited']]);
    const r = store.listRules()[0];
    store.updateRule(r.id, { ...r, body: r.body + ' Updated.' });
    expect(store.ruleHistory(r.id).map((h) => h.version)).toEqual([2, 1]);
  });

  it('counts only Gemini usage toward the allowance', () => {
    const m = monthKey(new Date());
    store.addUsage({ generationId: null, provider: 'mock', model: 'm', inputTokens: 1, outputTokens: 1, thinkingTokens: 0, costUsd: 5, estimated: false, month: m });
    store.addUsage({ generationId: null, provider: 'gemini', model: 'g', inputTokens: 1, outputTokens: 1, thinkingTokens: 0, costUsd: 0.25, estimated: false, month: m });
    expect(store.monthSpent(m)).toBeCloseTo(0.25);
  });

  it('never overwrites an existing file when snapshotting', () => {
    const f = join(dir, 'b.db');
    store.snapshotTo(f);
    expect(() => store.snapshotTo(f)).toThrow(/never overwritten/);
  });
});

describe('generation service', () => {
  // Cost expectations below use gemini-2.5-pro rates ($1.25 / $10 per 1M tokens).
  beforeEach(() => store.setSetting('model', 'gemini-2.5-pro'));
  const newSession = (projectId: string | null = null, mode: 'preserve' | 'challenge' = 'preserve') => store.createSession({ projectId, title: 't', targetId: 'chatgpt', mode, original: 'Write a newsletter intro.' });

  it('blocks a billable call before contacting Gemini when the allowance cannot cover the worst case', async () => {
    store.setSetting('provider', 'gemini');
    store.addUsage({ generationId: null, provider: 'gemini', model: 'g', inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 19.95, estimated: false, month: monthKey(new Date()) });
    const gem = fakeGemini();
    const svc = service(gem);
    const id = newSession();
    const p = await svc.preview({ sessionId: id, kind: 'generate', excerpts: [] });
    expect(p.canRun).toBe(false);
    expect(p.blockReason).toMatch(/remains/);
    expect((await svc.run(p.previewId)).status).toBe('blocked');
    expect(gem.calls).toBe(0);
    expect(store.monthSpent(monthKey(new Date()))).toBeCloseTo(19.95);
  });

  it('re-checks the allowance at send time', async () => {
    store.setSetting('provider', 'gemini');
    const gem = fakeGemini();
    const svc = service(gem);
    const p = await svc.preview({ sessionId: newSession(), kind: 'generate', excerpts: [] });
    expect(p.canRun).toBe(true);
    store.addUsage({ generationId: null, provider: 'gemini', model: 'g', inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 20, estimated: false, month: monthKey(new Date()) });
    expect((await svc.run(p.previewId)).status).toBe('blocked');
    expect(gem.calls).toBe(0);
  });

  it('records actual cost from reported usage and appends protected rules', async () => {
    store.setSetting('provider', 'gemini');
    const svc = service(fakeGemini());
    const id = newSession();
    const r = await svc.run((await svc.preview({ sessionId: id, kind: 'generate', excerpts: [] })).previewId);
    expect(r.status).toBe('ok');
    // 2000 in @ $1.25/M + (1000 out + 1000 thinking) @ $10/M
    expect(store.monthSpent(monthKey(new Date()))).toBeCloseTo(0.0025 + 0.02, 6);
    const d = store.sessionDetail(id);
    expect(d.workingText).toContain('Binding constraints');
    expect(d.recommendations).toHaveLength(0); // Preserve Intent ignores recommendations
    expect(d.generations[0].rules.length).toBe(6);
    expect(d.generations[0].transmissions[0].kind).toBe('instruction');
  });

  it('keeps recommendations separate in Challenge mode', async () => {
    store.setSetting('provider', 'gemini');
    const svc = service(fakeGemini());
    const id = newSession(null, 'challenge');
    await svc.run((await svc.preview({ sessionId: id, kind: 'generate', excerpts: [] })).previewId);
    const d = store.sessionDetail(id);
    expect(d.recommendations).toHaveLength(1);
    expect(d.workingText).not.toContain('extra');
    svc.acceptRecommendation(d.recommendations[0].id);
    expect(store.sessionDetail(id).workingText).toContain('extra');
  });

  it('records usage reported with a failed call and leaves the draft untouched', async () => {
    store.setSetting('provider', 'gemini');
    const svc = service(fakeGemini({ generate: async () => { throw new ProviderError('cut off', 'truncated', false, { inputTokens: 1000, outputTokens: 8192, thinkingTokens: 0 }); } }));
    const id = newSession();
    const r = await svc.run((await svc.preview({ sessionId: id, kind: 'generate', excerpts: [] })).previewId);
    expect(r.status).toBe('error');
    expect(store.monthSpent(monthKey(new Date()))).toBeGreaterThan(0.08);
    expect(store.versions(id)).toHaveLength(1);
  });

  it('refuses to send credentials', async () => {
    const svc = service(null);
    const id = store.createSession({ projectId: null, title: 't', targetId: 'chatgpt', mode: 'preserve', original: 'Use key AIza' + 'k'.repeat(35) });
    const p = await svc.preview({ sessionId: id, kind: 'generate', excerpts: [] });
    expect(p.canRun).toBe(false);
    expect(p.blockReason).toMatch(/Google API key/);
  });

  it('enforces the per-request cost limit ($0.10 by default)', async () => {
    store.setSetting('provider', 'gemini');
    const gem = fakeGemini();
    const svc = service(gem);
    const ok = await svc.preview({ sessionId: newSession(), kind: 'generate', excerpts: [] });
    expect(ok.canRun).toBe(true);
    expect(ok.worstCaseUsd).toBeLessThanOrEqual(0.1);
    store.setSetting('maxOutputTokens', 16384);
    const p = await svc.preview({ sessionId: newSession(), kind: 'generate', excerpts: [] });
    expect(p.canRun).toBe(false);
    expect(p.blockReason).toMatch(/per-request limit/);
    expect(gem.calls).toBe(0);
  });

  it('blocks models without a configured price', async () => {
    store.setSetting('provider', 'gemini');
    store.setSetting('model', 'gemini-unpriced');
    const p = await service(fakeGemini()).preview({ sessionId: newSession(), kind: 'generate', excerpts: [] });
    expect(p.canRun).toBe(false);
    expect(p.blockReason).toMatch(/No price/);
  });

  it('only reads folders authorized for the prompt’s own project', async () => {
    const a = store.createProject('A', '');
    const b = store.createProject('B', '');
    const folder = join(dir, 'proj');
    mkdirSync(folder);
    writeFileSync(join(folder, 'notes.md'), 'hello');
    const fb = store.addFolder(b.id, folder);
    const svc = service(null);
    await expect(svc.preview({ sessionId: newSession(a.id), kind: 'generate', excerpts: [{ folderId: fb.id, relPath: 'notes.md' }] })).rejects.toThrow(/not authorized/);
    const ok = await svc.preview({ sessionId: newSession(b.id), kind: 'generate', excerpts: [{ folderId: fb.id, relPath: 'notes.md' }] });
    expect(ok.excerpts[0].text).toBe('hello');
  });

  it('revises only the selected passage', async () => {
    store.setSetting('provider', 'gemini');
    const svc = service(fakeGemini());
    const id = newSession();
    store.saveWorking(id, 'AAA BBB CCC');
    const r = await svc.run((await svc.preview({ sessionId: id, kind: 'revise', excerpts: [], instruction: 'x', selection: { start: 4, end: 7 } })).previewId);
    expect(r.status).toBe('ok');
    expect(store.sessionDetail(id).workingText.startsWith('AAA REVISED CCC')).toBe(true);
  });

  it('asks for confirmation before approving a draft missing a protected rule', () => {
    const svc = service(null);
    const id = newSession();
    store.saveWorking(id, 'Draft without the protected rules');
    const r = svc.approve(id, false);
    expect(r.approved).toBe(false);
    expect(r.missing).toHaveLength(2);
    expect(svc.approve(id, true).approved).toBe(true);
    expect(store.sessionDetail(id).approvals[0].missing).toHaveLength(2);
  });
});

describe('read-only project access', () => {
  it('refuses traversal and junction escapes, and blocks sensitive files', async () => {
    const root = join(dir, 'root');
    const outside = join(dir, 'outside');
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(root, 'README.md'), '# hi');
    writeFileSync(join(root, '.env'), 'X=1');
    writeFileSync(join(root, '.git', 'config'), '');
    writeFileSync(join(outside, 'other.md'), 'outside');
    symlinkSync(outside, join(root, 'link'), 'junction');

    const files = await listFiles(root);
    expect(files.map((f) => f.rel).sort()).toEqual(['.env', 'README.md']);
    expect(files.find((f) => f.rel === '.env')!.restricted).not.toBeNull();
    await expect(resolveInside(root, '../outside/other.md')).rejects.toThrow(/outside/);
    await expect(readExcerpt(root, 'link/other.md', 1000)).rejects.toThrow(/outside/);
    await expect(readExcerpt(root, '.env', 1000)).rejects.toThrow(/Sensitive/);
    expect((await readExcerpt(root, 'README.md', 1000)).text).toBe('# hi');
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('# hi');
  });
});

describe('Gemini client', () => {
  const payload = { system: 's', user: 'u' };
  const req: any = {};
  const ok = { text: JSON.stringify({ optimized_prompt: 'P', change_summary: [], recommendations: [], conflicts: [], open_questions: [] }), usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3 }, candidates: [{ finishReason: 'STOP' }] };

  it('does not repeat a request unless automatic retries are enabled', async () => {
    let n = 0;
    const client: any = { models: { generateContent: async () => { n++; throw Object.assign(new Error('rate'), { status: 429 }); } } };
    const g = new GeminiProvider('k'.repeat(30), { maxOutputTokens: 100, temperature: 0 }, client, async () => {});
    await expect(g.generate(req, payload, 'm')).rejects.toMatchObject({ code: 'rate_limit' });
    expect(n).toBe(1);
  });

  it('with retries enabled, retries rate limits, then succeeds and reports usage', async () => {
    let n = 0;
    const client: any = { models: { generateContent: async () => (++n < 3 ? Promise.reject(Object.assign(new Error('rate'), { status: 429 })) : ok) } };
    const g = new GeminiProvider('k'.repeat(30), { maxOutputTokens: 100, temperature: 0, retries: 2 }, client, async () => {});
    const r = await g.generate(req, payload, 'gemini-2.5-pro');
    expect(n).toBe(3);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5, thinkingTokens: 3 });
  });

  it('does not retry an invalid key', async () => {
    let n = 0;
    const client: any = { models: { generateContent: async () => { n++; throw Object.assign(new Error('denied'), { status: 403 }); } } };
    const g = new GeminiProvider('k'.repeat(30), { maxOutputTokens: 100, temperature: 0 }, client, async () => {});
    await expect(g.generate(req, payload, 'm')).rejects.toMatchObject({ code: 'auth' });
    expect(n).toBe(1);
  });

  it('reports truncation and malformed output with their usage', async () => {
    const trunc: any = { models: { generateContent: async () => ({ ...ok, candidates: [{ finishReason: 'MAX_TOKENS' }] }) } };
    await expect(new GeminiProvider('k'.repeat(30), { maxOutputTokens: 1, temperature: 0 }, trunc).generate(req, payload, 'm')).rejects.toMatchObject({ code: 'truncated', usage: { inputTokens: 10 } });
    const bad: any = { models: { generateContent: async () => ({ ...ok, text: '{"nope":1}' }) } };
    await expect(new GeminiProvider('k'.repeat(30), { maxOutputTokens: 1, temperature: 0 }, bad).generate(req, payload, 'm')).rejects.toMatchObject({ code: 'malformed' });
  });
});

describe('base directory', () => {
  it('defaults to PromptStudio under LOCALAPPDATA', () => {
    expect(defaultHome({ LOCALAPPDATA: join('X:', 'Local') })).toBe(join('X:', 'Local', 'PromptStudio'));
  });

  it('keeps every path under the chosen home', () => {
    const p = appPaths(join('Y:', 'PS'));
    expect(p.db).toBe(join('Y:', 'PS', 'data', 'promptstudio.db'));
    expect(p.backups).toBe(join('Y:', 'PS', 'backups'));
  });
});
