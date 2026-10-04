import type { OpenAiCompatibleClient } from '../../services/ai/openAiCompatibleClient';
import { getCloudflareAiProxyUrl, usesCloudflareOpenAiProxy } from '../../lib/aiConfig';
import { getFirebaseAuth } from '../../lib/firebaseClient';
import { buildProductObservabilityEventsEndpoint } from './productTelemetryRemoteSink';
import {
  parseSemanticCensusEvent, projectSemanticCensusMetadata, SEMANTIC_CENSUS_MAX_REQUESTS,
  semanticCensusDomain, type SemanticCensusDomain, type SemanticCensusEvent,
  type SemanticCensusMetadata,
  type SemanticCensusRequestObserver,
} from '../../../shared/semanticTurnCensus';
import { isOpaqueSemanticId } from '../../../shared/semanticDispatchLedger';

export type SemanticCensusSink = { write(event: SemanticCensusEvent): Promise<void> };
export function productionSemanticCensusOptions(): { enabled: boolean; sink?: SemanticCensusSink } {
  if (import.meta.env.VITE_SEMANTIC_CENSUS_MODE !== 'typed') return { enabled: false };
  let proxyUrl: string;
  try {
    proxyUrl = getCloudflareAiProxyUrl();
    if (!proxyUrl || !usesCloudflareOpenAiProxy({ provider: 'openai' })) return { enabled: false };
  } catch { return { enabled: false }; }
  return {
    enabled: true,
    sink: {
      async write(event) {
        const payload = parseSemanticCensusEvent(event);
        if (!payload || payload.kind === 'request') return;
        const user = getFirebaseAuth()?.currentUser;
        if (!user) return;
        const idToken = await user.getIdToken();
        const response = await fetch(buildProductObservabilityEventsEndpoint(proxyUrl), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify(payload),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error('Census sink unavailable.');
      },
    },
  };
}

/** One explicit, invocation-local semantic boundary; never a global current-turn variable. */
export function createSemanticTurnCensusScope(params: {
  client: OpenAiCompatibleClient; domain: SemanticCensusDomain; metadata?: SemanticCensusMetadata;
  enabled: boolean; sink?: SemanticCensusSink; createId?: () => string; now?: () => number;
}) {
  if (!params.enabled || !params.sink) return { client: params.client, finish(_resolution: 'success' | 'failure' | 'unknown') {} };
  try {
    const createId = params.createId ?? (() => crypto.randomUUID());
    const now = params.now ?? Date.now;
    const turnId = createId(); const startedAtMs = now();
    if (!isOpaqueSemanticId(turnId)) throw new Error('Invalid census identity.');
    const occurredAt = new Date(startedAtMs).toISOString();
    const metadata = projectSemanticCensusMetadata(params.metadata);
    const base = { version: 1 as const, domain: params.domain, turnId, occurredAt };
    const requestIds: string[] = []; const pending = new Set<Promise<unknown>>();
    let integrity: 'complete' | 'unknown' = 'complete'; let finished = false; let sealed = false;
    const write = (event: SemanticCensusEvent) => { try { const payload = parseSemanticCensusEvent(event); if (payload) void params.sink!.write(payload).catch(() => undefined); } catch { /* No user-facing effect. */ } };
    write({ ...base, kind: 'start', metadata });
    const observer: SemanticCensusRequestObserver = {
      observe(stage, dispatch) {
        let requestId: string;
        try { requestId = createId(); if (!isOpaqueSemanticId(requestId)) throw new Error('Invalid census identity.'); }
        catch { integrity = 'unknown'; return dispatch(undefined); }
        if (sealed || requestIds.length >= SEMANTIC_CENSUS_MAX_REQUESTS || requestIds.includes(requestId)) integrity = 'unknown';
        requestIds.push(requestId);
        const work = dispatch({ version: 1, domain: params.domain, turnId, requestId, stage });
        pending.add(work);
        void work.then(() => pending.delete(work), () => pending.delete(work));
        return work;
      },
    };
    const client: OpenAiCompatibleClient = {
      semanticCensusEnabled: true,
      semanticCensusObserver: observer,
      createChatCompletion(input) {
        if (semanticCensusDomain(input.purpose) !== params.domain) {
          integrity = 'unknown';
          return params.client.createChatCompletion(input);
        }
        return observer.observe(input.semanticCensusStage ?? (input.decisionContext ? 'focused' : 'initial'),
          (semanticCensus) => params.client.createChatCompletion({ ...input, ...(semanticCensus ? { semanticCensus } : {}) }));
      },
    };
    return {
      client,
      finish(semanticResolution: 'success' | 'failure' | 'unknown') {
        if (finished) { integrity = 'unknown'; return; }
        finished = true;
        void (async () => {
          while (pending.size) await Promise.allSettled([...pending]);
          sealed = true;
          const elapsed = now() - startedAtMs;
          const latencyMs = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
          if (latencyMs === null) integrity = 'unknown';
          write({ ...base, kind: 'closure', metadata, requestIds: [...new Set(requestIds)].slice(0, SEMANTIC_CENSUS_MAX_REQUESTS),
            integrity, semanticResolution, latencyMs });
        })().catch(() => undefined);
      },
    };
  } catch { return { client: params.client, finish(_resolution: 'success' | 'failure' | 'unknown') {} }; }
}
