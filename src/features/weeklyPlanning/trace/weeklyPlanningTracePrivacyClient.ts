import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { getFirebaseAuth } from '../../../lib/firebaseClient';

export const WEEKLY_PLANNING_TRACE_POLICY_VERSION = '2026-07-18-v1';

interface TraceApiEnvelope {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface WeeklyPlanningTracePolicyStatus {
  policyVersion: string;
  accepted: boolean;
  acceptedAt: string | null;
}

export interface WeeklyPlanningTraceApiClient {
  getPolicyStatus(): Promise<WeeklyPlanningTracePolicyStatus>;
  acceptPolicy(): Promise<WeeklyPlanningTracePolicyStatus>;
  append(payload: Record<string, unknown>): Promise<void>;
  deleteCurrentUserTrace(): Promise<{ deletedSessions: number; deletedEntries: number }>;
  listAdminSessions(): Promise<Record<string, unknown>[]>;
  listAdminEntries(sessionId: string): Promise<Record<string, unknown>[]>;
  archiveAdminSession(sessionId: string): Promise<void>;
}

function traceApiBaseUrl(): string {
  const configured = getCloudflareAiProxyUrl().trim();
  if (!configured) throw new Error('週間計画の会話記録用サーバーが設定されていません。');
  return configured
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/$/, '');
}

async function authenticatedTraceRequest(
  path: string,
  init: RequestInit = {},
): Promise<TraceApiEnvelope> {
  const currentUser = getFirebaseAuth()?.currentUser;
  if (!currentUser) throw new Error('ログイン状態を確認できませんでした。もう一度ログインしてください。');
  const idToken = await currentUser.getIdToken();
  const response = await fetch(`${traceApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(init.headers ?? {}),
    },
  });
  let payload: TraceApiEnvelope = {};
  try {
    payload = await response.json() as TraceApiEnvelope;
  } catch {
    payload = {};
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `週間計画の会話記録を処理できませんでした（${response.status}）。`,
    );
  }
  return payload;
}

function policyStatus(payload: TraceApiEnvelope): WeeklyPlanningTracePolicyStatus {
  return {
    policyVersion: typeof payload.policyVersion === 'string'
      ? payload.policyVersion
      : WEEKLY_PLANNING_TRACE_POLICY_VERSION,
    accepted: payload.accepted === true,
    acceptedAt: typeof payload.acceptedAt === 'string' ? payload.acceptedAt : null,
  };
}

function numericCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item))
    : [];
}

export function createWeeklyPlanningTraceApiClient(): WeeklyPlanningTraceApiClient {
  return {
    async getPolicyStatus() {
      return policyStatus(await authenticatedTraceRequest('/weekly-planning-trace/policy'));
    },

    async acceptPolicy() {
      return policyStatus(await authenticatedTraceRequest(
        '/weekly-planning-trace/policy/accept',
        { method: 'POST', body: '{}' },
      ));
    },

    async append(payload) {
      await authenticatedTraceRequest('/weekly-planning-trace/append', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    async deleteCurrentUserTrace() {
      const payload = await authenticatedTraceRequest('/weekly-planning-trace/delete', {
        method: 'POST',
        body: '{}',
      });
      return {
        deletedSessions: numericCount(payload.deletedSessions),
        deletedEntries: numericCount(payload.deletedEntries),
      };
    },

    async listAdminSessions() {
      const payload = await authenticatedTraceRequest('/weekly-planning-trace/admin/sessions');
      return recordArray(payload.sessions);
    },

    async listAdminEntries(sessionId) {
      const payload = await authenticatedTraceRequest('/weekly-planning-trace/admin/entries', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      return recordArray(payload.entries);
    },

    async archiveAdminSession(sessionId) {
      await authenticatedTraceRequest('/weekly-planning-trace/admin/archive', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
    },
  };
}
