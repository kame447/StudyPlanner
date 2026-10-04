import type { SemanticRequestRecorder } from '../../../shared/semanticDispatchRecorder';
import { createOpenRouterDecisionProvider } from './decision/openRouterDecisionProvider';
import type { DecisionProvider } from './decision/decisionProvider';
import { CONTEXTUAL_DECISION_CATALOG, CONTEXTUAL_JEV_TIMEOUT_MS } from './decision/contextualDecisionPolicy';
import { TEMPORAL_SCOPE_REPAIR_DECISION_CATALOG, TEMPORAL_SCOPE_REPAIR_JEV_TIMEOUT_MS } from './decision/temporalScopeRepairDecisionPolicy';
import { USER_CONTEXT_ROUTING_DECISION_CATALOG, USER_CONTEXT_ROUTING_JEV_TIMEOUT_MS } from './decision/userContextRoutingPolicy';

/** Invoked only by the offline/injected harness, never selected by a request header or env flag. */
export function observedDecisionProviders(recorder: SemanticRequestRecorder | undefined, apiKey: string | undefined, mode: unknown) {
  // Keep the normal dispatcher's no-key/off configuration behavior unchanged.
  if (!recorder || !apiKey?.trim()) return undefined;
  function observe<TState, TDecision extends string>(factory: (transport: typeof fetch) => DecisionProvider<TState, TDecision>): DecisionProvider<TState, TDecision> {
    return { async evaluate(state, signal) {
      const ids: string[] = [];
      const transport = recorder!.providerFetch('openrouter', 'jev', mode === 'shadow' ? 'shadow' : recorder!.snapshot().stage, fetch, (id) => ids.push(id));
      const result = await factory(transport).evaluate(state, signal);
      // Adapter-owned timers use AbortError too. Its typed result distinguishes timeout from user cancellation.
      if (result.status === 'unavailable' && (result.reason === 'timeout' || result.reason === 'cancelled')) recorder!.refineOutcome(ids, result.reason);
      return result;
    } };
  }
  return {
    authorization: observe((observedFetch) => createOpenRouterDecisionProvider({ apiKey, fetch: observedFetch })),
    contextual: observe((observedFetch) => createOpenRouterDecisionProvider<unknown, typeof CONTEXTUAL_DECISION_CATALOG.decisions[number]>({
      apiKey, fetch: observedFetch, catalog: CONTEXTUAL_DECISION_CATALOG, timeoutMs: CONTEXTUAL_JEV_TIMEOUT_MS,
    })),
    temporal: observe((observedFetch) => createOpenRouterDecisionProvider<unknown, typeof TEMPORAL_SCOPE_REPAIR_DECISION_CATALOG.decisions[number]>({
      apiKey, fetch: observedFetch, catalog: TEMPORAL_SCOPE_REPAIR_DECISION_CATALOG, timeoutMs: TEMPORAL_SCOPE_REPAIR_JEV_TIMEOUT_MS,
    })),
    userContext: observe((observedFetch) => createOpenRouterDecisionProvider<unknown, typeof USER_CONTEXT_ROUTING_DECISION_CATALOG.decisions[number]>({
      apiKey, fetch: observedFetch, catalog: USER_CONTEXT_ROUTING_DECISION_CATALOG, timeoutMs: USER_CONTEXT_ROUTING_JEV_TIMEOUT_MS,
    })),
  };
}

export function observeSemanticBackgroundWork(context: ExecutionContext | undefined, recorder: SemanticRequestRecorder): ExecutionContext | undefined {
  if (!context) return undefined;
  const observed = Object.create(context) as ExecutionContext;
  observed.waitUntil = (work: Promise<unknown>) => { recorder.track(work); context.waitUntil(work); };
  return observed;
}
