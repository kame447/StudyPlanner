import { createSemanticRequestRecorder, type SemanticRequestRecorder } from '../../../shared/semanticDispatchRecorder';
import { parseSemanticCensusJoin, projectSemanticCensusRequest, semanticCensusDomain } from '../../../shared/semanticTurnCensus';
import type { AiProxyObservationContext } from './aiProxyRequestObserver';
import { isAiRequestObservabilityConfigured } from './aiRequestObservability';
import type { FirestoreTokenProvider } from './firestoreServiceAccountClient';
import { FirestoreServiceAccountClient } from './firestoreServiceAccountClient';
import { ProductObservabilityStore, type ProductObservabilityEnv } from './productObservabilityStore';

export interface SemanticCensusEnv extends ProductObservabilityEnv { SEMANTIC_CENSUS_MODE?: string }
export const semanticCensusEnabled = (env: SemanticCensusEnv) => env.SEMANTIC_CENSUS_MODE === 'typed' && isAiRequestObservabilityConfigured(env);

/** Lazily starts at the existing authenticated body boundary; no extra body read/auth/provider. */
export function createWorkerSemanticCensus(env: SemanticCensusEnv, context: AiProxyObservationContext, tokenProvider?: FirestoreTokenProvider) {
  if (!semanticCensusEnabled(env)) return undefined;
  let active: SemanticRequestRecorder | undefined;
  let joined = false;
  const recorder: SemanticRequestRecorder = {
    matchesPurpose(purpose) {
      const domain = semanticCensusDomain(purpose);
      if (!domain) return false;
      if (active) return active.matchesPurpose(purpose);
      try {
        const body = context.requestBody?.kind === 'parsed' ? context.requestBody.payload : null;
        const join = parseSemanticCensusJoin(body && typeof body === 'object' ? (body as Record<string, unknown>).semanticCensus : null);
        joined = join?.domain === domain;
        active = createSemanticRequestRecorder({
          population: { source: 'actual', domain, arm: 'baseline', corpusId: crypto.randomUUID() },
          turnId: joined ? join!.turnId : crypto.randomUUID(), requestId: joined ? join!.requestId : crypto.randomUUID(),
          stage: joined ? join!.stage : 'initial', boundary: 'worker', bestEffort: true,
        });
        return true;
      } catch { return false; }
    },
    markUnknown() { active?.markUnknown(); },
    hasPostMainWork() { return active?.hasPostMainWork() ?? false; },
    track(work) { return active ? active.track(work) : work; },
    providerFetch(provider, family, stage, transport, onDispatch) { return active ? active.providerFetch(provider, family, stage, transport, onDispatch) : transport ?? fetch; },
    refineOutcome(ids, outcome) { active?.refineOutcome(ids, outcome); },
    markUnobservedProxy() { active?.markUnobservedProxy(); },
    finishMain() { active?.finishMain(); },
    async settle() { await active?.settle(); },
    snapshot() { if (!active) throw new Error('Census has no semantic request.'); return active.snapshot(); },
  };
  return {
    recorder,
    async persist(httpStatus: number) {
      try {
        if (!active || context.identity.kind !== 'authenticated') return;
        const event = projectSemanticCensusRequest(active.snapshot(), joined, httpStatus, active.hasPostMainWork());
        await new ProductObservabilityStore(env, new FirestoreServiceAccountClient(env, tokenProvider))
          .storeSemanticCensus(context.identity.firebaseUid, event);
      } catch { /* Best-effort and no free-form error/log payload. */ }
    },
  };
}
