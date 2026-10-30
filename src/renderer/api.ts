import type { Channel, IpcResult } from '../shared/channels';
import type { Comment, Folder, GenerationRow, Project, RecommendationRow, SessionSummary, Settings, Version } from '../main/db';
import type { AppliedRule, Rule, TargetProfile } from '../core/types';
import type { BudgetStatus } from '../core/budget';
import type { PreviewSummary, RunResult } from '../main/generation';
import type { FileEntry } from '../main/projectFs';

declare global {
  interface Window {
    ps: { invoke(channel: Channel, payload?: unknown): Promise<IpcResult<unknown>> };
  }
}

export async function call<T = unknown>(channel: Channel, payload?: unknown): Promise<T> {
  const res = await window.ps.invoke(channel, payload);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}

export interface SecurityReport {
  packaged: boolean;
  electron: string;
  chrome: string;
  sandbox: boolean;
  contextIsolation: boolean;
  nodeIntegration: boolean;
  bridge: string[];
  webviewTag: boolean;
  devTools: boolean;
  contentSecurityPolicy: string;
  rendererNetwork: string;
  ipcChannels: number;
}

export interface Boot {
  projects: Project[];
  targets: TargetProfile[];
  rules: Rule[];
  settings: Settings;
  budget: BudgetStatus;
  keyConfigured: boolean;
  secureStorage: boolean;
  paths: { home: string; db: string; backups: string; exports: string; logs: string };
  backups: string[];
  security: SecurityReport;
  appVersion: string;
  pricesVerifiedOn: string;
  pricesSource: string;
}

export interface SessionData {
  id: string;
  projectId: string | null;
  title: string;
  targetId: string;
  mode: 'preserve' | 'challenge';
  status: string;
  updatedAt: string;
  workingText: string;
  approvedVersionId: string | null;
  versions: Version[];
  comments: Comment[];
  generations: GenerationRow[];
  recommendations: RecommendationRow[];
  approvals: { id: string; versionId: string; approvedAt: string; missing: string[] }[];
  applicableRules: AppliedRule[];
}

export type { Comment, Folder, GenerationRow, Project, RecommendationRow, SessionSummary, Settings, Version, Rule, TargetProfile, BudgetStatus, PreviewSummary, RunResult, FileEntry, AppliedRule };

export const KIND_LABEL: Record<string, string> = {
  original: 'Original',
  generated: 'Generated',
  edit: 'Manual edit',
  revision: 'Revision',
  restored: 'Restored',
  accepted: 'Accepted recommendation',
};

export const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`;
