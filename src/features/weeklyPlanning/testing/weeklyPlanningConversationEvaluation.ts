export const WEEKLY_PLANNING_REQUIREMENT_IDS = [
  'DA-GOAL-001',
  'DA-SAFE-001',
  'DA-INTERPRET-001',
  'DA-ACTION-001',
  'DA-TURN-001',
  'DA-ASSUMPTION-001',
  'DA-CORRECTION-001',
  'DA-RESPONSE-001',
  'DA-PREVIEW-001',
  'DA-RELATIVE-001',
  'DA-FEASIBILITY-001',
  'DA-PERSISTENCE-001',
  'DA-IDEMPOTENCY-001',
  'DA-FALLBACK-001',
  'DA-EVAL-001',
] as const;

export type WeeklyPlanningRequirementId = typeof WEEKLY_PLANNING_REQUIREMENT_IDS[number];

export interface RequirementTraceRow {
  requirementId: WeeklyPlanningRequirementId;
  owner: string;
  task: string;
  status: 'complete' | 'covered' | 'pending' | 'failed';
  strictAssertionIds: string[];
  rubricIds: string[];
}

export interface StrictEvaluationResult {
  assertionId: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  forbiddenResultObserved?: boolean;
}

export interface MentorRubricResult {
  rubricId:
    | 'polite'
    | 'concise'
    | 'no_reask'
    | 'fact_assumption_distinction'
    | 'pending_explanation'
    | 'no_internal_names'
    | 'grounded_values'
    | 'clear_next_input'
    | 'mentor_option'
    | 'input_acknowledged';
  score: 0 | 1 | 2;
  note?: string;
}

export interface WeeklyPlanningEvaluationCaseResult {
  caseId: string;
  requirementIds: WeeklyPlanningRequirementId[];
  strictResults: StrictEvaluationResult[];
  rubricResults: MentorRubricResult[];
  callCount: number;
  latencyMs?: number;
  providerFailure?: boolean;
  plannerFailure?: boolean;
  fallbackCategory?: string;
  staleAsyncDiscarded?: boolean;
  stalePreviewRejected?: boolean;
  pendingAssumptionPreviewRejected?: boolean;
  previewCompleted?: boolean;
  duplicateSaveSuppressed?: boolean;
  partialRetryCompleted?: boolean;
  textValidationRejected?: boolean;
}

export interface WeeklyPlanningEvaluationMetrics {
  totalCases: number;
  strictPassRate: number;
  rubricAverage: number;
  noReaskRate: number;
  fallbackRate: number;
  staleDiscardCount: number;
  stalePreviewRejectionCount: number;
  pendingAssumptionRejectionCount: number;
  previewCompletionRate: number;
  duplicateSuppressionRate: number;
  partialRetryCompletionRate: number;
  textValidationRejectRate: number;
  providerFailureRate: number;
  plannerFailureRate: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
}

export interface RequirementMatrixValidation {
  valid: boolean;
  missing: WeeklyPlanningRequirementId[];
  duplicates: WeeklyPlanningRequirementId[];
  unknown: string[];
  rows: RequirementTraceRow[];
}

const REDACTED_KEYS = new Set([
  'prompt',
  'rawPrompt',
  'secret',
  'apiKey',
  'token',
  'privateId',
  'authorization',
  'password',
]);

function finiteRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function percentile(values: readonly number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function isRequirementId(value: string): value is WeeklyPlanningRequirementId {
  return (WEEKLY_PLANNING_REQUIREMENT_IDS as readonly string[]).includes(value);
}

export function validateRequirementMatrix(
  rows: readonly RequirementTraceRow[],
): RequirementMatrixValidation {
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(row.requirementId, (counts.get(row.requirementId) ?? 0) + 1));
  const missing = WEEKLY_PLANNING_REQUIREMENT_IDS.filter((id) => !counts.has(id));
  const duplicates = WEEKLY_PLANNING_REQUIREMENT_IDS.filter((id) => (counts.get(id) ?? 0) > 1);
  const unknown = Array.from(counts.keys()).filter((id) => !isRequirementId(id));
  const structurallyInvalid = rows.some((row) =>
    !row.owner.trim()
    || !row.task.trim()
    || row.strictAssertionIds.length === 0
    || new Set(row.strictAssertionIds).size !== row.strictAssertionIds.length
    || new Set(row.rubricIds).size !== row.rubricIds.length,
  );

  return {
    valid: missing.length === 0 && duplicates.length === 0 && unknown.length === 0 && !structurallyInvalid,
    missing: [...missing],
    duplicates: [...duplicates],
    unknown,
    rows: rows.map((row) => ({
      ...row,
      strictAssertionIds: [...row.strictAssertionIds],
      rubricIds: [...row.rubricIds],
    })),
  };
}

export function redactWeeklyPlanningReplay(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactWeeklyPlanningReplay);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [
    key,
    REDACTED_KEYS.has(key) || /secret|password|token|api.?key/i.test(key)
      ? '[REDACTED]'
      : redactWeeklyPlanningReplay(child),
  ]));
}

export function evaluateCasePassed(result: WeeklyPlanningEvaluationCaseResult): boolean {
  return result.strictResults.length > 0
    && result.strictResults.every((assertion) => assertion.passed && !assertion.forbiddenResultObserved)
    && result.requirementIds.length > 0;
}

export function aggregateWeeklyPlanningEvaluationMetrics(
  results: readonly WeeklyPlanningEvaluationCaseResult[],
): WeeklyPlanningEvaluationMetrics {
  const strictAssertions = results.flatMap((result) => result.strictResults);
  const rubricResults = results.flatMap((result) => result.rubricResults);
  const noReask = rubricResults.filter((result) => result.rubricId === 'no_reask');
  const latencies = results
    .map((result) => result.latencyMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);

  return {
    totalCases: results.length,
    strictPassRate: finiteRate(
      strictAssertions.filter((result) => result.passed && !result.forbiddenResultObserved).length,
      strictAssertions.length,
    ),
    rubricAverage: rubricResults.length === 0
      ? 0
      : rubricResults.reduce((sum, result) => sum + result.score, 0) / rubricResults.length,
    noReaskRate: finiteRate(noReask.filter((result) => result.score === 2).length, noReask.length),
    fallbackRate: finiteRate(results.filter((result) => Boolean(result.fallbackCategory)).length, results.length),
    staleDiscardCount: results.filter((result) => result.staleAsyncDiscarded).length,
    stalePreviewRejectionCount: results.filter((result) => result.stalePreviewRejected).length,
    pendingAssumptionRejectionCount: results.filter((result) => result.pendingAssumptionPreviewRejected).length,
    previewCompletionRate: finiteRate(results.filter((result) => result.previewCompleted).length, results.length),
    duplicateSuppressionRate: finiteRate(results.filter((result) => result.duplicateSaveSuppressed).length, results.length),
    partialRetryCompletionRate: finiteRate(results.filter((result) => result.partialRetryCompleted).length, results.length),
    textValidationRejectRate: finiteRate(results.filter((result) => result.textValidationRejected).length, results.length),
    providerFailureRate: finiteRate(results.filter((result) => result.providerFailure).length, results.length),
    plannerFailureRate: finiteRate(results.filter((result) => result.plannerFailure).length, results.length),
    ...(latencies.length > 0
      ? {
          p50LatencyMs: percentile(latencies, 0.5),
          p95LatencyMs: percentile(latencies, 0.95),
        }
      : {}),
  };
}

export function createDefaultRequirementMatrix(): RequirementTraceRow[] {
  const ownership: Record<WeeklyPlanningRequirementId, { owner: string; task: string }> = {
    'DA-GOAL-001': { owner: 'intake/dialogue', task: 'behavior-aware vertical slice' },
    'DA-SAFE-001': { owner: 'deterministic core', task: 'all' },
    'DA-INTERPRET-001': { owner: 'interpreter', task: 'behavior-aware vertical slice' },
    'DA-ACTION-001': { owner: 'dialogue planner', task: 'DA1' },
    'DA-TURN-001': { owner: 'dialogue orchestrator', task: 'DA2' },
    'DA-ASSUMPTION-001': { owner: 'assumption lifecycle', task: 'DA1b' },
    'DA-CORRECTION-001': { owner: 'correction lifecycle', task: 'DA1b' },
    'DA-RESPONSE-001': { owner: 'dialogue validation', task: 'DA1' },
    'DA-PREVIEW-001': { owner: 'preview bridge', task: 'DA0/approval' },
    'DA-RELATIVE-001': { owner: 'relative constraint domain', task: 'DA3a' },
    'DA-FEASIBILITY-001': { owner: 'feasibility consultation', task: 'DA3b' },
    'DA-PERSISTENCE-001': { owner: 'approval boundary', task: 'approval' },
    'DA-IDEMPOTENCY-001': { owner: 'approval ledger', task: 'approval' },
    'DA-FALLBACK-001': { owner: 'orchestrator/dialogue', task: 'DA1/DA2' },
    'DA-EVAL-001': { owner: 'evaluation', task: 'DA3c' },
  };
  return WEEKLY_PLANNING_REQUIREMENT_IDS.map((requirementId) => ({
    requirementId,
    owner: ownership[requirementId].owner,
    task: ownership[requirementId].task,
    status: 'complete',
    strictAssertionIds: [`${requirementId}:strict`],
    rubricIds: requirementId === 'DA-EVAL-001' ? ['mentor-rubric'] : [],
  }));
}
