// Provider-neutral, bounded projection for deciding only whether one temporal
// statement is plan-wide unavailability. It grants no lifecycle, scheduler,
// approval, save, or persistence authority and carries no canonical IDs.
export interface TemporalScopeRepairDecisionContext {
  purpose: 'temporal_scope_repair';
  requestId: string;
  inputRevision: number;
  state: {
    sourceText: string;
    currentAttachedTask: {
      title: string;
    };
    interpretedTime: {
      dateExpression: string;
      namedTimePeriod: string | null;
      startTime: string | null;
      endTime: string | null;
    };
  };
}

export interface TemporalScopeRepairDecisionResponse {
  decision: 'plan_unavailable' | 'uncertain';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedText(value: unknown, maxBytes: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && (allowEmpty || value.trim().length > 0)
    && new TextEncoder().encode(value).length <= maxBytes;
}

function isNullableBoundedText(value: unknown, maxBytes: number): value is string | null {
  return value === null || isBoundedText(value, maxBytes);
}

export function isTemporalScopeRepairDecisionContext(
  value: unknown,
): value is TemporalScopeRepairDecisionContext {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'purpose',
    'requestId',
    'inputRevision',
    'state',
  ])) return false;
  if (!isRecord(value.state) || !hasOnlyKeys(value.state, [
    'sourceText',
    'currentAttachedTask',
    'interpretedTime',
  ])) return false;
  const task = value.state.currentAttachedTask;
  const time = value.state.interpretedTime;
  if (!isRecord(task) || !hasOnlyKeys(task, ['title'])) return false;
  if (!isRecord(time) || !hasOnlyKeys(time, [
    'dateExpression',
    'namedTimePeriod',
    'startTime',
    'endTime',
  ])) return false;

  return value.purpose === 'temporal_scope_repair'
    && isBoundedText(value.requestId, 160)
    && Number.isSafeInteger(value.inputRevision)
    && Number(value.inputRevision) >= 0
    && isBoundedText(value.state.sourceText, 8_000)
    && isBoundedText(task.title, 1_000)
    && isBoundedText(time.dateExpression, 1_000)
    && isNullableBoundedText(time.namedTimePeriod, 500)
    && isNullableBoundedText(time.startTime, 100)
    && isNullableBoundedText(time.endTime, 100)
    && (time.startTime !== null || time.endTime !== null);
}
