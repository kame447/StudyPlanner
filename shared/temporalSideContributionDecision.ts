// Bounded, provider-neutral projection. The classifier can only decide whether
// a focused Luna extraction may be skipped; it cannot add or apply a fact.
export interface TemporalSideContributionDecisionContext {
  purpose: 'temporal_side_contribution';
  requestId: string;
  inputRevision: number;
  state: {
    currentUserText: string;
    knownTask: {
      title: string;
      category: string;
    };
    pendingQuestion: {
      questionCode: string;
    };
  };
}

export interface TemporalSideContributionDecisionResponse {
  decision: 'no_temporal_side_contribution';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && new TextEncoder().encode(value).length <= maxBytes;
}

export function isTemporalSideContributionDecisionContext(
  value: unknown,
): value is TemporalSideContributionDecisionContext {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'purpose', 'requestId', 'inputRevision', 'state',
  ])) return false;
  const state = value.state;
  if (!isRecord(state) || !hasOnlyKeys(state, [
    'currentUserText', 'knownTask', 'pendingQuestion',
  ])) return false;
  if (!isRecord(state.knownTask)
    || !hasOnlyKeys(state.knownTask, ['title', 'category'])
    || !isRecord(state.pendingQuestion)
    || !hasOnlyKeys(state.pendingQuestion, ['questionCode'])) return false;

  return value.purpose === 'temporal_side_contribution'
    && boundedText(value.requestId, 160)
    && Number.isSafeInteger(value.inputRevision)
    && Number(value.inputRevision) >= 0
    && boundedText(state.currentUserText, 8_000)
    && boundedText(state.knownTask.title, 1_000)
    && boundedText(state.knownTask.category, 100)
    && boundedText(state.pendingQuestion.questionCode, 160);
}
