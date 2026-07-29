import {
  WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING,
  WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
  WEEKLY_PLANNING_TRACE_HEADERS,
} from '../../../../shared/weeklyPlanningTraceContract';
import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import { getFirebaseAuth } from '../../../lib/firebaseClient';
import {
  isWeeklyPlanningTraceEntry,
  type WeeklyPlanningTraceEntry,
} from './weeklyPlanningTraceTypes';

export interface WeeklyPlanningTraceAdminEntryPage {
  entries: WeeklyPlanningTraceEntry[];
  totalEntryCount: number;
  nextAfterSequence: number | null;
  missingSequenceCount: number;
  responseBytes: number;
}

function baseUrl(): string {
  const configured = getCloudflareAiProxyUrl().trim();
  if (!configured) throw new Error('週間計画の会話記録用サーバーが設定されていません。');
  return configured.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function mappedEntry(value: unknown): WeeklyPlanningTraceEntry | null {
  if (!isRecord(value)) return null;
  const isTurnDiagnosticV2 = value.kind === 'turn_diagnostic' && value.schemaVersion === 2;
  const subjectAlias = typeof value.subjectAlias === 'string'
    ? value.subjectAlias
    : 'trace-subject';
  const candidate = isTurnDiagnosticV2 ? { ...value } : { ...value, userId: subjectAlias };
  return isWeeklyPlanningTraceEntry(candidate) ? candidate : null;
}

export async function fetchWeeklyPlanningTraceAdminEntryPage(params: {
  sessionId: string;
  afterSequence?: number;
}): Promise<WeeklyPlanningTraceAdminEntryPage> {
  const user = getFirebaseAuth()?.currentUser;
  if (!user) throw new Error('ログイン状態を確認できませんでした。');
  const afterSequence = params.afterSequence ?? -1;
  if (!Number.isSafeInteger(afterSequence) || afterSequence < -1) {
    throw new Error('週間計画traceのページ送り情報が不正です。');
  }
  const token = await user.getIdToken();
  const response = await fetch(`${baseUrl()}/weekly-planning-trace/admin/entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      [WEEKLY_PLANNING_TRACE_HEADERS.contractVersion]: WEEKLY_PLANNING_TRACE_CONTRACT_VERSION,
      [WEEKLY_PLANNING_TRACE_HEADERS.correlationId]: typeof crypto !== 'undefined'
        && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `trace-page-${Date.now()}`,
    },
    body: JSON.stringify({
      sessionId: params.sessionId,
      afterSequence,
      limit: WEEKLY_PLANNING_TRACE_ADMIN_ENTRY_PAGING.maxPageSize,
    }),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  const body = isRecord(payload) ? payload : {};
  if (!response.ok || body.ok === false) {
    throw new Error(typeof body.error === 'string'
      ? body.error
      : `週間計画traceを取得できませんでした（${response.status}）。`);
  }
  const responseContract = response.headers.get(WEEKLY_PLANNING_TRACE_HEADERS.contractVersion)
    ?? (typeof body.contractVersion === 'string' ? body.contractVersion : '');
  if (responseContract !== WEEKLY_PLANNING_TRACE_CONTRACT_VERSION) {
    throw new Error('週間計画traceのfrontendとWorkerの契約versionが一致しません。');
  }
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  const entries = rawEntries.map(mappedEntry)
    .filter((entry): entry is WeeklyPlanningTraceEntry => Boolean(entry))
    .sort((left, right) => left.sequence - right.sequence);
  if (entries.length !== rawEntries.length) {
    throw new Error('週間計画traceに読み取れないentryが含まれています。');
  }
  const totalEntryCount = safeInteger(body.totalEntryCount, -1);
  const missingSequenceCount = safeInteger(body.missingSequenceCount, 0);
  if (totalEntryCount < 0) throw new Error('週間計画traceの総件数が不正です。');
  if (missingSequenceCount > 0) {
    throw new Error(`週間計画traceに${missingSequenceCount}件の欠落があります。`);
  }
  const nextAfterSequence = body.nextAfterSequence === null
    ? null
    : typeof body.nextAfterSequence === 'number'
      && Number.isSafeInteger(body.nextAfterSequence)
      && body.nextAfterSequence > afterSequence
      ? body.nextAfterSequence
      : Number.NaN;
  if (Number.isNaN(nextAfterSequence)) {
    throw new Error('週間計画traceのページ送り情報が不正です。');
  }
  return {
    entries,
    totalEntryCount,
    nextAfterSequence,
    missingSequenceCount,
    responseBytes: safeInteger(body.responseBytes, 0),
  };
}
