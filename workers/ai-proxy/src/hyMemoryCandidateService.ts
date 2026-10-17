/** Authenticated Worker -> private Hy Memory bridge. Never expose the bridge token to clients. */
export interface HyMemoryCandidateEnv {
  HY_MEMORY_CANDIDATE_MODE?: string;
  HY_MEMORY_BRIDGE_BASE_URL?: string;
  HY_MEMORY_BRIDGE_TOKEN?: string;
}

export type HyMemoryCandidateResponse =
  | { status: 'unavailable' }
  | { status: 'ready'; ownerId: string; sourceRevision: number; recordIds: string[] };

const TIMEOUT_MS = 1500;
const MAX_RECORD_IDS = 10;

function endpoint(env: HyMemoryCandidateEnv): string | null {
  const base = env.HY_MEMORY_BRIDGE_BASE_URL?.trim();
  const token = env.HY_MEMORY_BRIDGE_TOKEN?.trim();
  if (env.HY_MEMORY_CANDIDATE_MODE !== 'shadow' || !base || !token || token.length < 32) {
    return null;
  }
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return new URL('/v1/search', url).toString();
  } catch {
    return null;
  }
}

export async function queryHyMemoryCandidateIds(params: {
  env: HyMemoryCandidateEnv;
  ownerId: string;
  sourceRevision: number;
  query: string;
  fetcher?: typeof fetch;
}): Promise<HyMemoryCandidateResponse> {
  const url = endpoint(params.env);
  if (!url || !params.ownerId || params.ownerId.length > 128
    || !Number.isSafeInteger(params.sourceRevision) || params.sourceRevision < 0
    || typeof params.query !== 'string' || !params.query.trim()
    || params.query.length > 1000) {
    return { status: 'unavailable' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await (params.fetcher ?? fetch)(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + params.env.HY_MEMORY_BRIDGE_TOKEN?.trim(),
      },
      body: JSON.stringify({
        ownerId: params.ownerId,
        sourceRevision: params.sourceRevision,
        query: params.query,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { status: 'unavailable' };
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return { status: 'unavailable' };
    }
    const body = result as Record<string, unknown>;
    if (body.status !== 'ready' || body.ownerId !== params.ownerId
      || body.sourceRevision !== params.sourceRevision || !Array.isArray(body.recordIds)
      || body.recordIds.length > MAX_RECORD_IDS) {
      return { status: 'unavailable' };
    }
    const ids = body.recordIds;
    if (!ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)
      || new Set(ids).size !== ids.length) {
      return { status: 'unavailable' };
    }
    return {
      status: 'ready',
      ownerId: params.ownerId,
      sourceRevision: params.sourceRevision,
      recordIds: ids as string[],
    };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
