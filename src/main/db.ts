import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { BUILTIN_TARGETS } from '../core/targets';
import { STARTER_RULES } from '../core/starterRules';
import { DEFAULT_PRICES, type PriceEntry } from '../core/pricing';
import type { AppliedRule, Mode, ProviderId, Rule, RuleScope, TargetProfile } from '../core/types';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE project_folders (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL,
  authorized_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE targets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, guidance TEXT NOT NULL,
  format TEXT NOT NULL, builtin INTEGER NOT NULL, sort INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES targets(id), mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  working_text TEXT NOT NULL DEFAULT '', approved_version_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE versions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', generation_id TEXT,
  created_at TEXT NOT NULL, UNIQUE(session_id, seq)
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), version_id TEXT,
  anchor_start INTEGER NOT NULL, anchor_end INTEGER NOT NULL, quote TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE rules (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT REFERENCES projects(id), target_id TEXT REFERENCES targets(id),
  category TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, current_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE rule_versions (
  rule_id TEXT NOT NULL REFERENCES rules(id), version INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  protected INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (rule_id, version)
);
CREATE TABLE generations (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL, target_id TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, output_version_id TEXT, changes_json TEXT NOT NULL DEFAULT '[]',
  conflicts_json TEXT NOT NULL DEFAULT '[]', questions_json TEXT NOT NULL DEFAULT '[]',
  request_chars INTEGER NOT NULL DEFAULT 0, worst_case_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE generation_rules (
  generation_id TEXT NOT NULL REFERENCES generations(id), rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL,
  title TEXT NOT NULL, protected INTEGER NOT NULL, scope TEXT NOT NULL, PRIMARY KEY (generation_id, rule_id)
);
CREATE TABLE transmissions (
  id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id), kind TEXT NOT NULL,
  label TEXT NOT NULL, chars INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id), session_id TEXT NOT NULL REFERENCES sessions(id),
  title TEXT NOT NULL, rationale TEXT NOT NULL, find_text TEXT NOT NULL, replacement_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', decided_at TEXT
);
CREATE TABLE usage (
  id TEXT PRIMARY KEY, generation_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, thinking_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL, estimated INTEGER NOT NULL DEFAULT 0, month TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), version_id TEXT NOT NULL REFERENCES versions(id),
  text_sha256 TEXT NOT NULL, missing_protected_json TEXT NOT NULL DEFAULT '[]', approved_at TEXT NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX idx_versions_session ON versions(session_id, seq);
CREATE INDEX idx_comments_session ON comments(session_id);
CREATE INDEX idx_usage_month ON usage(month, provider);
CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at);
`;

export interface Settings {
  provider: ProviderId;
  model: string;
  monthlyLimitUsd: number;
  warnAt: number;
  criticalAt: number;
  /** Caps thinking + visible output combined (Gemini counts both against this limit). */
  maxOutputTokens: number;
  /** A single request is refused if its worst-case cost exceeds this. */
  maxCostPerRequestUsd: number;
  /** Retry rate-limit/unavailable errors automatically. Off by default so no request is repeated without you. */
  autoRetry: boolean;
  excerptCharLimit: number;
  temperature: number;
  prices: PriceEntry[];
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'mock',
  model: 'gemini-3.8-flash',
  monthlyLimitUsd: 20,
  warnAt: 0.75,
  criticalAt: 0.9,
  maxOutputTokens: 8192,
  maxCostPerRequestUsd: 0.1,
  autoRetry: false,
  excerptCharLimit: 8000,
  temperature: 0.4,
  prices: DEFAULT_PRICES,
};

const now = () => new Date().toISOString();
export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

type Row = Record<string, any>;

export interface Project { id: string; name: string; description: string; createdAt: string }
export interface Folder { id: string; projectId: string; path: string; authorizedAt: string }
export interface SessionSummary { id: string; projectId: string | null; title: string; targetId: string; mode: Mode; status: string; updatedAt: string }
export interface Version { id: string; seq: number; kind: string; text: string; note: string; generationId: string | null; createdAt: string }
export interface Comment { id: string; versionId: string | null; start: number; end: number; quote: string; body: string; status: string; createdAt: string }
export interface RecommendationRow { id: string; generationId: string; title: string; rationale: string; findText: string; replacementText: string; status: string }
export interface GenerationRow {
  id: string; kind: string; provider: string; model: string; mode: string; targetId: string; status: string; error: string | null;
  outputVersionId: string | null; changes: any[]; conflicts: any[]; questions: string[]; createdAt: string;
  rules: { ruleId: string; version: number; title: string; protected: boolean; scope: string }[];
  transmissions: { kind: string; label: string; chars: number }[];
  costUsd: number | null;
}
export interface SessionDetail extends SessionSummary {
  workingText: string;
  approvedVersionId: string | null;
  versions: Version[];
  comments: Comment[];
  generations: GenerationRow[];
  recommendations: RecommendationRow[];
  approvals: { id: string; versionId: string; approvedAt: string; missing: string[] }[];
}

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  schemaVersion(): number {
    return (this.db.prepare('PRAGMA user_version').get() as Row).user_version as number;
  }

  migrate(): void {
    const v = this.schemaVersion();
    if (v === 0) {
      this.tx(() => {
        this.db.exec(SCHEMA);
        this.seed();
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
  }

  close(): void {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params);
  }
  private get(sql: string, ...params: any[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  private all(sql: string, ...params: any[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private seed(): void {
    BUILTIN_TARGETS.forEach((t, i) => this.run('INSERT INTO targets (id,name,url,guidance,format,builtin,sort) VALUES (?,?,?,?,?,1,?)', t.id, t.name, t.url, t.guidance, t.format, i));
    for (const r of STARTER_RULES) this.createRule({ scope: r.scope, projectId: null, targetId: null, category: r.category, title: r.title, body: r.body, protected: r.protected });
  }

  // ---------- settings ----------
  getSettings(): Settings {
    const rows = this.all('SELECT key, value FROM settings');
    const s: any = { ...DEFAULT_SETTINGS };
    for (const r of rows) s[r.key] = JSON.parse(r.value);
    return s as Settings;
  }
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  }

  // ---------- projects & folders ----------
  listProjects(): Project[] {
    return this.all('SELECT * FROM projects WHERE archived = 0 ORDER BY name COLLATE NOCASE').map((r) => ({ id: r.id, name: r.name, description: r.description, createdAt: r.created_at }));
  }
  getProject(id: string): Project | null {
    const r = this.get('SELECT * FROM projects WHERE id = ?', id);
    return r ? { id: r.id, name: r.name, description: r.description, createdAt: r.created_at } : null;
  }
  createProject(name: string, description: string): Project {
    const id = randomUUID();
    this.run('INSERT INTO projects (id,name,description,created_at) VALUES (?,?,?,?)', id, name, description, now());
    return this.getProject(id)!;
  }
  updateProject(id: string, name: string, description: string): void {
    this.run('UPDATE projects SET name=?, description=? WHERE id=?', name, description, id);
  }
  listFolders(projectId: string): Folder[] {
    return this.all('SELECT * FROM project_folders WHERE project_id = ? AND revoked_at IS NULL ORDER BY authorized_at', projectId).map((r) => ({ id: r.id, projectId: r.project_id, path: r.path, authorizedAt: r.authorized_at }));
  }
  getFolder(id: string): Folder | null {
    const r = this.get('SELECT * FROM project_folders WHERE id = ? AND revoked_at IS NULL', id);
    return r ? { id: r.id, projectId: r.project_id, path: r.path, authorizedAt: r.authorized_at } : null;
  }
  addFolder(projectId: string, path: string): Folder {
    const existing = this.all('SELECT id FROM project_folders WHERE project_id=? AND path=? AND revoked_at IS NULL', projectId, path)[0];
    if (existing) return this.getFolder(existing.id)!;
    const id = randomUUID();
    this.run('INSERT INTO project_folders (id,project_id,path,authorized_at) VALUES (?,?,?,?)', id, projectId, path, now());
    return this.getFolder(id)!;
  }
  revokeFolder(id: string): void {
    this.run('UPDATE project_folders SET revoked_at = ? WHERE id = ?', now(), id);
  }

  // ---------- targets ----------
  listTargets(): TargetProfile[] {
    return this.all('SELECT * FROM targets ORDER BY sort, name').map((r) => ({ id: r.id, name: r.name, url: r.url, guidance: r.guidance, format: r.format, builtin: !!r.builtin }));
  }
  getTarget(id: string): TargetProfile | null {
    return this.listTargets().find((t) => t.id === id) ?? null;
  }
  saveTarget(t: { id?: string; name: string; url: string; guidance: string; format: 'xml' | 'markdown' }): TargetProfile {
    if (t.id && this.getTarget(t.id)) {
      this.run('UPDATE targets SET name=?, url=?, guidance=?, format=? WHERE id=?', t.name, t.url, t.guidance, t.format, t.id);
      return this.getTarget(t.id)!;
    }
    const id = `custom-${randomUUID().slice(0, 8)}`;
    this.run('INSERT INTO targets (id,name,url,guidance,format,builtin,sort) VALUES (?,?,?,?,?,0,100)', id, t.name, t.url, t.guidance, t.format);
    return this.getTarget(id)!;
  }

  // ---------- rules ----------
  listRules(): Rule[] {
    return this.all(
      `SELECT r.*, v.title, v.body, v.protected FROM rules r JOIN rule_versions v ON v.rule_id = r.id AND v.version = r.current_version
       ORDER BY r.scope, v.title COLLATE NOCASE`,
    ).map((r) => ({
      id: r.id, scope: r.scope, projectId: r.project_id, targetId: r.target_id, category: r.category, title: r.title, body: r.body,
      enabled: !!r.enabled, protected: !!r.protected, version: r.current_version, updatedAt: r.updated_at,
    }));
  }
  ruleHistory(ruleId: string) {
    return this.all('SELECT * FROM rule_versions WHERE rule_id = ? ORDER BY version DESC', ruleId).map((r) => ({ version: r.version, title: r.title, body: r.body, protected: !!r.protected, createdAt: r.created_at }));
  }
  createRule(r: { scope: RuleScope; projectId: string | null; targetId: string | null; category: string; title: string; body: string; protected: boolean }): string {
    const id = randomUUID();
    const t = now();
    this.run('INSERT INTO rules (id,scope,project_id,target_id,category,enabled,current_version,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?)', id, r.scope, r.scope === 'project' ? r.projectId : null, r.scope === 'target' ? r.targetId : null, r.category, t, t);
    this.run('INSERT INTO rule_versions (rule_id,version,title,body,protected,created_at) VALUES (?,?,?,?,?,?)', id, 1, r.title, r.body, r.protected ? 1 : 0, t);
    return id;
  }
  /** Edits create a new rule version; the previous text is kept in history. */
  updateRule(id: string, r: { scope: RuleScope; projectId: string | null; targetId: string | null; category: string; title: string; body: string; protected: boolean }): void {
    const cur = this.listRules().find((x) => x.id === id);
    if (!cur) throw new Error('Rule not found');
    const t = now();
    this.tx(() => {
      let version = cur.version;
      if (cur.title !== r.title || cur.body !== r.body || cur.protected !== r.protected) {
        version += 1;
        this.run('INSERT INTO rule_versions (rule_id,version,title,body,protected,created_at) VALUES (?,?,?,?,?,?)', id, version, r.title, r.body, r.protected ? 1 : 0, t);
      }
      this.run('UPDATE rules SET scope=?, project_id=?, target_id=?, category=?, current_version=?, updated_at=? WHERE id=?', r.scope, r.scope === 'project' ? r.projectId : null, r.scope === 'target' ? r.targetId : null, r.category, version, t, id);
    });
  }
  setRuleEnabled(id: string, enabled: boolean): void {
    this.run('UPDATE rules SET enabled=?, updated_at=? WHERE id=?', enabled ? 1 : 0, now(), id);
  }

  // ---------- sessions & versions ----------
  listSessions(projectId: string | null): SessionSummary[] {
    const rows = projectId === null ? this.all('SELECT * FROM sessions WHERE project_id IS NULL ORDER BY updated_at DESC') : this.all('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC', projectId);
    return rows.map((r) => ({ id: r.id, projectId: r.project_id, title: r.title, targetId: r.target_id, mode: r.mode, status: r.status, updatedAt: r.updated_at }));
  }
  createSession(s: { projectId: string | null; title: string; targetId: string; mode: Mode; original: string }): string {
    const id = randomUUID();
    const t = now();
    this.tx(() => {
      this.run('INSERT INTO sessions (id,project_id,title,target_id,mode,working_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', id, s.projectId, s.title, s.targetId, s.mode, s.original, t, t);
      this.addVersion(id, 'original', s.original, 'Original instruction (preserved unchanged)', null);
    });
    return id;
  }
  sessionRow(id: string): Row {
    const r = this.get('SELECT * FROM sessions WHERE id = ?', id);
    if (!r) throw new Error('Prompt not found');
    return r;
  }
  updateSessionMeta(id: string, meta: { title?: string; targetId?: string; mode?: Mode }): void {
    const r = this.sessionRow(id);
    this.run('UPDATE sessions SET title=?, target_id=?, mode=?, updated_at=? WHERE id=?', meta.title ?? r.title, meta.targetId ?? r.target_id, meta.mode ?? r.mode, now(), id);
  }
  saveWorking(id: string, text: string): void {
    this.run('UPDATE sessions SET working_text=?, updated_at=? WHERE id=?', text, now(), id);
  }
  versions(sessionId: string): Version[] {
    return this.all('SELECT * FROM versions WHERE session_id = ? ORDER BY seq', sessionId).map((r) => ({ id: r.id, seq: r.seq, kind: r.kind, text: r.text, note: r.note, generationId: r.generation_id, createdAt: r.created_at }));
  }
  getVersion(id: string): Version & { sessionId: string } {
    const r = this.get('SELECT * FROM versions WHERE id = ?', id);
    if (!r) throw new Error('Version not found');
    return { id: r.id, seq: r.seq, kind: r.kind, text: r.text, note: r.note, generationId: r.generation_id, createdAt: r.created_at, sessionId: r.session_id };
  }
  /** Versions are append-only; nothing in the app updates or deletes a version row. */
  addVersion(sessionId: string, kind: string, text: string, note: string, generationId: string | null): Version {
    const seq = ((this.get('SELECT MAX(seq) m FROM versions WHERE session_id = ?', sessionId)?.m as number | null) ?? 0) + 1;
    const id = randomUUID();
    this.run('INSERT INTO versions (id,session_id,seq,kind,text,note,generation_id,created_at) VALUES (?,?,?,?,?,?,?,?)', id, sessionId, seq, kind, text, note, generationId, now());
    this.run('UPDATE sessions SET working_text=?, updated_at=? WHERE id=?', text, now(), sessionId);
    return this.getVersion(id);
  }
  latestVersion(sessionId: string): Version {
    const v = this.versions(sessionId);
    return v[v.length - 1];
  }
  /** Save the working text as a manual-edit version if it differs from the latest version. */
  checkpoint(sessionId: string, note = 'Manual edit'): Version | null {
    const s = this.sessionRow(sessionId);
    const latest = this.latestVersion(sessionId);
    if (latest && latest.text === s.working_text) return null;
    return this.addVersion(sessionId, 'edit', s.working_text, note, null);
  }

  // ---------- comments ----------
  comments(sessionId: string): Comment[] {
    return this.all('SELECT * FROM comments WHERE session_id = ? ORDER BY created_at', sessionId).map((r) => ({ id: r.id, versionId: r.version_id, start: r.anchor_start, end: r.anchor_end, quote: r.quote, body: r.body, status: r.status, createdAt: r.created_at }));
  }
  addComment(sessionId: string, c: { start: number; end: number; quote: string; body: string }): string {
    const id = randomUUID();
    const t = now();
    this.run('INSERT INTO comments (id,session_id,version_id,anchor_start,anchor_end,quote,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', id, sessionId, this.latestVersion(sessionId)?.id ?? null, c.start, c.end, c.quote, c.body, t, t);
    return id;
  }
  updateComment(id: string, patch: { body?: string; status?: 'open' | 'resolved' }): void {
    const r = this.get('SELECT * FROM comments WHERE id = ?', id);
    if (!r) throw new Error('Comment not found');
    this.run('UPDATE comments SET body=?, status=?, updated_at=? WHERE id=?', patch.body ?? r.body, patch.status ?? r.status, now(), id);
  }
  commentSession(id: string): string {
    const r = this.get('SELECT session_id FROM comments WHERE id = ?', id);
    if (!r) throw new Error('Comment not found');
    return r.session_id;
  }

  // ---------- generations, usage, transmissions ----------
  insertGeneration(g: { sessionId: string; kind: string; provider: string; model: string; mode: string; targetId: string; status: string; error?: string; requestChars: number; worstCaseUsd: number; rules: AppliedRule[] }): string {
    const id = randomUUID();
    this.run('INSERT INTO generations (id,session_id,kind,provider,model,mode,target_id,status,error,request_chars,worst_case_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, g.sessionId, g.kind, g.provider, g.model, g.mode, g.targetId, g.status, g.error ?? null, g.requestChars, g.worstCaseUsd, now());
    for (const r of g.rules) this.run('INSERT INTO generation_rules (generation_id,rule_id,rule_version,title,protected,scope) VALUES (?,?,?,?,?,?)', id, r.ruleId, r.version, r.title, r.protected ? 1 : 0, r.scope);
    return id;
  }
  finishGeneration(id: string, f: { status: string; error?: string | null; outputVersionId?: string | null; changes?: any[]; conflicts?: any[]; questions?: string[] }): void {
    this.run('UPDATE generations SET status=?, error=?, output_version_id=?, changes_json=?, conflicts_json=?, questions_json=? WHERE id=?', f.status, f.error ?? null, f.outputVersionId ?? null, JSON.stringify(f.changes ?? []), JSON.stringify(f.conflicts ?? []), JSON.stringify(f.questions ?? []), id);
  }
  addTransmission(generationId: string, kind: string, label: string, text: string): void {
    this.run('INSERT INTO transmissions (id,generation_id,kind,label,chars,sha256,created_at) VALUES (?,?,?,?,?,?,?)', randomUUID(), generationId, kind, label, text.length, sha256(text), now());
  }
  addUsage(u: { generationId: string | null; provider: string; model: string; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number; estimated: boolean; month: string }): void {
    this.run('INSERT INTO usage (id,generation_id,provider,model,input_tokens,output_tokens,thinking_tokens,cost_usd,estimated,month,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', randomUUID(), u.generationId, u.provider, u.model, u.inputTokens, u.outputTokens, u.thinkingTokens, u.costUsd, u.estimated ? 1 : 0, u.month, now());
  }
  /** Billable spend for a month. Mock usage is never billed and never counted. */
  monthSpent(month: string): number {
    return (this.get("SELECT COALESCE(SUM(cost_usd),0) s FROM usage WHERE month = ? AND provider = 'gemini'", month)?.s as number) ?? 0;
  }
  usageList(month: string) {
    return this.all("SELECT u.*, g.kind FROM usage u LEFT JOIN generations g ON g.id = u.generation_id WHERE u.month = ? AND u.provider = 'gemini' ORDER BY u.created_at DESC", month).map((r) => ({ createdAt: r.created_at, model: r.model, kind: r.kind, inputTokens: r.input_tokens, outputTokens: r.output_tokens, thinkingTokens: r.thinking_tokens, costUsd: r.cost_usd, estimated: !!r.estimated }));
  }

  addRecommendations(generationId: string, sessionId: string, recs: { title: string; rationale: string; findText: string; replacementText: string }[]): void {
    for (const r of recs) this.run('INSERT INTO recommendations (id,generation_id,session_id,title,rationale,find_text,replacement_text) VALUES (?,?,?,?,?,?,?)', randomUUID(), generationId, sessionId, r.title, r.rationale, r.findText, r.replacementText);
  }
  getRecommendation(id: string): RecommendationRow & { sessionId: string } {
    const r = this.get('SELECT * FROM recommendations WHERE id = ?', id);
    if (!r) throw new Error('Recommendation not found');
    return { id: r.id, generationId: r.generation_id, title: r.title, rationale: r.rationale, findText: r.find_text, replacementText: r.replacement_text, status: r.status, sessionId: r.session_id };
  }
  decideRecommendation(id: string, status: 'accepted' | 'rejected'): void {
    this.run('UPDATE recommendations SET status=?, decided_at=? WHERE id=?', status, now(), id);
  }

  // ---------- approval ----------
  approve(sessionId: string, missingProtected: string[]): Version {
    return this.tx(() => {
      this.checkpoint(sessionId, 'Edit before approval');
      const v = this.latestVersion(sessionId);
      this.run('INSERT INTO approvals (id,session_id,version_id,text_sha256,missing_protected_json,approved_at) VALUES (?,?,?,?,?,?)', randomUUID(), sessionId, v.id, sha256(v.text), JSON.stringify(missingProtected), now());
      this.run("UPDATE sessions SET status='approved', approved_version_id=?, updated_at=? WHERE id=?", v.id, now(), sessionId);
      return v;
    });
  }
  reopen(sessionId: string): void {
    this.run("UPDATE sessions SET status='draft', updated_at=? WHERE id=?", now(), sessionId);
  }

  sessionDetail(id: string): SessionDetail {
    const r = this.sessionRow(id);
    const gens = this.all('SELECT * FROM generations WHERE session_id = ? ORDER BY created_at DESC', id).map((g) => {
      const cost = this.get('SELECT SUM(cost_usd) c FROM usage WHERE generation_id = ?', g.id)?.c as number | null;
      return {
        id: g.id, kind: g.kind, provider: g.provider, model: g.model, mode: g.mode, targetId: g.target_id, status: g.status, error: g.error,
        outputVersionId: g.output_version_id, changes: JSON.parse(g.changes_json), conflicts: JSON.parse(g.conflicts_json), questions: JSON.parse(g.questions_json), createdAt: g.created_at,
        rules: this.all('SELECT * FROM generation_rules WHERE generation_id = ? ORDER BY protected DESC, scope, title', g.id).map((x) => ({ ruleId: x.rule_id, version: x.rule_version, title: x.title, protected: !!x.protected, scope: x.scope })),
        transmissions: this.all('SELECT kind, label, chars FROM transmissions WHERE generation_id = ? ORDER BY created_at', g.id).map((x) => ({ kind: x.kind, label: x.label, chars: x.chars })),
        costUsd: cost ?? null,
      };
    });
    return {
      id: r.id, projectId: r.project_id, title: r.title, targetId: r.target_id, mode: r.mode, status: r.status, updatedAt: r.updated_at,
      workingText: r.working_text, approvedVersionId: r.approved_version_id,
      versions: this.versions(id),
      comments: this.comments(id),
      generations: gens,
      recommendations: this.all('SELECT r.* FROM recommendations r JOIN generations g ON g.id = r.generation_id WHERE r.session_id = ? ORDER BY g.created_at DESC, r.rowid ASC', id).map((x) => ({ id: x.id, generationId: x.generation_id, title: x.title, rationale: x.rationale, findText: x.find_text, replacementText: x.replacement_text, status: x.status })),
      approvals: this.all('SELECT * FROM approvals WHERE session_id = ? ORDER BY approved_at DESC', id).map((x) => ({ id: x.id, versionId: x.version_id, approvedAt: x.approved_at, missing: JSON.parse(x.missing_protected_json) })),
    };
  }

  /** Consistent online snapshot of the whole database (used for backups and exports). */
  snapshotTo(file: string): void {
    if (existsSync(file)) throw new Error('A file with that name already exists. Choose a new name; existing files are never overwritten.');
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }
}
