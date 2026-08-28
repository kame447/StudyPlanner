import type { ObservabilityEnvironment } from '../../shared/productObservabilityContract';
import type {
  ObservabilityOverviewReadModel,
  ObservabilityUserSummary,
} from '../../shared/productObservabilityReadModel';
import { getCloudflareAiProxyUrl } from '../lib/aiConfig';
import { getFirebaseAuth } from '../lib/firebaseClient';

export interface AdminObservabilityUserPage {
  users: ObservabilityUserSummary[];
  nextCursor: string | null;
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
    users: ObservabilityUserSummary[];
    nextCursor: string | null;
  }>('/observability/admin/users', query);
  return {
    users: payload.users,
    nextCursor: payload.nextCursor,
  };
}
