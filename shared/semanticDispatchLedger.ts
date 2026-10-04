/** Evaluation-only evidence. Never infer these facts from proxy success or attemptCount. */
export const SEMANTIC_DISPATCH_STAGES = ['initial', 'focused', 'audit', 'repair', 'retry', 'fallback', 'shadow', 'race'] as const;
export type SemanticDispatchStage = typeof SEMANTIC_DISPATCH_STAGES[number];
export type SemanticPopulation = {
  source: 'actual' | 'fixture' | 'synthetic';
  domain: 'weekly-planning' | 'user-context';
  arm: 'baseline' | 'treatment';
  /** Opaque corpus identity. Separate runs/modes must use different identities. */
  corpusId: string;
};
export type SemanticUsage = { inputTokens: number | null; outputTokens: number | null; costUsd: number | null };
export type SemanticDispatch = {
  dispatchId: string;
  requestId: string;
  turnId: string;
  provider: 'openai' | 'openrouter';
  family: 'luna' | 'jev' | 'other' | 'unknown';
  stage: SemanticDispatchStage;
  startedAtMs: number;
  completedAtMs: number | null;
  outcome: 'success' | 'http_error' | 'network_error' | 'timeout' | 'cancelled' | 'unknown';
  usage: SemanticUsage;
};
export type SemanticRequestObservation = {
  version: 1;
  population: SemanticPopulation;
  turnId: string;
  requestId: string;
  stage: SemanticDispatchStage;
  boundary: 'worker' | 'direct' | 'unobserved_proxy';
  startedAtMs: number;
  mainCompletedAtMs: number | null;
  settledAtMs: number | null;
  integrity: 'complete' | 'unknown';
  /** Closure manifest detects dropped/truncated dispatch records; null until settled. */
  dispatchIds: string[] | null;
  dispatches: SemanticDispatch[];
};
export type SemanticTurnObservation = {
  version: 1;
  population: SemanticPopulation;
  turnId: string;
  /** Same opaque pairId in both arms; a turnId identifies one execution only. */
  pairId: string;
  expectedRequestIds: string[];
  sealed: boolean;
  startedAtMs: number;
  completedAtMs: number | null;
  semanticResolution: 'success' | 'failure' | 'unknown';
  /** Application outcome, never inferred from provider text or route. Missing is NA. */
  mutatingCommit?: boolean | null;
};

export const emptySemanticUsage = (): SemanticUsage => ({ inputTokens: null, outputTokens: null, costUsd: null });
export const samePopulation = (a: SemanticPopulation, b: SemanticPopulation): boolean =>
  isSemanticPopulation(a) && isSemanticPopulation(b) && a.source === b.source && a.domain === b.domain && a.arm === b.arm && a.corpusId === b.corpusId;
export const isOpaqueSemanticId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const finiteTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const finiteUsage = (value: unknown): value is number | null => value === null
  || typeof value === 'number' && Number.isFinite(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const member = (value: unknown, values: readonly string[]): boolean => typeof value === 'string' && values.includes(value);
const nullableTime = (value: unknown): boolean => value === null || finiteTime(value);
function isSemanticPopulation(value: unknown): value is SemanticPopulation {
  return object(value) && member(value.source, ['actual', 'fixture', 'synthetic'])
    && member(value.domain, ['weekly-planning', 'user-context']) && member(value.arm, ['baseline', 'treatment']) && isOpaqueSemanticId(value.corpusId);
}
function isDispatch(value: unknown): value is SemanticDispatch {
  return object(value) && isOpaqueSemanticId(value.dispatchId) && isOpaqueSemanticId(value.requestId) && isOpaqueSemanticId(value.turnId)
    && member(value.provider, ['openai', 'openrouter']) && member(value.family, ['luna', 'jev', 'other', 'unknown'])
    && member(value.stage, SEMANTIC_DISPATCH_STAGES) && finiteTime(value.startedAtMs) && nullableTime(value.completedAtMs)
    && member(value.outcome, ['success', 'http_error', 'network_error', 'timeout', 'cancelled', 'unknown'])
    && object(value.usage) && finiteUsage(value.usage.inputTokens) && finiteUsage(value.usage.outputTokens) && finiteUsage(value.usage.costUsd)
    && (value.usage.inputTokens === null || Number.isSafeInteger(value.usage.inputTokens))
    && (value.usage.outputTokens === null || Number.isSafeInteger(value.usage.outputTokens));
}
function isRequest(value: unknown): value is SemanticRequestObservation {
  return object(value) && value.version === 1 && isSemanticPopulation(value.population) && isOpaqueSemanticId(value.turnId) && isOpaqueSemanticId(value.requestId)
    && member(value.stage, SEMANTIC_DISPATCH_STAGES) && member(value.boundary, ['worker', 'direct', 'unobserved_proxy'])
    && finiteTime(value.startedAtMs) && nullableTime(value.mainCompletedAtMs) && nullableTime(value.settledAtMs)
    && member(value.integrity, ['complete', 'unknown']) && (value.dispatchIds === null || Array.isArray(value.dispatchIds) && value.dispatchIds.every(isOpaqueSemanticId))
    && Array.isArray(value.dispatches) && value.dispatches.every(isDispatch);
}

export type SemanticTurnSummary = {
  population: SemanticPopulation;
  turnId: string;
  pairId: string;
  status: 'known' | 'unknown';
  reasons: string[];
  /** Lower bound survives incomplete observation; never promote it to an exact count. */
  observedLunaDispatches: number;
  lunaDispatches: number | null;
  jevDispatches: number | null;
  lunaFree: boolean | null;
  semanticResolution: SemanticTurnObservation['semanticResolution'];
  dispatchesByStage: Record<SemanticDispatchStage, number>;
  elapsedMs: number | null;
  usage: SemanticUsage;
};

export function summarizeSemanticTurn(turn: SemanticTurnObservation, observations: readonly SemanticRequestObservation[]): SemanticTurnSummary {
  // Public reducer is also an ingestion boundary. TypeScript casts do not validate JSON.
  if (!object(turn) || !isSemanticPopulation(turn.population) || !isOpaqueSemanticId(turn.turnId) || !isOpaqueSemanticId(turn.pairId)
    || !Array.isArray(turn.expectedRequestIds) || !turn.expectedRequestIds.every(isOpaqueSemanticId)) throw new Error('Invalid semantic turn framing.');
  const reasons = new Set<string>();
  const requests = new Map<string, SemanticRequestObservation>();
  if (!Array.isArray(observations)) reasons.add('invalid_observation_list');
  for (const request of Array.isArray(observations) ? observations : []) {
    if (!isRequest(request)) { reasons.add('invalid_request_observation'); continue; }
    if (request.turnId !== turn.turnId) { reasons.add('mixed_request_identity'); continue; }
    const previous = requests.get(request.requestId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(request)) reasons.add('conflicting_request');
    else requests.set(request.requestId, request);
  }
  if (turn.version !== 1 || !member(turn.semanticResolution, ['success', 'failure', 'unknown'])) reasons.add('invalid_turn');
  if (turn.sealed !== true || turn.completedAtMs === null) reasons.add('unsealed_turn');
  if (!finiteTime(turn.startedAtMs) || !finiteTime(turn.completedAtMs) || turn.completedAtMs < turn.startedAtMs) reasons.add('invalid_interval');
  if (new Set(turn.expectedRequestIds).size !== turn.expectedRequestIds.length) reasons.add('duplicate_manifest_request');
  const dispatches = new Map<string, SemanticDispatch>();
  for (const id of turn.expectedRequestIds) {
    if (!isOpaqueSemanticId(id)) reasons.add('invalid_request_id');
    const request = requests.get(id);
    if (!request) { reasons.add('missing_request'); continue; }
    if (request.version !== 1 || !samePopulation(request.population, turn.population)) reasons.add('mixed_population');
    if (request.integrity !== 'complete' || request.boundary === 'unobserved_proxy') reasons.add('unobserved_request');
    if (!finiteTime(request.startedAtMs) || !finiteTime(request.mainCompletedAtMs) || !finiteTime(request.settledAtMs)
      || request.mainCompletedAtMs < request.startedAtMs || request.settledAtMs < request.mainCompletedAtMs
      || request.startedAtMs < turn.startedAtMs || (turn.completedAtMs !== null && request.mainCompletedAtMs > turn.completedAtMs)) reasons.add('incomplete_request_interval');
    const actualIds = new Set(request.dispatches.map((dispatch) => dispatch.dispatchId));
    if (!Array.isArray(request.dispatchIds) || request.dispatchIds.length !== new Set(request.dispatchIds).size
      || request.dispatchIds.length !== actualIds.size || request.dispatchIds.some((id) => !actualIds.has(id))) reasons.add('incomplete_dispatch_manifest');
    for (const dispatch of request.dispatches) {
      if (dispatch.requestId !== id || dispatch.turnId !== turn.turnId || !isOpaqueSemanticId(dispatch.dispatchId)) reasons.add('unjoined_dispatch');
      const previous = dispatches.get(dispatch.dispatchId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(dispatch)) reasons.add('conflicting_dispatch');
      else dispatches.set(dispatch.dispatchId, dispatch);
      if (dispatch.family === 'unknown') reasons.add('unknown_provider_family');
      if (!SEMANTIC_DISPATCH_STAGES.includes(dispatch.stage)) reasons.add('unknown_stage');
      if (!finiteTime(dispatch.startedAtMs) || !finiteTime(dispatch.completedAtMs)
        || dispatch.completedAtMs < dispatch.startedAtMs || dispatch.startedAtMs < request.startedAtMs
        || (request.settledAtMs !== null && dispatch.completedAtMs > request.settledAtMs)
        || (turn.completedAtMs !== null && dispatch.completedAtMs > turn.completedAtMs)) reasons.add('unfinished_dispatch');
      if (!finiteUsage(dispatch.usage.inputTokens) || !finiteUsage(dispatch.usage.outputTokens) || !finiteUsage(dispatch.usage.costUsd)) reasons.add('invalid_usage');
    }
  }
  for (const id of requests.keys()) if (!turn.expectedRequestIds.includes(id)) reasons.add('unmanifested_request');
  const stages = Object.fromEntries(SEMANTIC_DISPATCH_STAGES.map((stage) => [stage, 0])) as Record<SemanticDispatchStage, number>;
  const all = [...dispatches.values()];
  const luna = all.filter((dispatch) => dispatch.family === 'luna');
  for (const dispatch of luna) if (SEMANTIC_DISPATCH_STAGES.includes(dispatch.stage)) stages[dispatch.stage] += 1;
  const known = reasons.size === 0;
  const sum = (key: keyof SemanticUsage): number | null => !known || all.some((dispatch) => dispatch.usage[key] === null)
    ? null : all.reduce((total, dispatch) => total + (dispatch.usage[key] as number), 0);
  return {
    population: { ...turn.population }, turnId: turn.turnId, pairId: turn.pairId,
    status: known ? 'known' : 'unknown', reasons: [...reasons], observedLunaDispatches: luna.length,
    lunaDispatches: known ? luna.length : null,
    jevDispatches: known ? all.filter((dispatch) => dispatch.family === 'jev').length : null,
    lunaFree: known ? luna.length === 0 : null, semanticResolution: member(turn.semanticResolution, ['success', 'failure', 'unknown']) ? turn.semanticResolution : 'unknown',
    dispatchesByStage: stages,
    // One elapsed semantic interval, including late work, never a sum of nested durations.
    elapsedMs: known ? (turn.completedAtMs as number) - turn.startedAtMs : null,
    usage: { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), costUsd: sum('costUsd') },
  };
}

export function pairedSemanticDispatchDelta(baseline: SemanticTurnSummary, treatment: SemanticTurnSummary): number | null {
  const a = baseline.population; const b = treatment.population;
  if (a.arm !== 'baseline' || b.arm !== 'treatment' || a.source !== b.source || a.domain !== b.domain
    || a.corpusId !== b.corpusId || baseline.pairId !== treatment.pairId
    || baseline.lunaDispatches === null || treatment.lunaDispatches === null) return null;
  return treatment.lunaDispatches - baseline.lunaDispatches;
}
