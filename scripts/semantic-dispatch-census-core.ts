import { isOpaqueSemanticId, SEMANTIC_DISPATCH_STAGES, summarizeSemanticTurn, pairedSemanticDispatchDelta, type SemanticDispatch, type SemanticRequestObservation, type SemanticTurnObservation, type SemanticTurnSummary } from '../shared/semanticDispatchLedger';

export type CensusLabel = {
  source: 'human' | 'synthetic' | 'opus-5.5-limited-judge' | 'machine-state';
  artifactId: string;
  independence: 'independent' | 'not-independent' | 'unknown';
  use: 'diagnostic' | 'fresh';
  targetCount: number | null;
  propositionCount: number | null;
  openValueKinds: Array<'new_title' | 'new_label' | 'free_number' | 'date_relation' | 'custom'> | null;
  candidateCount: number | null;
  branchCount: number | null;
  depth: number | null;
  manifestComplete: boolean | null;
  scopeClosed: boolean | null;
  c5Reference: 'ordinal' | 'deictic' | 'content-addressed' | 'new-value' | null;
  valueTuple: 'single-value' | 'one-side-fixed' | 'both-sides' | null;
  tupleComplete: boolean | null;
  overnight: boolean | null;
  endAt24: boolean | null;
  exceptions: boolean | null;
  materialAdapter: boolean | null;
  selectedMaterialCount: number | null;
  explicitCurrentIntent: boolean | null;
  jointCorrect: boolean | null;
};
export type CensusRow = {
  turn: SemanticTurnObservation;
  requests: SemanticRequestObservation[];
  questionCode: string | null;
  route: 'luna' | 'jev' | 'jev-then-luna' | 'rejected' | 'unknown';
  baselineModel: 'luna' | 'other' | 'unknown';
  mode: 'off' | 'shadow' | 'canary' | 'fixture' | 'unknown';
  label: CensusLabel | null;
};

type Eligibility = 'eligible' | 'ineligible' | 'unknown';
const c5Codes = ['ambiguous_effort_estimate', 'ambiguous_planning_window'];
const d5Codes = ['missing_effort_estimate'];
const d5PrimeCodes = ['missing_time_bounds', 'invalid_time_interval', 'named_time_period_unresolved', 'missing_availability_date_scope', 'missing_commitment_date_scope', 'missing_daily_capacity_date_scope', 'unresolved_hard_date_expression'];

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid census artifact object.');
  return value as Record<string, unknown>;
};
const numberOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const countOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const booleanOrNull = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
function enumValue<T extends string>(value: unknown, options: readonly T[], fallback: T): T { return options.includes(value as T) ? value as T : fallback; }
function opaque(value: unknown): string { if (!isOpaqueSemanticId(value)) throw new Error('Census identities must be opaque UUIDs.'); return value; }
function population(value: unknown): SemanticTurnObservation['population'] {
  const input = object(value);
  if (typeof input.source !== 'string' || typeof input.domain !== 'string' || typeof input.arm !== 'string' || !['actual', 'fixture', 'synthetic'].includes(input.source) || !['weekly-planning', 'user-context'].includes(input.domain) || !['baseline', 'treatment'].includes(input.arm)) throw new Error('Invalid census population.');
  return { source: input.source as SemanticTurnObservation['population']['source'], domain: input.domain as SemanticTurnObservation['population']['domain'], arm: input.arm as SemanticTurnObservation['population']['arm'], corpusId: opaque(input.corpusId) };
}
function projectLabel(value: unknown): CensusLabel | null {
  if (value === null || value === undefined) return null;
  const input = object(value);
  if (typeof input.source !== 'string' || !['human', 'synthetic', 'opus-5.5-limited-judge', 'machine-state'].includes(input.source) || !isOpaqueSemanticId(input.artifactId)) return null;
  const semantic = input.source !== 'machine-state';
  const kinds = ['new_title', 'new_label', 'free_number', 'date_relation', 'custom'] as const;
  return { source: input.source as CensusLabel['source'], artifactId: input.artifactId,
    independence: enumValue(input.independence, ['independent', 'not-independent', 'unknown'], 'unknown'),
    use: enumValue(input.use, ['diagnostic', 'fresh'], 'diagnostic'), targetCount: countOrNull(input.targetCount),
    propositionCount: semantic ? countOrNull(input.propositionCount) : null,
    openValueKinds: semantic && Array.isArray(input.openValueKinds) && input.openValueKinds.every((kind) => kinds.includes(kind)) ? [...new Set(input.openValueKinds)].sort() as CensusLabel['openValueKinds'] : null,
    candidateCount: countOrNull(input.candidateCount), branchCount: countOrNull(input.branchCount), depth: countOrNull(input.depth), manifestComplete: booleanOrNull(input.manifestComplete), scopeClosed: booleanOrNull(input.scopeClosed),
    c5Reference: semantic && ['ordinal', 'deictic', 'content-addressed', 'new-value'].includes(String(input.c5Reference)) ? input.c5Reference as CensusLabel['c5Reference'] : null,
    valueTuple: ['single-value', 'one-side-fixed', 'both-sides'].includes(String(input.valueTuple)) ? input.valueTuple as CensusLabel['valueTuple'] : null,
    tupleComplete: booleanOrNull(input.tupleComplete), overnight: booleanOrNull(input.overnight), endAt24: booleanOrNull(input.endAt24), exceptions: booleanOrNull(input.exceptions), materialAdapter: booleanOrNull(input.materialAdapter), selectedMaterialCount: countOrNull(input.selectedMaterialCount), explicitCurrentIntent: semantic ? booleanOrNull(input.explicitCurrentIntent) : null, jointCorrect: semantic ? booleanOrNull(input.jointCorrect) : null };
}

/** Exact allowlist projection. Invalid framing stops the report; partial observations stay unknown. */
export function parseCensusArtifact(value: unknown): CensusRow[] {
  const artifact = object(value);
  if (artifact.version !== 1 || !Array.isArray(artifact.rows)) throw new Error('Expected census artifact version 1 with rows.');
  return artifact.rows.map((raw) => {
    const row = object(raw); const input = object(row.turn);
    if (!Array.isArray(input.expectedRequestIds)) throw new Error('Missing complete turn request manifest.');
    const turn: SemanticTurnObservation = { version: 1, population: population(input.population), turnId: opaque(input.turnId), pairId: opaque(input.pairId), expectedRequestIds: input.expectedRequestIds.map(opaque), sealed: input.version === 1 && input.sealed === true,
      startedAtMs: numberOrNull(input.startedAtMs) ?? NaN, completedAtMs: numberOrNull(input.completedAtMs), semanticResolution: enumValue(input.semanticResolution, ['success', 'failure', 'unknown'], 'unknown'), mutatingCommit: booleanOrNull(input.mutatingCommit) };
    const requests: SemanticRequestObservation[] = (Array.isArray(row.requests) ? row.requests : []).map((rawRequest) => {
      const request = object(rawRequest);
      const dispatches: SemanticDispatch[] = (Array.isArray(request.dispatches) ? request.dispatches : []).map((rawDispatch) => {
        const dispatch = object(rawDispatch); const usage = object(dispatch.usage ?? {});
        return { dispatchId: opaque(dispatch.dispatchId), requestId: opaque(dispatch.requestId), turnId: opaque(dispatch.turnId), provider: enumValue(dispatch.provider, ['openai', 'openrouter'], 'openai'), family: enumValue(dispatch.family, ['luna', 'jev', 'other', 'unknown'], 'unknown'), stage: enumValue(dispatch.stage, SEMANTIC_DISPATCH_STAGES, 'initial'), startedAtMs: numberOrNull(dispatch.startedAtMs) ?? NaN, completedAtMs: numberOrNull(dispatch.completedAtMs), outcome: enumValue(dispatch.outcome, ['success', 'http_error', 'network_error', 'timeout', 'cancelled', 'unknown'], 'unknown'), usage: { inputTokens: countOrNull(usage.inputTokens), outputTokens: countOrNull(usage.outputTokens), costUsd: numberOrNull(usage.costUsd) } };
      });
      const complete = request.version === 1 && request.integrity === 'complete' && SEMANTIC_DISPATCH_STAGES.includes(request.stage as typeof SEMANTIC_DISPATCH_STAGES[number]) && Array.isArray(request.dispatches)
        && request.dispatches.every((item) => {
          const call = object(item);
          if (typeof call.usage !== 'object' || call.usage === null || Array.isArray(call.usage)) return false;
          const usage = object(call.usage);
          const validUsage = (key: string, tokens: boolean) => usage[key] === null || typeof usage[key] === 'number' && Number.isFinite(usage[key]) && (usage[key] as number) >= 0 && (!tokens || Number.isSafeInteger(usage[key]));
          return ['openai', 'openrouter'].includes(call.provider as string) && ['luna', 'jev', 'other', 'unknown'].includes(call.family as string)
            && SEMANTIC_DISPATCH_STAGES.includes(call.stage as typeof SEMANTIC_DISPATCH_STAGES[number])
            && ['success', 'http_error', 'network_error', 'timeout', 'cancelled', 'unknown'].includes(call.outcome as string)
            && validUsage('inputTokens', true) && validUsage('outputTokens', true) && validUsage('costUsd', false);
        });
      return { version: 1, population: population(request.population), turnId: opaque(request.turnId), requestId: opaque(request.requestId), stage: enumValue(request.stage, SEMANTIC_DISPATCH_STAGES, 'initial'), boundary: enumValue(request.boundary, ['worker', 'direct', 'unobserved_proxy'], 'unobserved_proxy'), startedAtMs: numberOrNull(request.startedAtMs) ?? NaN, mainCompletedAtMs: numberOrNull(request.mainCompletedAtMs), settledAtMs: numberOrNull(request.settledAtMs), integrity: complete ? 'complete' : 'unknown', dispatchIds: Array.isArray(request.dispatchIds) ? request.dispatchIds.map(opaque) : null, dispatches };
    });
    const knownQuestions = [...c5Codes, ...d5Codes, ...d5PrimeCodes, 'quantity_role_unresolved', 'selected_material_remaining'];
    return { turn, requests, questionCode: row.questionCode === null ? null : knownQuestions.includes(String(row.questionCode)) ? row.questionCode as string : 'other_question', route: enumValue(row.route, ['luna', 'jev', 'jev-then-luna', 'rejected', 'unknown'], 'unknown'), baselineModel: enumValue(row.baselineModel, ['luna', 'other', 'unknown'], 'unknown'), mode: enumValue(row.mode, ['off', 'shadow', 'canary', 'fixture', 'unknown'], 'unknown'), label: projectLabel(row.label) };
  });
}

/** Structural research upper bound only. Neither language correctness nor runtime adoption. */
export function structuralEligibility(row: CensusRow, unit: 'C5' | 'D5' | 'D5-prime' | 'D6'): Eligibility {
  return structuralCensusEligibility(row.turn.population.domain, row.questionCode, row.label, unit);
}
export function structuralCensusEligibility(
  domain: 'weekly-planning' | 'user-context', questionCode: string | null,
  label: Pick<CensusLabel, 'scopeClosed' | 'c5Reference' | 'manifestComplete' | 'candidateCount' | 'materialAdapter' | 'explicitCurrentIntent' | 'selectedMaterialCount' | 'tupleComplete' | 'valueTuple' | 'overnight' | 'endAt24' | 'exceptions'> | null,
  unit: 'C5' | 'D5' | 'D5-prime' | 'D6',
): Eligibility {
  const codes = unit === 'C5' ? c5Codes : unit === 'D5' ? d5Codes : unit === 'D5-prime' ? d5PrimeCodes : ['selected_material_remaining'];
  if (domain !== 'weekly-planning') return 'ineligible';
  if (questionCode === null) return 'unknown';
  if (!codes.includes(questionCode)) return 'ineligible';
  if (!label) return 'unknown';
  const required: Array<boolean | null> = [label.scopeClosed];
  if (unit === 'C5') {
    if (label.c5Reference === 'new-value') return 'ineligible';
    required.push(label.c5Reference === null ? null : true, label.manifestComplete,
      label.candidateCount === null ? null : label.candidateCount > 0);
  } else if (unit === 'D6') {
    required.push(label.materialAdapter, label.explicitCurrentIntent,
      label.selectedMaterialCount === null ? null : label.selectedMaterialCount === 1);
  } else {
    required.push(label.tupleComplete, label.valueTuple === null ? null : true);
    if (unit === 'D5-prime') required.push(label.overnight === null ? null : !label.overnight,
      label.endAt24 === null ? null : !label.endAt24, label.exceptions === null ? null : !label.exceptions);
  }
  if (required.includes(false)) return 'ineligible';
  return required.includes(null) ? 'unknown' : 'eligible';
}

const quantile = (values: number[], q: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
};
function frequency(values: Array<string | number | boolean | null | undefined>) {
  const result: Record<string, number> = {};
  for (const value of values) { const key = value === null || value === undefined ? 'NA' : String(value); result[key] = (result[key] ?? 0) + 1; }
  return result;
}

export function buildSemanticCensus(rows: CensusRow[]) {
  // Identical ingestion is idempotent; contradictory repeated rows cannot be evidence.
  const unique = new Map<string, CensusRow>(); const conflicted = new Set<string>();
  for (const row of rows) {
    const key = row.turn.turnId;
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) conflicted.add(key);
    else unique.set(key, row);
  }
  const groups = new Map<string, { row: CensusRow; summary: SemanticTurnSummary }[]>();
  for (const [identity, row] of unique) {
    const summary = summarizeSemanticTurn(row.turn, row.requests);
    if (conflicted.has(identity)) Object.assign(summary, { status: 'unknown', lunaDispatches: null, jevDispatches: null, lunaFree: null, elapsedMs: null, usage: { inputTokens: null, outputTokens: null, costUsd: null }, reasons: [...summary.reasons, 'conflicting_turn_ingestion'] });
    const key = JSON.stringify([row.turn.population, row.baselineModel, row.mode]);
    const group = groups.get(key) ?? []; group.push({ row, summary }); groups.set(key, group);
  }
  const populations = [...groups.values()].map((items) => {
    const all = items.length;
    const known = items.filter(({ summary }) => summary.status === 'known');
    const unknown = all - known.length;
    const dispatches = known.reduce((sum, { summary }) => sum + (summary.lunaDispatches as number), 0);
    const free = known.filter(({ summary }) => summary.lunaFree).length;
    const rates = (subset: typeof items) => {
      const denominator = subset.length;
      const freeValues = subset.map(({ summary }) => summary.lunaFree);
      const correctFree = subset.map(({ row, summary }) => summary.lunaFree === false ? false
        : row.turn.semanticResolution === 'failure' ? false
        : summary.lunaFree === null || row.label?.jointCorrect === null || row.label?.jointCorrect === undefined || row.turn.semanticResolution === 'unknown' ? null
        : row.label.jointCorrect && row.turn.semanticResolution === 'success');
      const commits = subset.map(({ row }) => row.turn.mutatingCommit ?? null);
      const rate = (values: Array<boolean | null>) => denominator === 0 || values.includes(null) ? null : values.filter(Boolean).length / denominator;
      return { denominator, rawDispatchFreeRate: rate(freeValues), correctSemanticResolutionAndFreeRate: rate(correctFree), mutatingCommitRate: rate(commits) };
    };
    const elapsed = known.map(({ summary }) => summary.elapsedMs as number);
    const sumUsage = (key: 'inputTokens' | 'outputTokens' | 'costUsd') => unknown > 0 || known.some(({ summary }) => summary.usage[key] === null)
      ? null : known.reduce((sum, { summary }) => sum + (summary.usage[key] as number), 0);
    const questions = [...new Set(items.map(({ row }) => row.questionCode))].map((questionCode) => {
      const subset = items.filter(({ row }) => row.questionCode === questionCode);
      const eligibility = Object.fromEntries((['C5', 'D5', 'D5-prime', 'D6'] as const).map((unit) => {
        const values = subset.map(({ row }) => structuralEligibility(row, unit));
        const eligible = values.filter((value) => value === 'eligible').length;
        const missing = values.filter((value) => value === 'unknown').length;
        return [unit, { eligible, ineligible: values.length - eligible - missing, unknown: missing, structuralUpperBoundInterval: [eligible / values.length, (eligible + missing) / values.length],
          allTurnRates: rates(subset), structurallyEligibleRates: rates(subset.filter(({ row }) => structuralEligibility(row, unit) === 'eligible')) }];
      }));
      return { questionCode, turns: subset.length, eligibility,
        targets: frequency(subset.map(({ row }) => row.label?.targetCount)),
        propositions: frequency(subset.map(({ row }) => row.label?.propositionCount)),
        openValueKinds: frequency(subset.map(({ row }) => row.label?.openValueKinds?.join('+'))),
        candidateCount: frequency(subset.map(({ row }) => row.label?.candidateCount)),
        branchCount: frequency(subset.map(({ row }) => row.label?.branchCount)),
        depth: frequency(subset.map(({ row }) => row.label?.depth)),
        manifestComplete: frequency(subset.map(({ row }) => row.label?.manifestComplete)),
        c5Reference: frequency(subset.map(({ row }) => row.label?.c5Reference)),
        valueTuple: frequency(subset.map(({ row }) => row.label?.valueTuple)),
        labelSource: frequency(subset.map(({ row }) => row.label?.source)),
        labelIndependence: frequency(subset.map(({ row }) => row.label?.independence)),
        labelUse: frequency(subset.map(({ row }) => row.label?.use)),
        labelArtifact: frequency(subset.map(({ row }) => row.label?.artifactId)),
        jointCorrect: frequency(subset.map(({ row }) => row.label?.jointCorrect)),
        route: frequency(subset.map(({ row }) => row.route)),
        lunaDispatches: frequency(subset.map(({ summary }) => summary.lunaDispatches)),
        observedLunaDispatchesByStage: Object.fromEntries(SEMANTIC_DISPATCH_STAGES.map((stage) => [stage, subset.reduce((sum, { summary }) => sum + summary.dispatchesByStage[stage], 0)])),
        latencyMs: { p50: subset.some(({ summary }) => summary.elapsedMs === null) ? null : quantile(subset.map(({ summary }) => summary.elapsedMs as number), .5), p95: subset.some(({ summary }) => summary.elapsedMs === null) ? null : quantile(subset.map(({ summary }) => summary.elapsedMs as number), .95) },
        costUsd: subset.some(({ summary }) => summary.usage.costUsd === null) ? null : subset.reduce((sum, { summary }) => sum + (summary.usage.costUsd as number), 0),
      };
    });
    return {
      population: items[0].row.turn.population, baselineModel: items[0].row.baselineModel, mode: items[0].row.mode,
      allTurns: all, knownTurns: known.length, unknownTurns: unknown,
      rates: rates(items),
      semanticLunaFreeRate: unknown ? null : free / all,
      semanticLunaFreeRateBounds: [free / all, (free + unknown) / all],
      lunaDispatchesPerTurn: unknown ? null : dispatches / all,
      observedLunaDispatchLowerBound: items.reduce((sum, { summary }) => sum + summary.observedLunaDispatches, 0),
      lunaDispatchesByStage: unknown ? null : Object.fromEntries(SEMANTIC_DISPATCH_STAGES.map((stage) => [stage, items.reduce((sum, { summary }) => sum + summary.dispatchesByStage[stage], 0)])),
      latencyMs: { kind: 'measured_semantic_elapsed', p50: unknown ? null : quantile(elapsed, .5), p95: unknown ? null : quantile(elapsed, .95), knownSubsetP50: quantile(elapsed, .5), knownSubsetP95: quantile(elapsed, .95) },
      usage: { inputTokens: sumUsage('inputTokens'), outputTokens: sumUsage('outputTokens'), costUsd: sumUsage('costUsd') }, questions,
    };
  });
  const pairs = new Map<string, { baseline: SemanticTurnSummary[]; treatment: SemanticTurnSummary[] }>();
  for (const items of groups.values()) for (const { row, summary } of items) {
    const p = summary.population;
    const key = JSON.stringify([p.source, p.domain, p.corpusId, summary.pairId, row.baselineModel]);
    const pair = pairs.get(key) ?? { baseline: [], treatment: [] }; pair[p.arm].push(summary); pairs.set(key, pair);
  }
  return { version: 1,
    interpretation: 'Structural census and dispatch foundation only; synthetic presence is not production frequency or route adoption.',
    actualFrequency: rows.some((row) => row.turn.population.source === 'actual') ? 'provided_offline_artifact_only; collection authorization not implied' : 'unknown; owner approval required before collection',
    populations,
    pairedDispatch: [...pairs.values()].map((pair) => ({
      population: (pair.baseline[0] ?? pair.treatment[0]).population,
      pairId: (pair.baseline[0] ?? pair.treatment[0]).pairId,
      delta: pair.baseline.length === 1 && pair.treatment.length === 1 ? pairedSemanticDispatchDelta(pair.baseline[0], pair.treatment[0]) : null,
      complete: pair.baseline.length === 1 && pair.treatment.length === 1 && pair.baseline[0].status === 'known' && pair.treatment[0].status === 'known',
    })),
  };
}
