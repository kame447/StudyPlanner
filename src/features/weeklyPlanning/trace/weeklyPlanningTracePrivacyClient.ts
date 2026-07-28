import {
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
} from '../../../../shared/weeklyPlanningTraceContract';
import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { getFirebaseAuth } from '../../../lib/firebaseClient';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

export const WEEKLY_PLANNING_TRACE_POLICY_VERSION = '2026-07-18-v1';

export type WeeklyPlanningTraceRequestStage =
  | 'health'
  | 'policy'
  | 'policy_accept'
  | 'session_start'
  | 'append'
  | 'delete'
  | 'admin_sessions'
  | 'admin_entries'
  | 'admin_archive';

export type WeeklyPlanningTraceErrorCategory =
  | 'network'
  | 'auth'
  | 'policy'
  | 'contract'
  | 'validation'
  | 'conflict'
  | 'rate_limit'
  | 'storage'
  | 'internal'
  | 'unknown';

interface TraceApiEnvelope {
  ok?: boolean;
  error?: string;
  errorCode?: string;
  errorCategory?: WeeklyPlanningTraceErrorCategory;
  retryable?: boolean;
  correlationId?: string;
  contractVersion?: string;
  workerRevision?: string;
  [key: string]: unknown;
}

export class WeeklyPlanningTraceApiError extends Error {
  readonly name = 'WeeklyPlanningTraceApiError';

  constructor(
    message: string,
    readonly details: {
      stage: WeeklyPlanningTraceRequestStage;
      status: number | null;
      code: string;
      category: WeeklyPlanningTraceErrorCategory;
      correlationId: string;
      retryable: boolean;
      contractVersion?: string;
      workerRevision?: string;
    },
  ) {
    super(message);
  }
}

export interface WeeklyPlanningTracePolicyStatus {
  policyVersion: string;
  accepted: boolean;
  acceptedAt: string | null;
}

export interface WeeklyPlanningTraceHealthStatus {
  contractVersion: string;
  workerRevision: string;
  storageLayoutVersion: number;
}

export interface WeeklyPlanningTraceServerHandle {
  sessionId: string;
  logicalConversationId: string;
}

export interface WeeklyPlanningTraceSessionStartInput {
  idempotencyKey: string;
  conversationCorrelationKey: string;
  session: Record<string, unknown>;
}

export interface WeeklyPlanningTraceAppendInput {
  session: WeeklyPlanningTraceSession;
  entries: WeeklyPlanningTraceEntry[];
}

export interface WeeklyPlanningTraceAdminRawSessions {
  sessions: Record<string, unknown>[];
  rawCount: number;
}

export interface WeeklyPlanningTraceApiClient {
  getHealth?(): Promise<WeeklyPlanningTraceHealthStatus>;
  getPolicyStatus(): Promise<WeeklyPlanningTracePolicyStatus>;
  acceptPolicy(): Promise<WeeklyPlanningTracePolicyStatus>;
  startSession(input: WeeklyPlanningTraceSessionStartInput): Promise<WeeklyPlanningTraceServerHandle>;
  append(payload: WeeklyPlanningTraceAppendInput): Promise<void>;
  deleteCurrentUserTrace(): Promise<{ deletedSessions: number; deletedEntries: number }>;
  listAdminSessions(): Promise<WeeklyPlanningTraceAdminRawSessions | Record<string, unknown>[]>;
  listAdminEntries(sessionId: string): Promise<Record<string, unknown>[]>;
  archiveAdminSession(sessionId: string): Promise<void>;
}

function traceApiBaseUrl(): string {
  const configured = getCloudflareAiProxyUrl().trim();
  if (!configured) throw new Error('週間計画の会話記録用サーバーが設定されていません。');
  return configured.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
}

function correlationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function categoryForStatus(status: number): WeeklyPlanningTraceErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 412) return 'policy';
  if (status === 409 || status === 426) return 'contract';
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'validation';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'internal';
  return 'unknown';
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorDetails(error: unknown): WeeklyPlanningTraceApiError['details'] | null {
  return error instanceof WeeklyPlanningTraceApiError ? error.details : null;
}

export function isWeeklyPlanningTraceRetriableError(error: unknown): boolean {
  const details = errorDetails(error);
  if (details) return details.retryable;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('temporary')
    || message.includes('network')
    || message.includes('timeout')
    || message.includes('timed out');
}

export function isWeeklyPlanningTraceServerHandleRejection(error: unknown): boolean {
  const details = errorDetails(error);
  if (details) {
    return [
      'trace_session_not_started',
      'trace_session_ownership_conflict',
      'trace_session_legacy_read_only',
      'trace_session_conversation_conflict',
      'trace_session_issuance_conflict',
      'trace_stale_server_handle',
    ].includes(details.code);
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return [
    'trace session must be started before append',
    'trace session ownership conflict',
    'legacy trace session is read-only',
    'trace session conversation conflict',
    'trace session issuance conflict',
    'stale server handle',
  ].some((marker) => message.includes(marker));
}

export function weeklyPlanningTraceErrorSummary(error: unknown): Record<string, unknown> {
  if (error instanceof WeeklyPlanningTraceApiError) {
    return { message: error.message, ...error.details };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

async function authenticatedTraceRequest(
  path: string,
  stage: WeeklyPlanningTraceRequestStage,
  init: RequestInit = {},
): Promise<TraceApiEnvelope> {
  const requestCorrelationId = correlationId();
  const currentUser = getFirebaseAuth()?.currentUser;
  if (!currentUser) {
    throw new WeeklyPlanningTraceApiError(
      'ログイン状態を確認できませんでした。もう一度ログインしてください。',
      {
        stage,
        status: null,
        code: 'trace_auth_unavailable',
        category: 'auth',
        correlationId: requestCorrelationId,
        retryable: false,
      },
    );
  }

  const idToken = await currentUser.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${traceApiBaseUrl()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
        [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: requestCorrelationId,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    const error = new WeeklyPlanningTraceApiError('週間計画traceサーバーへ接続できませんでした。', {
      stage,
      status: null,
      code: 'trace_network_failure',
      category: 'network',
      correlationId: requestCorrelationId,
      retryable: true,
    });
    console.warn(`[WeeklyPlanning Trace] request failed ${JSON.stringify(error.details)}`);
    throw error;
  }

  let payload: TraceApiEnvelope = {};
  try {
    payload = await response.json() as TraceApiEnvelope;
  } catch {
    payload = {};
  }

  const responseContract = response.headers.get(WEEKLY_PLANNING_TRACE_HEADERS.contractVersion)
    ?? (typeof payload.contractVersion === 'string' ? payload.contractVersion : undefined);
  const workerRevision = response.headers.get(WEEKLY_PLANNING_TRACE_HEADERS.workerRevision)
    ?? (typeof payload.workerRevision === 'string' ? payload.workerRevision : undefined);
  const responseCorrelationId = response.headers.get(WEEKLY_PLANNING_TRACE_HEADERS.correlationId)
    ?? (typeof payload.correlationId === 'string' ? payload.correlationId : requestCorrelationId);

  if (response.ok && payload.ok !== false && stage !== 'policy' && stage !== 'policy_accept') {
    if (responseContract !== WEEKLY_PLANNING_TRACE_CONTRACT_VERSION) {
      const error = new WeeklyPlanningTraceApiError('週間計画traceのfrontendとWorkerの契約versionが一致しません。', {
        stage,
        status: response.status,
        code: 'trace_contract_mismatch',
        category: 'contract',
        correlationId: responseCorrelationId,
        retryable: false,
        contractVersion: responseContract,
        workerRevision,
      });
      console.warn(`[WeeklyPlanning Trace] request failed ${JSON.stringify(error.details)}`);
      throw error;
    }
  }

  if (!response.ok || payload.ok === false) {
    const error = new WeeklyPlanningTraceApiError(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `週間計画の会話記録を処理できませんでした（${response.status}）。`,
      {
        stage,
        status: response.status,
        code: typeof payload.errorCode === 'string'
          ? payload.errorCode
          : `trace_http_${response.status}`,
        category: payload.errorCategory ?? categoryForStatus(response.status),
        correlationId: responseCorrelationId,
        retryable: typeof payload.retryable === 'boolean'
          ? payload.retryable
          : retryableStatus(response.status),
        contractVersion: responseContract,
        workerRevision,
      },
    );
    console.warn(`[WeeklyPlanning Trace] request failed ${JSON.stringify(error.details)}`);
    throw error;
  }

  return {
    ...payload,
    contractVersion: responseContract,
    workerRevision,
    correlationId: responseCorrelationId,
  };
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

function serverHandle(payload: TraceApiEnvelope): WeeklyPlanningTraceServerHandle {
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
  const logicalConversationId = typeof payload.logicalConversationId === 'string'
    ? payload.logicalConversationId.trim()
    : '';
  if (!sessionId || !logicalConversationId) {
    throw new Error('週間計画traceのserver handleが不正です。');
  }
  return { sessionId, logicalConversationId };
}

export function createWeeklyPlanningTraceApiClient(): WeeklyPlanningTraceApiClient {
  return {
    async getHealth() {
      const payload = await authenticatedTraceRequest('/weekly-planning-trace/health', 'health');
      return {
        contractVersion: String(payload.contractVersion ?? ''),
        workerRevision: String(payload.workerRevision ?? ''),
        storageLayoutVersion: numericCount(payload.storageLayoutVersion),
      };
    },
    async getPolicyStatus() {
      return policyStatus(await authenticatedTraceRequest('/weekly-planning-trace/policy', 'policy'));
    },
    async acceptPolicy() {
      return policyStatus(await authenticatedTraceRequest(
        '/weekly-planning-trace/policy/accept',
        'policy_accept',
        { method: 'POST', body: '{}' },
      ));
    },
    async startSession(input) {
      return serverHandle(await authenticatedTraceRequest(
        '/weekly-planning-trace/session/start',
        'session_start',
        { method: 'POST', body: JSON.stringify(input) },
      ));
    },
    async append(payload) {
      await authenticatedTraceRequest('/weekly-planning-trace/append', 'append', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    async deleteCurrentUserTrace() {
      const payload = await authenticatedTraceRequest('/weekly-planning-trace/delete', 'delete', {
        method: 'POST',
        body: '{}',
      });
      return {
        deletedSessions: numericCount(payload.deletedSessions),
        deletedEntries: numericCount(payload.deletedEntries),
      };
    },
    async listAdminSessions() {
      const payload = await authenticatedTraceRequest(
        '/weekly-planning-trace/admin/sessions',
        'admin_sessions',
      );
      const sessions = recordArray(payload.sessions);
      return { sessions, rawCount: numericCount(payload.rawCount) || sessions.length };
    },
    async listAdminEntries(sessionId) {
      const payload = await authenticatedTraceRequest(
        '/weekly-planning-trace/admin/entries',
        'admin_entries',
        { method: 'POST', body: JSON.stringify({ sessionId }) },
      );
      return recordArray(payload.entries);
    },
    async archiveAdminSession(sessionId) {
      await authenticatedTraceRequest('/weekly-planning-trace/admin/archive', 'admin_archive', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
    },
  };
}
