import { isOpaqueSemanticId, SEMANTIC_DISPATCH_STAGES, summarizeSemanticTurn, type SemanticDispatchStage, type SemanticRequestObservation, type SemanticUsage } from './semanticDispatchLedger';

export const SEMANTIC_CENSUS_MAX_BYTES = 8192;
export const SEMANTIC_CENSUS_MAX_REQUESTS = 64;
export const SEMANTIC_CENSUS_MAX_DISPATCHES = 16;
export const SEMANTIC_CENSUS_QUESTION_CODES = [
  'ambiguous_effort_estimate', 'ambiguous_planning_window', 'missing_effort_estimate',
  'quantity_role_unresolved', 'missing_time_bounds', 'invalid_time_interval',
  'named_time_period_unresolved', 'missing_availability_date_scope',
  'missing_commitment_date_scope', 'missing_daily_capacity_date_scope',
  'unresolved_hard_date_expression', 'selected_material_remaining',
] as const;
export type SemanticCensusDomain = 'weekly-planning' | 'user-context';
export type SemanticCensusMetadata = {
  questionCode: typeof SEMANTIC_CENSUS_QUESTION_CODES[number] | null;
  targetCount: number | null;
  propositionCount: number | null;
  propositionCategories: Array<'quantity' | 'temporal' | 'reference' | 'authorization' | 'other'> | null;
  candidateCount: number | null;
  candidateHash: { algorithm: 'sha256'; digest: string } | null;
  binding: 'complete' | 'incomplete' | 'rejected' | 'unknown';
  freshness: 'matched' | 'stale' | 'unknown';
};
/** Random turn/request correlation only. No application, owner, graph or source IDs. */
export type SemanticCensusJoin = {
  version: 1;
  domain: SemanticCensusDomain;
  turnId: string;
  requestId: string;
  stage: SemanticDispatchStage;
};
/** Per-physical-request registration, also shared by independent Choice transports. */
export interface SemanticCensusRequestObserver {
  observe<T>(stage: SemanticDispatchStage, dispatch: (join: SemanticCensusJoin | undefined) => Promise<T>): Promise<T>;
}
type BaseEvent = { version: 1; domain: SemanticCensusDomain; turnId: string; occurredAt: string };
export type SemanticCensusStart = BaseEvent & { kind: 'start'; metadata: SemanticCensusMetadata };
export type SemanticCensusClosure = BaseEvent & {
  kind: 'closure'; metadata: SemanticCensusMetadata; requestIds: string[];
  integrity: 'complete' | 'unknown'; semanticResolution: 'success' | 'failure' | 'unknown';
  /** Client semantic interval only; excludes renderer and census persistence. */
  latencyMs: number | null;
};
export type SemanticCensusRequest = BaseEvent & {
  kind: 'request'; requestId: string; joined: boolean;
  stage: SemanticDispatchStage; integrity: 'complete' | 'unknown';
  route: 'luna' | 'jev' | 'jev-then-luna' | 'rejected' | 'unknown';
  outcome: 'success' | 'failure' | 'unknown';
  latencyMs: number | null; lateWork: boolean;
  lunaDispatches: number | null; jevDispatches: number | null;
  observedLunaDispatches: number; observedJevDispatches: number;
  usage: SemanticUsage;
  dispatches: Array<{
    family: 'luna' | 'jev' | 'other' | 'unknown'; stage: SemanticDispatchStage;
    outcome: 'success' | 'http_error' | 'network_error' | 'timeout' | 'cancelled' | 'unknown';
    latencyMs: number | null; usage: SemanticUsage;
  }>;
};
export type SemanticCensusEvent = SemanticCensusStart | SemanticCensusClosure | SemanticCensusRequest;

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const member = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const usage = (value: unknown): SemanticUsage => { const input = record(value); return { inputTokens: count(input?.inputTokens), outputTokens: count(input?.outputTokens), costUsd: number(input?.costUsd) }; };
export function semanticCensusDomain(purpose: unknown): SemanticCensusDomain | null {
  return purpose === 'weekly_planning_semantic_normalizer' || purpose === 'weekly_planning_interpreter' ? 'weekly-planning'
    : purpose === 'user_context_interpreter' ? 'user-context' : null;
}
export function projectSemanticCensusMetadata(value: unknown): SemanticCensusMetadata {
  const input = record(value); const hash = record(input?.candidateHash);
  const categories = input?.propositionCategories;
  const allowedCategories = ['quantity', 'temporal', 'reference', 'authorization', 'other'];
  return {
    questionCode: SEMANTIC_CENSUS_QUESTION_CODES.includes(input?.questionCode as typeof SEMANTIC_CENSUS_QUESTION_CODES[number]) ? input!.questionCode as SemanticCensusMetadata['questionCode'] : null,
    targetCount: count(input?.targetCount), propositionCount: count(input?.propositionCount),
    propositionCategories: Array.isArray(categories) && categories.length <= 5 && categories.every((item) => allowedCategories.includes(item)) ? [...new Set(categories)] as SemanticCensusMetadata['propositionCategories'] : null,
    candidateCount: count(input?.candidateCount),
    candidateHash: hash?.algorithm === 'sha256' && typeof hash.digest === 'string' && /^[a-f0-9]{64}$/.test(hash.digest) ? { algorithm: 'sha256', digest: hash.digest } : null,
    binding: member(input?.binding, ['complete', 'incomplete', 'rejected', 'unknown'], 'unknown'),
    freshness: member(input?.freshness, ['matched', 'stale', 'unknown'], 'unknown'),
  };
}
export function parseSemanticCensusJoin(value: unknown): SemanticCensusJoin | null {
  const input = record(value);
  if (!input || !exactKeys(input, ['version', 'domain', 'turnId', 'requestId', 'stage']) || input.version !== 1
    || !['weekly-planning', 'user-context'].includes(String(input.domain)) || !isOpaqueSemanticId(input.turnId)
    || !isOpaqueSemanticId(input.requestId) || !SEMANTIC_DISPATCH_STAGES.includes(input.stage as SemanticDispatchStage)) return null;
  return { version: 1, domain: input.domain as SemanticCensusDomain, turnId: input.turnId, requestId: input.requestId, stage: input.stage as SemanticDispatchStage };
}
function validMetadata(input: unknown): input is SemanticCensusMetadata {
  const value = record(input);
  if (!value || !exactKeys(value, ['questionCode', 'targetCount', 'propositionCount', 'propositionCategories', 'candidateCount', 'candidateHash', 'binding', 'freshness'])) return false;
  const hash = record(value.candidateHash);
  if (value.candidateHash !== null && (!hash || !exactKeys(hash, ['algorithm', 'digest']))) return false;
  return JSON.stringify(value) === JSON.stringify({ ...value, ...projectSemanticCensusMetadata(value) });
}
function validUsage(value: unknown): boolean {
  const input = record(value);
  return !!input && exactKeys(input, ['inputTokens', 'outputTokens', 'costUsd']) && Object.entries(usage(value)).every(([key, projected]) => input[key] === projected);
}
/** Strict production allowlist: neither new fields nor arbitrary typed strings can reach the sink. */
export function parseSemanticCensusEvent(value: unknown): SemanticCensusEvent | null {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > SEMANTIC_CENSUS_MAX_BYTES) return null;
    const input = record(value);
    if (!input || input.version !== 1 || !['weekly-planning', 'user-context'].includes(String(input.domain))
      || !isOpaqueSemanticId(input.turnId) || typeof input.occurredAt !== 'string'
      || !Number.isFinite(Date.parse(input.occurredAt)) || new Date(input.occurredAt).toISOString() !== input.occurredAt) return null;
    const base = ['version', 'domain', 'turnId', 'occurredAt', 'kind'];
    if (input.kind === 'start') {
      if (!exactKeys(input, [...base, 'metadata']) || !validMetadata(input.metadata)) return null;
    } else if (input.kind === 'closure') {
      if (!exactKeys(input, [...base, 'metadata', 'requestIds', 'integrity', 'semanticResolution', 'latencyMs'])
        || !validMetadata(input.metadata) || !Array.isArray(input.requestIds) || input.requestIds.length > SEMANTIC_CENSUS_MAX_REQUESTS
        || !input.requestIds.every(isOpaqueSemanticId) || new Set(input.requestIds).size !== input.requestIds.length
        || !['complete', 'unknown'].includes(String(input.integrity)) || !['success', 'failure', 'unknown'].includes(String(input.semanticResolution))
        || (input.latencyMs !== null && number(input.latencyMs) === null) || (input.integrity === 'complete' && input.latencyMs === null)) return null;
    } else if (input.kind === 'request') {
      if (!exactKeys(input, [...base, 'requestId', 'joined', 'stage', 'integrity', 'route', 'outcome', 'latencyMs', 'lateWork', 'lunaDispatches', 'jevDispatches', 'observedLunaDispatches', 'observedJevDispatches', 'usage', 'dispatches'])
        || !isOpaqueSemanticId(input.requestId) || typeof input.joined !== 'boolean' || typeof input.lateWork !== 'boolean'
        || !SEMANTIC_DISPATCH_STAGES.includes(input.stage as SemanticDispatchStage) || !['complete', 'unknown'].includes(String(input.integrity))
        || !['luna', 'jev', 'jev-then-luna', 'rejected', 'unknown'].includes(String(input.route)) || !['success', 'failure', 'unknown'].includes(String(input.outcome))
        || (input.latencyMs !== null && number(input.latencyMs) === null) || !validUsage(input.usage)
        || ['lunaDispatches', 'jevDispatches'].some((key) => input[key] !== null && count(input[key]) === null)
        || count(input.observedLunaDispatches) === null || count(input.observedJevDispatches) === null
        || !Array.isArray(input.dispatches) || input.dispatches.length > SEMANTIC_CENSUS_MAX_DISPATCHES) return null;
      for (const raw of input.dispatches) {
        const dispatch = record(raw);
        if (!dispatch || !exactKeys(dispatch, ['family', 'stage', 'outcome', 'latencyMs', 'usage'])
          || !['luna', 'jev', 'other', 'unknown'].includes(String(dispatch.family))
          || !SEMANTIC_DISPATCH_STAGES.includes(dispatch.stage as SemanticDispatchStage)
          || !['success', 'http_error', 'network_error', 'timeout', 'cancelled', 'unknown'].includes(String(dispatch.outcome))
          || (dispatch.latencyMs !== null && number(dispatch.latencyMs) === null) || !validUsage(dispatch.usage)) return null;
      }
      const dispatches = input.dispatches as SemanticCensusRequest['dispatches'];
      const luna = dispatches.filter((item) => item.family === 'luna').length;
      const jev = dispatches.filter((item) => item.family === 'jev').length;
      if (Number(input.observedLunaDispatches) < luna || Number(input.observedJevDispatches) < jev) return null;
      if (input.integrity === 'complete') {
        if (dispatches.some((item) => item.family === 'unknown' || item.latencyMs === null)
          || input.latencyMs === null || input.lunaDispatches !== luna || input.jevDispatches !== jev
          || input.observedLunaDispatches !== luna || input.observedJevDispatches !== jev) return null;
        const route = luna && jev ? 'jev-then-luna' : luna ? 'luna' : jev ? 'jev' : dispatches.length ? 'unknown' : 'rejected';
        if (input.route !== route) return null;
        const totals = input.usage as SemanticUsage;
        for (const key of ['inputTokens', 'outputTokens', 'costUsd'] as const) {
          const total = dispatches.some((item) => item.usage[key] === null) ? null : dispatches.reduce((sum, item) => sum + item.usage[key]!, 0);
          if (totals[key] !== total) return null;
        }
      } else if (input.lunaDispatches !== null || input.jevDispatches !== null || input.route !== 'unknown'
        || Object.values(input.usage as SemanticUsage).some((item) => item !== null)) return null;
    } else return null;
    return JSON.parse(JSON.stringify(input)) as SemanticCensusEvent;
  } catch { return null; }
}

/** Reuse the Unit 1 physical-send evidence, without persisting its laboratory IDs/population or content. */
export function projectSemanticCensusRequest(observation: SemanticRequestObservation, joined: boolean, httpStatus: number, postMainWork = false): SemanticCensusRequest {
  const all = observation.dispatches;
  const luna = all.filter((item) => item.family === 'luna').length;
  const jev = all.filter((item) => item.family === 'jev').length;
  // Unit 1 owns completeness, identity/manifest validation and nullable usage.
  const summary = summarizeSemanticTurn({
    version: 1, population: observation.population, turnId: observation.turnId, pairId: observation.turnId,
    expectedRequestIds: [observation.requestId], sealed: true, startedAtMs: observation.startedAtMs,
    completedAtMs: observation.settledAtMs, semanticResolution: 'unknown',
  }, [observation]);
  const complete = summary.status === 'known' && all.length <= SEMANTIC_CENSUS_MAX_DISPATCHES;
  const total = (key: keyof SemanticUsage) => !complete || all.some((item) => item.usage[key] === null) ? null : all.reduce((sum, item) => sum + item.usage[key]!, 0);
  return {
    version: 1, domain: observation.population.domain, turnId: observation.turnId, requestId: observation.requestId,
    occurredAt: new Date(observation.startedAtMs).toISOString(), kind: 'request', joined, stage: observation.stage,
    integrity: complete ? 'complete' : 'unknown',
    route: !complete ? 'unknown' : luna && jev ? 'jev-then-luna' : luna ? 'luna' : jev ? 'jev' : all.length ? 'unknown' : 'rejected',
    outcome: httpStatus >= 200 && httpStatus < 300 ? 'success' : 'failure',
    latencyMs: !complete ? null : observation.mainCompletedAtMs! - observation.startedAtMs,
    lateWork: postMainWork || all.some((item) => item.completedAtMs === null || item.completedAtMs > (observation.mainCompletedAtMs ?? 0)),
    lunaDispatches: complete ? luna : null, jevDispatches: complete ? jev : null,
    observedLunaDispatches: luna, observedJevDispatches: jev,
    usage: { inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), costUsd: total('costUsd') },
    dispatches: all.slice(0, SEMANTIC_CENSUS_MAX_DISPATCHES).map((item) => ({
      family: member(item.family, ['luna', 'jev', 'other', 'unknown'], 'unknown'),
      stage: member(item.stage, SEMANTIC_DISPATCH_STAGES, 'initial'),
      outcome: member(item.outcome, ['success', 'http_error', 'network_error', 'timeout', 'cancelled', 'unknown'], 'unknown'),
      latencyMs: item.completedAtMs === null ? null : number(item.completedAtMs - item.startedAtMs), usage: usage(item.usage),
    })),
  };
}
