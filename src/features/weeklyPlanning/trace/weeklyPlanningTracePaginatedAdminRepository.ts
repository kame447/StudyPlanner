import {
  WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING,
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
} from '../../../../shared/weeklyPlanningTraceContract';
import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { getFirebaseAuth } from '../../../lib/firebaseClient';
import { createWeeklyPlanningTraceAdminDiagnostics } from './weeklyPlanningTraceArchive';
import {
  WeeklyPlanningTraceApiError,
  type WeeklyPlanningTraceErrorCategory,
  type WeeklyPlanningTraceRequestStage,
} from './weeklyPlanningTracePrivacyClient';
import {
  isWeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceRepository,
  type WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const ADMIN_ENTRY_PAGE_PATH = '/weekly-planning-trace/admin/entries/page';
const ADMIN_ARCHIVE_PATH = '/weekly-planning-trace/admin/archive';

export type WeeklyPlanningTraceAdminEntryPage = {
  entries: Record<string, unknown>[];
  totalEntryCount: number;
  nextAfterSequence: number | null;
  missingSequenceCount: number;
};

export type WeeklyPlanningTraceAdminEntryPageFetcher = (params: {
  sessionId: string;
  afterSequence: number;
  limit: number;
}) => Promise<WeeklyPlanningTraceAdminEntryPage>;

interface TraceApiEnvelope {
  ok?: boolean;
  error?: string;
  errorCode?: string;
  errorCategory?: WeeklyPlanningTraceErrorCategory;
  retryable?: boolean;
  correlationId?: string;
  contractVersion?: string;
  workerRevision?: string;
  entries?: unknown;
  totalEntryCount?: unknown;
  nextAfterSequence?: unknown;
  missingSequenceCount?: unknown;
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
  if (status === 409) return 'conflict';
  if (status === 426) return 'contract';
  if (status === 400 || status === 404 || status === 413 || status === 422) return 'validation';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'internal';
  return 'unknown';
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item))
    : [];
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pageCursor(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN;
}

async function authenticatedAdminPost(
  path: string,
  stage: Extract<WeeklyPlanningTraceRequestStage, 'admin_entries' | 'admin_archive'>,
  body: Record<string, unknown>,
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]:
          WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
        [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: requestCorrelationId,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new WeeklyPlanningTraceApiError(
      '週間計画traceサーバーへ接続できませんでした。',
      {
        stage,
        status: null,
        code: 'trace_network_failure',
        category: 'network',
        correlationId: requestCorrelationId,
        retryable: true,
      },
    );
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

  if (!response.ok || payload.ok === false) {
    throw new WeeklyPlanningTraceApiError(
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
        retryable: payload.retryable === true,
        contractVersion: responseContract,
        workerRevision,
      },
    );
  }
  if (responseContract !== WEEKLY_PLANNING_TRACE_CONTRACT_VERSION) {
    throw new WeeklyPlanningTraceApiError(
      '週間計画traceのfrontendとWorkerの契約versionが一致しません。',
      {
        stage,
        status: response.status,
        code: 'trace_contract_mismatch',
        category: 'contract',
        correlationId: responseCorrelationId,
        retryable: false,
        contractVersion: responseContract,
        workerRevision,
      },
    );
  }
  return payload;
}

async function fetchAdminEntryPage(params: {
  sessionId: string;
  afterSequence: number;
  limit: number;
}): Promise<WeeklyPlanningTraceAdminEntryPage> {
  const payload = await authenticatedAdminPost(
    ADMIN_ENTRY_PAGE_PATH,
    'admin_entries',
    params,
  );
  return {
    entries: recordArray(payload.entries),
    totalEntryCount: finiteCount(payload.totalEntryCount),
    nextAfterSequence: pageCursor(payload.nextAfterSequence),
    missingSequenceCount: finiteCount(payload.missingSequenceCount),
  };
}

async function archiveAdminSessionSnapshot(params: {
  sessionId: string;
  expectedLastActivityAt: string;
  expectedEntryCount: number;
}): Promise<void> {
  await authenticatedAdminPost(ADMIN_ARCHIVE_PATH, 'admin_archive', params);
}

function isBoundedEntryCount(value: number): boolean {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxEntryCount;
}

export async function collectWeeklyPlanningTraceAdminEntryPages(
  sessionId: string,
  fetchPage: WeeklyPlanningTraceAdminEntryPageFetcher = fetchAdminEntryPage,
): Promise<Record<string, unknown>[]> {
  const entriesById = new Map<string, Record<string, unknown>>();
  let afterSequence = -1;
  let expectedTotalEntryCount: number | null = null;
  let missingSequenceCount = 0;

  for (
    let pageIndex = 0;
    pageIndex < WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxPages;
    pageIndex += 1
  ) {
    const page = await fetchPage({
      sessionId,
      afterSequence,
      limit: WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.defaultPageSize,
    });
    if (!isBoundedEntryCount(page.totalEntryCount)) {
      throw new Error('週間計画traceのentry総件数が不正です。');
    }
    if (expectedTotalEntryCount === null) {
      expectedTotalEntryCount = page.totalEntryCount;
    } else if (page.totalEntryCount !== expectedTotalEntryCount) {
      throw new Error('週間計画traceのentry総件数がpage間で変化しました。');
    }
    if (!Number.isSafeInteger(page.missingSequenceCount)
      || page.missingSequenceCount < 0
      || page.missingSequenceCount > WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxPageSize) {
      throw new Error('週間計画traceの欠落entry件数が不正です。');
    }
    if (page.entries.length > WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxPageSize) {
      throw new Error('週間計画traceのentry pageが上限を超えています。');
    }

    page.entries.forEach((entry) => {
      const id = typeof entry.id === 'string' ? entry.id : '';
      if (id) entriesById.set(id, entry);
    });
    missingSequenceCount += page.missingSequenceCount;

    if (page.nextAfterSequence === null) {
      const expected = expectedTotalEntryCount ?? 0;
      const inferredMissing = Math.max(0, expected - entriesById.size);
      const totalMissing = Math.max(missingSequenceCount, inferredMissing);
      if (totalMissing > 0) {
        throw new Error(
          `週間計画traceのentryが${totalMissing}件欠落しています。再取得してください。`,
        );
      }
      if (entriesById.size !== expected) {
        throw new Error('週間計画traceのentry件数がsession metadataと一致しません。');
      }
      return Array.from(entriesById.values());
    }
    if (!Number.isSafeInteger(page.nextAfterSequence)
      || page.nextAfterSequence <= afterSequence
      || page.nextAfterSequence >= WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxEntryCount) {
      throw new Error('週間計画traceのentryページcursorが不正です。');
    }
    afterSequence = page.nextAfterSequence;
  }

  throw new Error('週間計画traceのentryページ数が上限を超えました。');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function subjectAlias(record: Record<string, unknown>): string {
  return stringValue(record.subjectAlias)
    ?? stringValue(record.traceSubjectToken)
    ?? 'trace-subject';
}

function entryFromRemote(record: Record<string, unknown>): WeeklyPlanningTraceEntry | null {
  const candidate = { ...record, userId: subjectAlias(record) };
  return isWeeklyPlanningTraceEntry(candidate) ? candidate : null;
}

function isPageEndpointUnavailable(error: unknown): boolean {
  return error instanceof WeeklyPlanningTraceApiError
    && error.details.status === 404
    && error.details.code === 'trace_endpoint_not_found';
}

export function createPaginatedAdminWeeklyPlanningTraceRepository(
  base: WeeklyPlanningTraceRepository,
): WeeklyPlanningTraceRepository {
  const sessionsById = new Map<string, WeeklyPlanningTraceSession>();
  const loadedEntryCountsBySessionId = new Map<string, number>();
  const listWithDiagnostics = base.listSessionsForAdminWithDiagnostics?.bind(base);

  function rememberSessions(sessions: readonly WeeklyPlanningTraceSession[]): void {
    sessions.forEach((session) => sessionsById.set(session.id, session));
  }

  return {
    ...base,
    async listSessionsForAdmin() {
      const sessions = await base.listSessionsForAdmin();
      rememberSessions(sessions);
      return sessions;
    },
    async listSessionsForAdminWithDiagnostics() {
      const result = listWithDiagnostics
        ? await listWithDiagnostics()
        : await base.listSessionsForAdmin().then((sessions) => ({
            sessions,
            diagnostics: createWeeklyPlanningTraceAdminDiagnostics({
              rawCount: sessions.length,
              mappedSessions: sessions,
            }),
          }));
      rememberSessions(result.sessions);
      return result;
    },
    async listEntries(userId, sessionId) {
      let entries: WeeklyPlanningTraceEntry[];
      try {
        const records = await collectWeeklyPlanningTraceAdminEntryPages(sessionId);
        entries = records
          .map(entryFromRemote)
          .filter((entry): entry is WeeklyPlanningTraceEntry => Boolean(entry));
        if (entries.length !== records.length) {
          throw new Error('週間計画traceのentry schemaが不正です。');
        }
        entries.sort((left, right) => left.sequence - right.sequence);
      } catch (error) {
        if (!isPageEndpointUnavailable(error)) throw error;
        entries = await base.listEntries(userId, sessionId);
      }
      loadedEntryCountsBySessionId.set(sessionId, entries.length);
      return entries;
    },
    async archiveSessionForAdmin(sessionId, archivedAt) {
      const session = sessionsById.get(sessionId);
      const expectedEntryCount = loadedEntryCountsBySessionId.get(sessionId);
      if (!session || expectedEntryCount === undefined) {
        throw new Error(
          'archive対象のexport snapshotを確認できません。sessionを再読込してから再度exportしてください。',
        );
      }
      await archiveAdminSessionSnapshot({
        sessionId,
        expectedLastActivityAt: session.lastActivityAt,
        expectedEntryCount,
      });
      sessionsById.set(sessionId, { ...session, archivedAt });
      loadedEntryCountsBySessionId.delete(sessionId);
    },
  };
}
