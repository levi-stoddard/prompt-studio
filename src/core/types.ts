// Pure domain types. src/core has no Electron, filesystem or network dependencies so it can
// later be extracted as a shared "prompt-core" package.

export type Mode = 'preserve' | 'challenge';
export type RuleScope = 'global' | 'project' | 'target';
export type ProviderId = 'mock' | 'gemini';

export interface TargetProfile {
  id: string;
  name: string;
  url: string;
  guidance: string;
  /** 'xml' = XML-tagged sections (Claude), 'markdown' = headings (ChatGPT, Gemini, custom). */
  format: 'xml' | 'markdown';
  builtin: boolean;
}

export interface Rule {
  id: string;
  scope: RuleScope;
  projectId: string | null;
  targetId: string | null;
  category: string;
  title: string;
  body: string;
  enabled: boolean;
  protected: boolean;
  version: number;
  updatedAt: string;
}

/** Snapshot of a rule version as it was applied to one generation. */
export interface AppliedRule {
  ruleId: string;
  version: number;
  scope: RuleScope;
  title: string;
  body: string;
  protected: boolean;
}

export interface ContextExcerpt {
  /** Display label: "<folder name>/<relative path>". */
  label: string;
  text: string;
}

export interface ReviewComment {
  quote: string;
  body: string;
}

export interface GenerateRequest {
  original: string;
  mode: Mode;
  target: TargetProfile;
  rules: AppliedRule[];
  excerpts: ContextExcerpt[];
  projectName: string | null;
}

export interface ReviseRequest {
  original: string;
  current: string;
  mode: Mode;
  target: TargetProfile;
  rules: AppliedRule[];
  excerpts: ContextExcerpt[];
  projectName: string | null;
  comments: ReviewComment[];
  instruction: string;
  /** When set, only this passage of `current` is revised. */
  selection: { start: number; end: number; text: string } | null;
}

export interface ChangeNote {
  kind: string;
  description: string;
}

export interface Recommendation {
  title: string;
  rationale: string;
  /** Exact passage of the draft to replace; empty string means append. */
  findText: string;
  replacementText: string;
}

export interface Conflict {
  ruleTitle: string;
  issue: string;
  suggestion: string;
}

export interface GenerateResult {
  optimizedPrompt: string;
  changes: ChangeNote[];
  recommendations: Recommendation[];
  conflicts: Conflict[];
  questions: string[];
}

export interface ReviseResult {
  revisedText: string;
  changes: ChangeNote[];
  conflicts: Conflict[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface ProviderResult<T> {
  data: T;
  usage: Usage | null;
  model: string;
}

export interface PromptPayload {
  system: string;
  user: string;
}

export interface LlmProvider {
  id: ProviderId;
  generate(req: GenerateRequest, payload: PromptPayload, model: string): Promise<ProviderResult<GenerateResult>>;
  revise(req: ReviseRequest, payload: PromptPayload, model: string): Promise<ProviderResult<ReviseResult>>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'auth' | 'quota' | 'rate_limit' | 'unavailable' | 'model' | 'bad_request' | 'malformed' | 'truncated' | 'network' | 'unknown',
    public readonly retryable: boolean,
    public readonly usage: Usage | null = null,
  ) {
    super(message);
  }
}
