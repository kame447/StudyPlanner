import { createHash } from 'node:crypto';
import { isOpaqueSemanticId } from '../shared/semanticDispatchLedger';
import { parseSemanticCensusEvent, type SemanticCensusEvent, type SemanticCensusMetadata, type SemanticCensusRequest, type SemanticCensusStart, type SemanticCensusClosure } from '../shared/semanticTurnCensus';
import { structuralCensusEligibility } from './semantic-dispatch-census-core';

export const ACTUAL_CENSUS_RULES = {
  version: 'unit0-census-2026-10-05-sections13-14-16-16a',
  seed: 'unit0-census-2026-10-05', replicates: 20_000,
  windowDays: 14, maximumExtensions: 1, minimumComplete: 200,
  minimumCoverage: .9, minimumKnownActors: 10, minimumLowerBound: .01,
} as const;
const DAY = 86_400_000;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid actual census artifact.');
  return value as Record<string, unknown>;
};
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
const sortCodePoints = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** SHA-256 first 128 bits, big-endian words; xoshiro128** unsigned arithmetic. */
export function censusRandom(seed: string = ACTUAL_CENSUS_RULES.seed) {
  if (seed !== ACTUAL_CENSUS_RULES.seed) throw new Error('Census seed differs from preregistration.');
  const hash = createHash('sha256').update(seed, 'utf8').digest();
  let a = hash.readUInt32BE(0), b = hash.readUInt32BE(4), c = hash.readUInt32BE(8), d = hash.readUInt32BE(12);
  if (!(a | b | c | d)) throw new Error('Invalid all-zero PRNG state.');
  const rotate = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
  return () => {
    const result = Math.imul(rotate(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
    const temp = (b << 9) >>> 0;
    c = (c ^ a) >>> 0; d = (d ^ b) >>> 0; b = (b ^ c) >>> 0; a = (a ^ d) >>> 0;
    c = (c ^ temp) >>> 0; d = rotate(d, 11);
    return result;
  };
}
type Observed = { payload: SemanticCensusEvent | null; domain: 'weekly-planning' | 'user-context'; turnId: string; occurredAtMs: number; actor: string | null };
type Turn = {
  domain: Observed['domain']; startedAtMs: number; actor: string | null;
  complete: boolean; metadata: SemanticCensusMetadata | null; closure: SemanticCensusClosure | null;
  requests: SemanticCensusRequest[]; reasons: string[];
};
function joinTurn(events: Observed[]): Turn {
  const starts = events.filter((item) => item.payload?.kind === 'start');
  const closures = events.filter((item) => item.payload?.kind === 'closure');
  const actors = new Set(events.map((item) => item.actor).filter((item): item is string => item !== null));
  const unique = new Map<string, SemanticCensusEvent>(); const reasons = new Set<string>();
  for (const item of events) {
    if (!item.payload) { reasons.add('invalid_event'); continue; }
    const key = item.payload.kind === 'request' ? `request:${item.payload.requestId}` : item.payload.kind;
    const before = unique.get(key);
    if (before && stable(before) !== stable(item.payload)) reasons.add('conflicting_event');
    else unique.set(key, item.payload);
  }
  const start = unique.get('start') as SemanticCensusStart | undefined;
  const closure = unique.get('closure') as SemanticCensusClosure | undefined;
  const requests = [...unique.values()].filter((item): item is SemanticCensusRequest => item.kind === 'request');
  if (!start) reasons.add('missing_start');
  if (!closure) reasons.add('missing_closure');
  if (actors.size > 1 || (actors.size === 1 && events.some((item) => item.actor === null))) reasons.add('actor_join_unknown');
  if (start && closure && (stable(start.metadata) !== stable(closure.metadata) || start.occurredAt !== closure.occurredAt)) reasons.add('changed_start_basis');
  if (closure) {
    if (closure.integrity !== 'complete') reasons.add('unsealed_client');
    if (requests.length !== closure.requestIds.length || requests.some((item) => !closure.requestIds.includes(item.requestId))) reasons.add('request_manifest_mismatch');
    if (requests.some((item) => !item.joined || item.integrity !== 'complete')) reasons.add('incomplete_request');
  }
  return {
    domain: events[0].domain, startedAtMs: start ? Date.parse(start.occurredAt) : Math.min(...[...starts, ...closures, ...events].map((item) => item.occurredAtMs)),
    actor: actors.size === 1 ? [...actors][0] : null, complete: reasons.size === 0,
    metadata: start?.metadata ?? null, closure: closure ?? null, requests, reasons: [...reasons],
  };
}
const UNITS = ['C5', 'D5', 'D5-prime', 'D6'] as const;
function eligibility(turn: Turn, unit: typeof UNITS[number]): 'eligible' | 'ineligible' | 'unknown' {
  const metadata = turn.metadata;
  if (metadata?.freshness === 'stale' || metadata?.binding === 'rejected') return 'ineligible';
  // Apply the Unit 1 structural contract with uncollected semantic dimensions NA.
  return structuralCensusEligibility(turn.domain, metadata?.questionCode ?? null, metadata ? {
    scopeClosed: null, c5Reference: null, manifestComplete: null, candidateCount: metadata.candidateCount,
    materialAdapter: null, explicitCurrentIntent: null, selectedMaterialCount: null,
    tupleComplete: null, valueTuple: null, overnight: null, endAt24: null, exceptions: null,
  } : null, unit);
}
function bootstrap(turns: Turn[], eligible: (turn: Turn) => boolean) {
  const clusters = new Map<string, { numerator: number; denominator: number }>();
  for (const turn of turns) {
    const id = turn.actor ?? '\uffff-unknown-actor'; const item = clusters.get(id) ?? { numerator: 0, denominator: 0 };
    item.denominator += 1; item.numerator += eligible(turn) ? 1 : 0; clusters.set(id, item);
  }
  const ordered = [...clusters.keys()].sort(sortCodePoints).map((key) => clusters.get(key)!);
  if (!ordered.length) return null;
  const next = censusRandom(); const samples: number[] = [];
  for (let replicate = 0; replicate < ACTUAL_CENSUS_RULES.replicates; replicate++) {
    let numerator = 0; let denominator = 0;
    for (let index = 0; index < ordered.length; index++) {
      const cluster = ordered[Math.floor(next() * ordered.length / 2 ** 32)];
      numerator += cluster.numerator; denominator += cluster.denominator;
    }
    samples.push(numerator / denominator);
  }
  samples.sort((a, b) => a - b);
  return samples[999]; // one-based 1,000th; preregistered one-sided 95% lower bound
}
const rate = (n: number, d: number) => d ? n / d : null;
const quantile = (items: number[], q: number) => items.length ? [...items].sort((a, b) => a - b)[Math.max(0, Math.ceil(items.length * q) - 1)] : null;
function populationReport(turns: Turn[], domain: Observed['domain']) {
  const complete = turns.filter((item) => item.complete); const unknown = turns.length - complete.length;
  const eligibleD1 = (turn: Turn) => turn.complete && turn.metadata?.questionCode === 'quantity_role_unresolved' && turn.metadata.freshness === 'matched';
  const numerator = turns.filter(eligibleD1).length;
  const lower = bootstrap(turns, eligibleD1);
  const knownActors = new Set(turns.map((item) => item.actor).filter((item) => item !== null)).size;
  const stages: Record<string, number> = {}; const outcomes: Record<string, number> = {}; const questions: Record<string, number> = {};
  for (const turn of turns) {
    const question = turn.metadata?.questionCode ?? 'NA'; questions[question] = (questions[question] ?? 0) + 1;
    for (const request of turn.requests) for (const item of request.dispatches) {
      const stage = `${item.family}:${item.stage}`; stages[stage] = (stages[stage] ?? 0) + 1;
      const outcome = `${item.family}:${item.outcome}`; outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
  }
  const tally = (values: Array<string | number | null>) => {
    const counts: Record<string, number> = {};
    for (const value of values) { const key = value === null ? 'NA' : String(value); counts[key] = (counts[key] ?? 0) + 1; }
    return counts;
  };
  const latency = complete.filter((item) => item.closure && item.closure.latencyMs !== null && !item.requests.some((request) => request.lateWork)).map((item) => item.closure!.latencyMs!);
  const sum = (key: 'lunaDispatches' | 'jevDispatches') => !turns.length || unknown ? null : complete.reduce((value, item) => value + item.requests.reduce((n, request) => n + request[key]!, 0), 0);
  const usage = (key: 'inputTokens' | 'outputTokens' | 'costUsd') => !turns.length || unknown || complete.some((item) => item.requests.some((request) => request.usage[key] === null)) ? null
    : complete.reduce((n, item) => n + item.requests.reduce((v, request) => v + request.usage[key]!, 0), 0);
  return {
    source: 'actual', domain, allTurns: turns.length, completeTurns: complete.length, unknownTurns: unknown,
    coverage: rate(complete.length, turns.length), knownActors,
    d1: { numerator, denominator: turns.length, primaryRate: rate(numerator, turns.length), completeOnlyRate: rate(numerator, complete.length), conservativeUpperRate: rate(numerator + unknown, turns.length), oneSided95LowerBound: lower },
    structure: Object.fromEntries(UNITS.map((unit) => {
      const counts = { eligible: 0, ineligible: 0, unknown: 0 };
      for (const turn of turns) counts[turn.complete ? eligibility(turn, unit) : 'unknown']++;
      return [unit, { ...counts, denominator: turns.length, primaryRate: rate(counts.eligible, turns.length), completeOnlyRate: rate(counts.eligible, complete.length) }];
    })),
    questions, targetCounts: tally(turns.map((item) => item.metadata?.targetCount ?? null)),
    propositionCounts: tally(turns.map((item) => item.metadata?.propositionCount ?? null)),
    propositionCategories: tally(turns.flatMap((item) => item.metadata?.propositionCategories ?? [null])),
    candidateCounts: tally(turns.map((item) => item.metadata?.candidateCount ?? null)),
    bindingResults: tally(turns.map((item) => item.metadata?.binding ?? 'unknown')),
    freshnessResults: tally(turns.map((item) => item.metadata?.freshness ?? 'unknown')),
    requestRoutes: tally(turns.flatMap((item) => item.requests.map((request) => request.route))),
    requestOutcomes: tally(turns.flatMap((item) => item.requests.map((request) => request.outcome))),
    normalizerResolution: tally(turns.map((item) => item.closure?.semanticResolution ?? 'unknown')),
    dispatchesByFamilyAndStage: stages, dispatchesByFamilyAndOutcome: outcomes,
    lunaDispatches: sum('lunaDispatches'), jevDispatches: sum('jevDispatches'),
    observedLunaDispatches: turns.reduce((n, item) => n + item.requests.reduce((v, request) => v + request.observedLunaDispatches, 0), 0),
    observedJevDispatches: turns.reduce((n, item) => n + item.requests.reduce((v, request) => v + request.observedJevDispatches, 0), 0),
    rawFreeTurns: unknown || !turns.length ? null : complete.filter((item) => item.requests.every((request) => request.dispatches.length === 0)).length,
    semanticLunaFreeTurns: unknown || !turns.length ? null : complete.filter((item) => item.requests.every((request) => request.lunaDispatches === 0)).length,
    correctlyResolvedAndFreeRate: null, // no correctness labels in production census
    usage: { inputTokens: usage('inputTokens'), outputTokens: usage('outputTokens'), costUsd: usage('costUsd') },
    latencyMs: { knownTurns: latency.length, unknownTurns: turns.length - latency.length, p50: quantile(latency, .5), p95: quantile(latency, .95) },
    integrityReasons: Object.fromEntries([...new Set(turns.flatMap((item) => item.reasons))].map((reason) => [reason, turns.filter((item) => item.reasons.includes(reason)).length])),
    frequencyGate: complete.length >= 200 && rate(complete.length, turns.length)! >= .9 && knownActors >= 10 && lower !== null && lower >= .01 ? 'PASS-STRUCTURE-ONLY' : 'HOLD',
  };
}

/** Offline, fixed-window analysis only. Never fetches production data or evaluates provider models. */
export function buildActualSemanticCensus(value: unknown, nowMs = Date.now()) {
  const input = object(value);
  if (input.version !== 2 || input.source !== 'observability_events' || input.environment !== 'production' || !Array.isArray(input.documents)) throw new Error('Expected production observability census export version 2. Fixtures/synthetic are not actual frequency.');
  if (input.seed !== undefined && input.seed !== ACTUAL_CENSUS_RULES.seed) throw new Error('Census seed differs from preregistration.');
  if (input.phase !== 'initial' && input.phase !== 'extended') throw new Error('Census phase must be initial or extended.');
  const activation = typeof input.activationAt === 'string' ? Date.parse(input.activationAt) : NaN;
  if (!Number.isFinite(activation)) throw new Error('Actual deployment activation timestamp required.');
  const start = (Math.floor((activation + 9 * 3_600_000) / DAY) + 1) * DAY - 9 * 3_600_000;
  const initialEnd = start + 14 * DAY; const end = start + (input.phase === 'extended' ? 28 : 14) * DAY;
  if (input.windowStart !== undefined && input.windowStart !== new Date(start).toISOString()
    || input.windowEnd !== undefined && input.windowEnd !== new Date(end).toISOString()) throw new Error('Census window differs from preregistration.');
  if (nowMs < end) throw new Error('Census window is open: preregistration forbids peeking.');
  const groups = new Map<string, Observed[]>(); let unframedRecords = 0;
  const unjoined = new Map<string, SemanticCensusRequest>();
  for (const raw of input.documents) {
    const document = object(raw);
    if (document.eventType !== 'semantic_turn_census') continue;
    if (document.environment !== 'production') throw new Error('Mixed production/fixture environment export.');
    const payload = object(document.payload); const parsed = parseSemanticCensusEvent(payload);
    const date = typeof payload.occurredAt === 'string' ? Date.parse(payload.occurredAt) : NaN;
    if (!isOpaqueSemanticId(payload.turnId) || !['weekly-planning', 'user-context'].includes(String(payload.domain)) || !Number.isFinite(date)) { unframedRecords++; continue; }
    if (parsed?.kind === 'request' && !parsed.joined) {
      if (date >= start && date < end) unjoined.set(`${parsed.domain}:${parsed.requestId}`, parsed);
      continue;
    }
    const actor = typeof document.actorSubjectId === 'string' && /^actor-[0-9a-f-]{36}$/i.test(document.actorSubjectId) ? document.actorSubjectId : null;
    const key = `${payload.domain}:${payload.turnId}`; const items = groups.get(key) ?? [];
    items.push({ payload: parsed, domain: payload.domain as Observed['domain'], turnId: payload.turnId, occurredAtMs: date, actor }); groups.set(key, items);
  }
  const turns = [...groups.values()].map(joinTurn).filter((item) => item.startedAtMs >= start && item.startedAtMs < end);
  const unjoinedRequests = {
    'weekly-planning': [...unjoined.values()].filter((item) => item.domain === 'weekly-planning').length,
    'user-context': [...unjoined.values()].filter((item) => item.domain === 'user-context').length,
  };
  const weekly = turns.filter((item) => item.domain === 'weekly-planning');
  const initialComplete = weekly.filter((item) => item.startedAtMs < initialEnd && item.complete).length;
  if (input.phase === 'extended' && initialComplete >= 200) throw new Error('Extension prohibited: initial complete count already reached 200.');
  const window = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  // An unjoined send cannot be assigned to a turn without guessing. Withhold
  // frequencies/free claims for that population; retain request-scope lower bounds.
  if (unframedRecords || unjoinedRequests['weekly-planning']) return {
    version: 2, rules: ACTUAL_CENSUS_RULES, status: unframedRecords ? 'HOLD-UNFRAMED-EXPORT' : 'HOLD-UNJOINED-REQUESTS',
    window, unframedRecords, unjoinedRequests, populations: [],
    diagnostics: {
      startedWeeklyTurns: weekly.filter((item) => item.metadata !== null).length,
      observedUnjoinedLunaDispatches: [...unjoined.values()].reduce((n, item) => n + item.observedLunaDispatches, 0),
      observedUnjoinedJevDispatches: [...unjoined.values()].reduce((n, item) => n + item.observedJevDispatches, 0),
      rawFreeTurns: null, semanticLunaFreeTurns: null,
    },
    actualFrequency: 'not evaluated: provider/turn coverage is unknown',
  };
  if (input.phase === 'initial' && initialComplete < 200) return { version: 2, rules: ACTUAL_CENSUS_RULES, status: 'EXTEND-ONCE', completeTurns: initialComplete, window, nextWindowEnd: new Date(start + 28 * DAY).toISOString(), populations: [], actualFrequency: 'not evaluated before permitted extension' };
  const populations = (['weekly-planning', 'user-context'] as const).map((domain) => {
    const observed = turns.filter((item) => item.domain === domain);
    const covered = unjoinedRequests[domain] ? observed.map((item) => ({ ...item, complete: false, reasons: [...item.reasons, 'unjoined_provider_coverage'] })) : observed;
    return { ...populationReport(covered, domain),
      unjoinedObservedLunaDispatches: [...unjoined.values()].filter((item) => item.domain === domain).reduce((n, item) => n + item.observedLunaDispatches, 0),
      unjoinedObservedJevDispatches: [...unjoined.values()].filter((item) => item.domain === domain).reduce((n, item) => n + item.observedJevDispatches, 0),
    };
  });
  return {
    version: 2, rules: ACTUAL_CENSUS_RULES, status: unframedRecords ? 'HOLD-UNFRAMED-EXPORT' : unjoinedRequests['weekly-planning'] ? 'HOLD-UNJOINED-REQUESTS' : populations[0].frequencyGate, window, unframedRecords, unjoinedRequests, populations,
    actualFrequency: 'observed production cohort; structural machine eligibility only',
    limitations: ['all-turn denominator includes incomplete observations', 'entirely lost telemetry is unmeasurable', 'actor-cluster bootstrap is descriptive for this cohort, not a population guarantee', 'missing semantic correctness and late-work timing remain unknown', 'export provenance is operator supplied, not independently authenticated by this offline tool'],
  };
}
