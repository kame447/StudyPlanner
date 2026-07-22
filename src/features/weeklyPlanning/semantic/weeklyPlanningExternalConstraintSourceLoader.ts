import type { SemanticConstraintSourceKind } from './weeklyPlanningSemanticDocumentV2';
import type {
  ExternalConstraintEvent,
  ExternalConstraintSourceFailureKind,
  ExternalConstraintSourceSnapshot,
} from './weeklyPlanningAvailabilityResolver';

export interface ExternalConstraintSourceFetchSuccess {
  status: 'success';
  ownerId: string;
  activeSourceId: string | null;
  events: ExternalConstraintEvent[];
}

export interface ExternalConstraintSourceFetchFailure {
  status: 'failure';
  failureKind: ExternalConstraintSourceFailureKind;
}

export type ExternalConstraintSourceFetchAttemptResult =
  | ExternalConstraintSourceFetchSuccess
  | ExternalConstraintSourceFetchFailure;

export interface ExternalConstraintSourceRetryPolicy {
  maxAttempts: number;
  retryDelaysMs: number[];
}

export interface ExternalConstraintSourceLoadContext {
  kind: SemanticConstraintSourceKind;
  ownerId: string;
}

export type ExternalConstraintSourceFetchAttempt = (
  context: ExternalConstraintSourceLoadContext,
  attemptNumber: number,
) => Promise<ExternalConstraintSourceFetchAttemptResult>;

export type ExternalConstraintSourceWait = (delayMs: number) => Promise<void>;

export const DEFAULT_EXTERNAL_CONSTRAINT_SOURCE_RETRY_POLICY:
ExternalConstraintSourceRetryPolicy = {
  maxAttempts: 3,
  retryDelaysMs: [250, 1_000],
};

const RETRYABLE_FAILURES = new Set<ExternalConstraintSourceFailureKind>([
  'timeout',
  'network_error',
  'rate_limited',
  'server_error',
]);

function normalizeRetryPolicy(
  policy: ExternalConstraintSourceRetryPolicy,
): ExternalConstraintSourceRetryPolicy {
  return {
    maxAttempts: Number.isInteger(policy.maxAttempts) && policy.maxAttempts > 0
      ? policy.maxAttempts
      : 1,
    retryDelaysMs: policy.retryDelaysMs.map((delay) =>
      Number.isFinite(delay) && delay > 0 ? delay : 0),
  };
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function retryDelay(
  policy: ExternalConstraintSourceRetryPolicy,
  completedAttemptCount: number,
): number {
  return policy.retryDelaysMs[completedAttemptCount - 1]
    ?? policy.retryDelaysMs[policy.retryDelaysMs.length - 1]
    ?? 0;
}

export async function loadExternalConstraintSourceAtomically(params: {
  context: ExternalConstraintSourceLoadContext;
  fetchAttempt: ExternalConstraintSourceFetchAttempt;
  retryPolicy?: ExternalConstraintSourceRetryPolicy;
  wait?: ExternalConstraintSourceWait;
}): Promise<ExternalConstraintSourceSnapshot> {
  const policy = normalizeRetryPolicy(
    params.retryPolicy ?? DEFAULT_EXTERNAL_CONSTRAINT_SOURCE_RETRY_POLICY,
  );
  const wait = params.wait ?? defaultWait;
  let lastFailure: ExternalConstraintSourceFailureKind = 'unknown_error';

  for (let attemptNumber = 1; attemptNumber <= policy.maxAttempts; attemptNumber += 1) {
    let result: ExternalConstraintSourceFetchAttemptResult;
    try {
      result = await params.fetchAttempt(params.context, attemptNumber);
    } catch {
      result = { status: 'failure', failureKind: 'unknown_error' };
    }

    if (result.status === 'success') {
      return {
        kind: params.context.kind,
        status: 'success',
        ownerId: result.ownerId,
        activeSourceId: result.activeSourceId,
        events: [...result.events],
        attemptCount: attemptNumber,
      };
    }

    lastFailure = result.failureKind;
    const canRetry = RETRYABLE_FAILURES.has(result.failureKind)
      && attemptNumber < policy.maxAttempts;
    if (!canRetry) break;

    const delayMs = retryDelay(policy, attemptNumber);
    if (delayMs > 0) await wait(delayMs);
  }

  return {
    kind: params.context.kind,
    status: 'failure',
    ownerId: params.context.ownerId,
    activeSourceId: null,
    failureKind: lastFailure,
    attemptCount: policy.maxAttempts,
  };
}
