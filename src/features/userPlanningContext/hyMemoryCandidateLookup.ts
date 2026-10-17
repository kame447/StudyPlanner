import { getCloudflareAiProxyUrl } from '../../lib/aiConfig';
import { getFirebaseAuth } from '../../lib/firebaseClient';
import { resolveHyMemoryCandidates, type ResolvedHyMemoryCandidates } from './hyMemoryCandidateBridge';
import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';

/**
 * Optional shadow lookup. Callers must supply the committed Firestore revision,
 * not a local speculative revision. Results are never used as canonical truth.
 */
export async function lookupHyMemoryCandidateRecords(params: {
  ownerId: string;
  sourceRevision: number;
  records: readonly UserPlanningContextRecordV1[];
  query: string;
  fetcher?: typeof fetch;
}): Promise<ResolvedHyMemoryCandidates> {
  const unavailable = { status: 'unavailable', records: [] } as const;
  if (import.meta.env.VITE_HY_MEMORY_CANDIDATES !== 'shadow') return unavailable;
  const proxyUrl = getCloudflareAiProxyUrl();
  const currentUser = getFirebaseAuth()?.currentUser;
  if (!proxyUrl || !currentUser || currentUser.uid !== params.ownerId) return unavailable;
  if (!Number.isSafeInteger(params.sourceRevision) || params.sourceRevision < 0
    || !params.query.trim() || params.query.length > 1000) return unavailable;

  const endpoint = proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    + '/user-context/hy-memory/search';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const token = await currentUser.getIdToken();
    if (getFirebaseAuth()?.currentUser !== currentUser) return unavailable;
    const response = await (params.fetcher ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ sourceRevision: params.sourceRevision, query: params.query }),
      signal: controller.signal,
    });
    if (!response.ok) return unavailable;
    const indexRead: unknown = await response.json();
    if (!indexRead || typeof indexRead !== 'object' || Array.isArray(indexRead)) return unavailable;
    const candidate = indexRead as Record<string, unknown>;
    if (candidate.status !== 'ready' || candidate.ownerId !== params.ownerId
      || candidate.sourceRevision !== params.sourceRevision || !Array.isArray(candidate.recordIds)
      || candidate.recordIds.length > 10 || !candidate.recordIds.every((id) => typeof id === 'string')) {
      return unavailable;
    }
    return resolveHyMemoryCandidates({
      ownerId: params.ownerId,
      sourceRevision: params.sourceRevision,
      records: params.records,
      indexRead: {
        status: 'ready',
        ownerId: params.ownerId,
        sourceRevision: params.sourceRevision,
        recordIds: candidate.recordIds as string[],
      },
    });
  } catch {
    return unavailable;
  } finally {
    clearTimeout(timeout);
  }
}
