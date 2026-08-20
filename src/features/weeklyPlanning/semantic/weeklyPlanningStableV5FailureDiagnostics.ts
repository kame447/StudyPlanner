import type {
  WeeklyPlanningSemanticNormalizerDiagnosticsV5,
} from './weeklyPlanningSemanticNormalizerV5';

export type WeeklyPlanningStableV5FailureStatus =
  | 'provider_failure'
  | 'normalization_rejected'
  | 'canonicalization_rejected';

export interface WeeklyPlanningStableV5RecordedFailure {
  status: WeeklyPlanningStableV5FailureStatus;
  attemptCount: number;
  repairAttempted: boolean;
  validationErrorCategories: string[];
  canonicalizationErrorCategories: string[];
  canonicalizationErrors: string[];
  providerErrorCategory: 'provider_error' | null;
  traceCode: string;
}

const MAX_RECORDED_FAILURES = 128;
const failuresByTurnId = new Map<string, WeeklyPlanningStableV5RecordedFailure>();

function validationErrorCategory(value: string): string {
  const error = value.replace(/^(?:initial|repair):/, '');
  if (error === 'document:invalid-json') return 'invalid_json';
  if (error.includes('.missing-key:')) return 'missing_key';
  if (error.includes('.unknown-key:')) return 'unknown_key';
  if (error.includes(':not-object')) return 'not_object';
  if (error.includes(':not-array')) return 'not_array';
  if (error.includes(':clock-format')) return 'clock_format';
  if (error.includes(':canonical-expression')) return 'canonical_date_expression';
  if (error.includes(':duplicate:')) return 'duplicate_local_id';
  if (
    error.includes(':unknown:')
    || error.includes('LocalId')
    || error.includes('parent-ref')
    || error.includes('target-ref')
  ) {
    return 'invalid_reference';
  }
  return 'schema_validation';
}

function canonicalizationErrorCategory(value: string): string {
  if (value.startsWith('correction-application:')) return 'correction_application';
  if (value.includes('existing-entity') || value.includes('binding')) return 'entity_binding';
  if (value.startsWith('revision-mismatch:')) return 'revision_mismatch';
  if (value.startsWith('fact-id-collision:') || value.startsWith('local-id-mapped-twice:')) {
    return 'identity_collision';
  }
  if (value.includes('progress')) return 'progress_projection';
  return 'canonicalization';
}

function trimRegistry(): void {
  while (failuresByTurnId.size > MAX_RECORDED_FAILURES) {
    const oldest = failuresByTurnId.keys().next().value;
    if (typeof oldest !== 'string') return;
    failuresByTurnId.delete(oldest);
  }
}

export function recordWeeklyPlanningStableV5FailureDiagnostics(params: {
  turnId: string;
  status: WeeklyPlanningStableV5FailureStatus;
  diagnostics: WeeklyPlanningSemanticNormalizerDiagnosticsV5;
  canonicalizationErrors?: readonly string[];
}): void {
  const validationErrorCategories = [...new Set(
    params.diagnostics.validationErrors.map(validationErrorCategory),
  )].sort();
  const canonicalizationErrors = [...(params.canonicalizationErrors ?? [])];
  const canonicalizationErrorCategories = [...new Set(
    canonicalizationErrors.map(canonicalizationErrorCategory),
  )].sort();
  const providerErrorCategory = params.diagnostics.providerError
    ? 'provider_error' as const
    : null;
  const traceParts = [
    `stable_v5_${params.status}`,
    `attempts=${params.diagnostics.attemptCount}`,
    `repair=${params.diagnostics.repairAttempted ? 1 : 0}`,
  ];
  if (validationErrorCategories.length > 0) {
    traceParts.push(`validation=${validationErrorCategories.join(',')}`);
  }
  if (canonicalizationErrorCategories.length > 0) {
    traceParts.push(`canonical=${canonicalizationErrorCategories.join(',')}`);
  }
  if (providerErrorCategory) {
    traceParts.push(`provider=${providerErrorCategory}`);
  }
  failuresByTurnId.set(params.turnId, {
    status: params.status,
    attemptCount: params.diagnostics.attemptCount,
    repairAttempted: params.diagnostics.repairAttempted,
    validationErrorCategories,
    canonicalizationErrorCategories,
    canonicalizationErrors,
    providerErrorCategory,
    traceCode: traceParts.join('|'),
  });
  trimRegistry();
}

export function takeWeeklyPlanningStableV5FailureDiagnostics(
  turnId: string,
): WeeklyPlanningStableV5RecordedFailure | null {
  const failure = failuresByTurnId.get(turnId) ?? null;
  failuresByTurnId.delete(turnId);
  return failure;
}

export function resetWeeklyPlanningStableV5FailureDiagnosticsForTest(): void {
  failuresByTurnId.clear();
}
