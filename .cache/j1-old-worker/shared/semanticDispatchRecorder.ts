import {
  emptySemanticUsage, isOpaqueSemanticId, SEMANTIC_DISPATCH_STAGES,
  type SemanticDispatch, type SemanticDispatchStage, type SemanticPopulation,
  type SemanticRequestObservation,
} from './semanticDispatchLedger';

const MAX_USAGE_RESPONSE_BYTES = 65_536;
const nullableNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const nullableTokens = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** No singleton, storage, console output, network sink or user text. */
export function createSemanticRequestRecorder(params: {
  population: SemanticPopulation;
  turnId: string;
  requestId: string;
  stage: SemanticDispatchStage;
  boundary: SemanticRequestObservation['boundary'];
  now?: () => number;
  createId?: () => string;
  /** Production observation must never prevent or repeat the underlying send. */
  bestEffort?: boolean;
}) {
  if (![params.population.corpusId, params.turnId, params.requestId].every(isOpaqueSemanticId)
    || !SEMANTIC_DISPATCH_STAGES.includes(params.stage)
    || !['actual', 'fixture', 'synthetic'].includes(params.population.source)
    || !['weekly-planning', 'user-context'].includes(params.population.domain)
    || !['baseline', 'treatment'].includes(params.population.arm)) throw new Error('Invalid semantic recorder identity.');
  const now = params.now ?? Date.now;
  const createId = params.createId ?? (() => crypto.randomUUID());
  const observation: SemanticRequestObservation = {
    version: 1,
    // Explicit projection also removes extra fields supplied by an untyped caller.
    population: { source: params.population.source, domain: params.population.domain, arm: params.population.arm, corpusId: params.population.corpusId },
    turnId: params.turnId, requestId: params.requestId, stage: params.stage, boundary: params.boundary,
    startedAtMs: now(), mainCompletedAtMs: null, settledAtMs: null,
    integrity: params.boundary === 'unobserved_proxy' ? 'unknown' : 'complete', dispatchIds: null, dispatches: [],
  };
  const pending = new Set<Promise<unknown>>();
  let postMainWork = false; // Execution order remains evidence when Date.now() has equal millisecond values.
  const refinedOutcomes = new Map<string, SemanticDispatch['outcome']>();
  const markUnknown = () => { observation.integrity = 'unknown'; };
  function track<T>(work: Promise<T>): Promise<T> {
    if (observation.settledAtMs !== null) markUnknown();
    pending.add(work);
    void work.then(() => pending.delete(work), () => { pending.delete(work); markUnknown(); });
    return work;
  }
  async function readUsage(response: Response, signal: AbortSignal | null | undefined): Promise<Record<string, unknown> | null> {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = []; let bytes = 0;
    let cancelled = false;
    const cancel = () => { cancelled = true; void reader.cancel().catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      while (!cancelled) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_USAGE_RESPONSE_BYTES) { cancel(); return null; }
        chunks.push(chunk.value);
      }
      if (cancelled) return null;
      const body = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return record(JSON.parse(new TextDecoder().decode(body)));
    } catch { return null; }
    finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  }
  function providerFetch(provider: SemanticDispatch['provider'], family: SemanticDispatch['family'], stage = params.stage, transport: typeof fetch = fetch, onDispatch?: (id: string) => void): typeof fetch {
    return async (input, init) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      // A pre-dispatch timeout/cancellation is a known zero. Fetch has not been invoked.
      if (signal?.aborted) throw signal.reason ?? new Error('Provider request cancelled before dispatch.');
      if (observation.boundary === 'unobserved_proxy') markUnknown();
      let dispatchId: string;
      try {
        dispatchId = createId();
        if (!isOpaqueSemanticId(dispatchId) || observation.dispatches.some((item) => item.dispatchId === dispatchId)) throw new Error('Invalid semantic dispatch identity.');
      } catch (error) {
        if (!params.bestEffort) throw error;
        markUnknown();
        return transport(input, init);
      }
      if (observation.settledAtMs !== null) markUnknown();
      if (observation.mainCompletedAtMs !== null) postMainWork = true;
      const dispatch: SemanticDispatch = {
        dispatchId, requestId: params.requestId, turnId: params.turnId,
        provider, family, stage, startedAtMs: now(), completedAtMs: null, outcome: 'unknown', usage: emptySemanticUsage(),
      };
      observation.dispatches.push(dispatch);
      try { onDispatch?.(dispatchId); }
      catch (error) { if (!params.bestEffort) throw error; markUnknown(); }
      try {
        // This exact call is the dispatch boundary. One invocation, including failure, counts once.
        const response = await transport(input, init);
        if (observation.mainCompletedAtMs !== null) postMainWork = true;
        let usageResponse: Response;
        try { usageResponse = response.clone(); }
        catch (error) {
          if (!params.bestEffort) throw error;
          markUnknown(); dispatch.completedAtMs = now();
          return response;
        }
        const completion = readUsage(usageResponse, signal).then((root) => {
          if (observation.mainCompletedAtMs !== null) postMainWork = true;
          const usage = record(root?.usage);
          dispatch.usage = {
            inputTokens: nullableTokens(provider === 'openrouter' ? usage?.input_tokens : usage?.prompt_tokens),
            outputTokens: nullableTokens(provider === 'openrouter' ? usage?.output_tokens : usage?.completion_tokens),
            costUsd: nullableNumber(usage?.cost),
          };
          dispatch.outcome = signal?.aborted
            ? signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled'
            : !response.ok ? 'http_error' : root === null ? 'unknown' : 'success';
          dispatch.outcome = refinedOutcomes.get(dispatchId) ?? dispatch.outcome;
          dispatch.completedAtMs = now();
        });
        track(completion);
        return response;
      } catch (error) {
        if (observation.mainCompletedAtMs !== null) postMainWork = true;
        dispatch.outcome = signal?.aborted
          ? signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled'
          : 'network_error';
        dispatch.completedAtMs = now();
        throw error;
      }
    };
  }
  return {
    markUnknown, track, providerFetch,
    hasPostMainWork: () => postMainWork,
    refineOutcome(ids: string[], outcome: 'timeout' | 'cancelled') {
      for (const id of ids) {
        const dispatch = observation.dispatches.find((item) => item.dispatchId === id);
        if (!dispatch) { markUnknown(); continue; }
        refinedOutcomes.set(id, outcome); dispatch.outcome = outcome;
      }
    },
    matchesPurpose(purpose: unknown): boolean {
      const allowed = observation.population.domain === 'weekly-planning'
        ? purpose === 'weekly_planning_semantic_normalizer' || purpose === 'weekly_planning_interpreter'
        : purpose === 'user_context_interpreter';
      if (!allowed) markUnknown();
      return allowed;
    },
    /** Proxy transport alone never provides provider evidence. */
    markUnobservedProxy() { observation.boundary = 'unobserved_proxy'; markUnknown(); },
    finishMain() {
      if (observation.mainCompletedAtMs !== null) markUnknown();
      observation.mainCompletedAtMs = now();
    },
    async settle() {
      if (observation.mainCompletedAtMs === null) markUnknown();
      // Background tasks may register more provider completions before they finish.
      while (pending.size) await Promise.allSettled([...pending]);
      if (observation.settledAtMs === null) observation.settledAtMs = now();
      observation.dispatchIds = observation.dispatches.map((dispatch) => dispatch.dispatchId);
    },
    snapshot(): SemanticRequestObservation { return JSON.parse(JSON.stringify(observation)) as SemanticRequestObservation; },
  };
}

export type SemanticRequestRecorder = ReturnType<typeof createSemanticRequestRecorder>;
