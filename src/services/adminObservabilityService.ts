import type { ObservabilityEnvironment } from '../../shared/productObservabilityContract';
import type {
  ObservabilityAdminIdentityMatch,
  ObservabilityAdminUserTrend,
  ObservabilityAdminUserListItem,
  ObservabilityAiAnalysisReadModel,
  ObservabilityUserInvestigationReadModel,
} from '../../shared/productObservabilityAdminReadModel';
import type {
  ObservabilityDebugBundleV1,
  ObservabilityLogEntryPage,
  ObservabilityLogSessionPage,
} from '../../shared/productObservabilityLogReadModel';
import type { ObservabilityOverviewReadModel } from '../../shared/productObservabilityReadModel';
import type { ObservabilityPlanningAnalysisReadModel } from '../../shared/productObservabilityPlanningReadModel';
import type { ObservabilitySystemReadModel } from '../../shared/productObservabilitySystemReadModel';
import { getCloudflareAiProxyUrl } from '../lib/aiConfig';
import { getFirebaseAuth } from '../lib/firebaseClient';

export interface AdminObservabilityUserPage {
  users: ObservabilityAdminUserListItem[];
  nextCursor: string | null;
  enrichmentReady: boolean;
  trend: ObservabilityAdminUserTrend;
}

export interface AdminObservabilityUserInvestigation
  extends Omit<ObservabilityUserInvestigationReadModel, 'nextCursor'> {
  nextCursor: string | null;
}

function todayInTokyo(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function shiftDate(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isActiveUserWindows(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1
    && (value.environment === 'production'
      || value.environment === 'preview'
      || value.environment === 'development'
      || value.environment === 'test')
    && isIsoDate(value.asOfDate)
    && value.reportingTimeZone === 'Asia/Tokyo'
    && isCount(value.today)
    && isCount(value.last7Days)
    && isCount(value.last30Days)
    && Number(value.last7Days) >= Number(value.today)
    && Number(value.last30Days) >= Number(value.last7Days)
    && isIsoTimestamp(value.updatedAt)
    && isIsoTimestamp(value.expireAt);
}

function readUserTrend(value: unknown): ObservabilityAdminUserTrend | null {
  if (!isRecord(value) || !Array.isArray(value.daily)) return null;
  if (!value.daily.every((entry) => isRecord(entry)
    && isIsoDate(entry.localDate)
    && isCount(entry.activeActorCount))) return null;
  if (value.activeUsers !== null && !isActiveUserWindows(value.activeUsers)) return null;
  return {
    daily: value.daily as ObservabilityAdminUserTrend['daily'],
    activeUsers: value.activeUsers as ObservabilityAdminUserTrend['activeUsers'],
  };
}

function normalizeAdminUser(
  user: ObservabilityAdminUserListItem,
): ObservabilityAdminUserListItem {
  const recentErrorState = user.recentErrorState === 'present'
    || user.recentErrorState === 'absent'
    || user.recentErrorState === 'unknown'
    ? user.recentErrorState
    : 'unknown';
  return {
    ...user,
    activeDayCount: Number.isSafeInteger(user.activeDayCount)
      && Number(user.activeDayCount) >= 0
      ? Number(user.activeDayCount)
      : null,
    recentErrorState,
    recentErrorAt: recentErrorState === 'present' && typeof user.recentErrorAt === 'string'
      ? user.recentErrorAt
      : null,
    recentErrorCategory:
      recentErrorState === 'present' && typeof user.recentErrorCategory === 'string'
        ? user.recentErrorCategory
        : null,
  };
}

function proxyBaseUrl(): string {
  const proxyUrl = getCloudflareAiProxyUrl();
  if (!proxyUrl) throw new Error('Observability proxy is not configured.');
  return proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/planning-attachment$/, '')
    .replace(/\/planning-transcription$/, '');
}

async function adminGet<T>(path: string, query: URLSearchParams): Promise<T> {
  const user = getFirebaseAuth()?.currentUser;
  if (!user) throw new Error('Admin authentication is required.');
  const idToken = await user.getIdToken();
  const url = `${proxyBaseUrl()}${path}?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string'
      ? payload.error
      : `Observability admin request failed: ${response.status}`);
  }
  return payload as unknown as T;
}

export async function getAdminObservabilityOverview(params: {
  fromDate: string;
  toDate: string;
  environment?: ObservabilityEnvironment;
}): Promise<ObservabilityOverviewReadModel> {
  const query = new URLSearchParams({
    from: params.fromDate,
    to: params.toDate,
    ...(params.environment ? { environment: params.environment } : {}),
  });
  const payload = await adminGet<{ ok: true; result: ObservabilityOverviewReadModel }>(
    '/observability/admin/overview',
    query,
  );
  return payload.result;
}

export async function getAdminObservabilityAiAnalysis(params: {
  fromDate: string;
  toDate: string;
  environment?: ObservabilityEnvironment;
}): Promise<ObservabilityAiAnalysisReadModel> {
  const query = new URLSearchParams({
    from: params.fromDate,
    to: params.toDate,
    ...(params.environment ? { environment: params.environment } : {}),
  });
  const payload = await adminGet<{ ok: true; result: ObservabilityAiAnalysisReadModel }>(
    '/observability/admin/ai',
    query,
  );
  return payload.result;
}

export async function getAdminObservabilityPlanningAnalysis(params: {
  fromDate: string;
  toDate: string;
  environment?: ObservabilityEnvironment;
}): Promise<ObservabilityPlanningAnalysisReadModel> {
  const query = new URLSearchParams({
    from: params.fromDate,
    to: params.toDate,
    ...(params.environment ? { environment: params.environment } : {}),
  });
  const payload = await adminGet<{ ok: true; result: ObservabilityPlanningAnalysisReadModel }>(
    '/observability/admin/planning',
    query,
  );
  return payload.result;
}

export async function getAdminObservabilitySystemStatus(params: {
  environment?: ObservabilityEnvironment;
} = {}): Promise<ObservabilitySystemReadModel> {
  const query = new URLSearchParams();
  if (params.environment) query.set('environment', params.environment);
  const payload = await adminGet<{ ok: true; result: ObservabilitySystemReadModel }>(
    '/observability/admin/system',
    query,
  );
  return payload.result;
}

export async function getAdminObservabilityLogs(params: {
  cursor?: string | null;
  limit?: number;
  status?: string | null;
  sessionId?: string | null;
} = {}): Promise<ObservabilityLogSessionPage> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.status) query.set('status', params.status);
  if (params.sessionId) query.set('session', params.sessionId);
  const payload = await adminGet<{
    ok: true;
    sessions: ObservabilityLogSessionPage['sessions'];
    nextCursor: string | null;
  }>('/observability/admin/logs', query);
  return { sessions: payload.sessions, nextCursor: payload.nextCursor };
}

export async function getAdminObservabilityLogEntries(params: {
  sessionId: string;
  afterSequence?: number;
  limit?: number;
}): Promise<ObservabilityLogEntryPage> {
  const query = new URLSearchParams({ session: params.sessionId });
  if (params.afterSequence !== undefined) query.set('after', String(params.afterSequence));
  if (params.limit) query.set('limit', String(params.limit));
  const payload = await adminGet<{ ok: true; result: ObservabilityLogEntryPage }>(
    '/observability/admin/log-entries',
    query,
  );
  return payload.result;
}

export async function getAdminObservabilityDebugBundle(params: {
  sessionId: string;
  requestId?: string | null;
}): Promise<ObservabilityDebugBundleV1> {
  const query = new URLSearchParams({ session: params.sessionId });
  if (params.requestId) query.set('request', params.requestId);
  const payload = await adminGet<{ ok: true; bundle: ObservabilityDebugBundleV1 }>(
    '/observability/admin/debug-bundle',
    query,
  );
  return payload.bundle;
}

export async function resolveAdminObservabilityUserIdentity(
  search: string,
): Promise<ObservabilityAdminIdentityMatch[]> {
  const payload = await adminGet<{
    ok: true;
    matches: ObservabilityAdminIdentityMatch[];
  }>('/observability/admin/user-identity', new URLSearchParams({ q: search }));
  return payload.matches;
}

export async function getAdminObservabilityUsers(params: {
  environment?: ObservabilityEnvironment;
  cursor?: string | null;
  limit?: number;
} = {}): Promise<AdminObservabilityUserPage> {
  const query = new URLSearchParams();
  if (params.environment) query.set('environment', params.environment);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const payload = await adminGet<{
    ok: true;
    users: ObservabilityAdminUserListItem[];
    nextCursor: string | null;
    enrichmentReady?: boolean;
    trend?: ObservabilityAdminUserTrend;
  }>('/observability/admin/users', query);
  const hasEnrichmentField = Object.prototype.hasOwnProperty.call(payload, 'enrichmentReady');
  const hasTrendField = Object.prototype.hasOwnProperty.call(payload, 'trend');
  const hasCurrentResponseShape = hasEnrichmentField && hasTrendField;
  let trend: ObservabilityAdminUserTrend;
  if (hasCurrentResponseShape) {
    const responseTrend = readUserTrend(payload.trend);
    if (typeof payload.enrichmentReady !== 'boolean' || !responseTrend) {
      throw new Error('Observability Users response was invalid.');
    }
    trend = responseTrend;
  } else {
    const toDate = todayInTokyo();
    const overview = await getAdminObservabilityOverview({
      environment: params.environment,
      fromDate: shiftDate(toDate, -29),
      toDate,
    });
    trend = {
      daily: overview.daily,
      activeUsers: overview.activeUsers,
    };
  }
  return {
    users: payload.users.map(normalizeAdminUser),
    nextCursor: payload.nextCursor,
    enrichmentReady: hasCurrentResponseShape ? payload.enrichmentReady ?? false : false,
    trend,
  };
}

export async function getAdminObservabilityUserInvestigation(params: {
  actorSubjectId: string;
  environment?: ObservabilityEnvironment;
  cursor?: string | null;
  limit?: number;
}): Promise<AdminObservabilityUserInvestigation> {
  const query = new URLSearchParams({ actor: params.actorSubjectId });
  if (params.environment) query.set('environment', params.environment);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const payload = await adminGet<{
    ok: true;
    result: AdminObservabilityUserInvestigation;
  }>('/observability/admin/users', query);
  return payload.result;
}
