import {
  isFocusedAuthorizationDecisionContext,
  type FocusedAuthorizationDecisionContext,
} from './focusedAuthorizationDecision';
import {
  isTemporalScopeRepairDecisionContext,
  type TemporalScopeRepairDecisionContext,
} from './temporalScopeRepairDecision';
import {
  isUserContextRoutingDecisionContext,
  type UserContextRoutingDecisionContext,
} from './userContextRoutingDecision';
import { isFocusedContextualTargetBinding, snapshotFocusedContextualTargetBinding, type FocusedContextualTargetBinding } from './focusedContextualTargetBinding';

export const FOCUSED_CONTEXTUAL_QUESTION_CODES = [
  'missing_effort_estimate',
  'quantity_role_unresolved',
] as const;

export type FocusedContextualQuestionCode =
  (typeof FOCUSED_CONTEXTUAL_QUESTION_CODES)[number];

export type FocusedContextualTargetQuantityRole =
  | 'declared'
  | 'scope_total'
  | 'target'
  | 'remaining'
  | 'completed'
  | 'unknown';

// Provider-neutral, bounded projection. It carries no canonical IDs and grants
// no scheduler, preview, approval, or save authority.
export interface LegacyFocusedContextualDecisionContext {
  purpose: 'focused_contextual_answer';
  requestId: string;
  inputRevision: number;
  questionCode: FocusedContextualQuestionCode;
  state: {
    currentUserText: string;
    pendingQuestion: {
      targetQuantityRole: FocusedContextualTargetQuantityRole;
      questionBasis: 'completed_workload_total' | null;
      hasEstimateTarget: boolean;
    };
  };
}

/** Wire v2 is unknown to old Workers, which safely retain the original Luna request. */
export interface BoundFocusedContextualDecisionContext extends Omit<LegacyFocusedContextualDecisionContext, 'purpose' | 'state'> {
  purpose: 'focused_contextual_answer_v2';
  targetToken: string;
  state: {
    currentUserText: string;
    pendingQuestion: LegacyFocusedContextualDecisionContext['state']['pendingQuestion'] & {
      target: FocusedContextualTargetBinding;
    };
  };
}
export type FocusedContextualDecisionContext = LegacyFocusedContextualDecisionContext | BoundFocusedContextualDecisionContext;

// The envelope owns question identity. Provider input adds it explicitly rather
// than allowing an independently supplied duplicate in the browser state.
export type FocusedContextualDecisionState = Readonly<{
  questionCode: FocusedContextualQuestionCode;
  currentUserText: string;
  pendingQuestion: Readonly<FocusedContextualDecisionContext['state']['pendingQuestion']>;
}>;

export function focusedContextualDecisionState(
  context: FocusedContextualDecisionContext,
): FocusedContextualDecisionState | null {
  if (!isFocusedContextualDecisionContext(context)) return null;
  return Object.freeze({
    questionCode: context.questionCode,
    currentUserText: context.state.currentUserText,
    pendingQuestion: Object.freeze({ ...context.state.pendingQuestion,
      ...(context.purpose === 'focused_contextual_answer_v2'
        ? { target: snapshotFocusedContextualTargetBinding(context.state.pendingQuestion.target) } : {}),
    }),
  });
}

export type FocusedDecisionContext =
  | FocusedAuthorizationDecisionContext
  | FocusedContextualDecisionContext
  | TemporalScopeRepairDecisionContext
  | UserContextRoutingDecisionContext;

export type FocusedContextualDecisionResponse = {
  decision: 'quantity_role_answer';
  effortTarget: null;
  effortMeasurement: null;
  minutes: null;
  precision: null;
  quantityRole: 'target' | 'remaining' | 'completed';
} | {
  decision: 'fallback';
  effortTarget: null;
  effortMeasurement: null;
  minutes: null;
  precision: null;
  quantityRole: null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isQuestionCode(value: unknown): value is FocusedContextualQuestionCode {
  return typeof value === 'string'
    && (FOCUSED_CONTEXTUAL_QUESTION_CODES as readonly string[]).includes(value);
}

function isQuantityRole(value: unknown): value is FocusedContextualTargetQuantityRole {
  return typeof value === 'string' && [
    'declared',
    'scope_total',
    'target',
    'remaining',
    'completed',
    'unknown',
  ].includes(value);
}

export function isFocusedContextualDecisionContext(
  value: unknown,
): value is FocusedContextualDecisionContext {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'purpose',
    'requestId',
    'inputRevision',
    'questionCode',
    'state',
    ...(value.purpose === 'focused_contextual_answer_v2' ? ['targetToken'] : []),
  ])) return false;
  if (!isRecord(value.state) || !hasOnlyKeys(value.state, [
    'currentUserText',
    'pendingQuestion',
  ])) return false;
  const pendingQuestion = value.state.pendingQuestion;
  if (!isRecord(pendingQuestion) || !hasOnlyKeys(pendingQuestion, [
    'targetQuantityRole',
    'questionBasis',
    'hasEstimateTarget',
    ...(value.purpose === 'focused_contextual_answer_v2' ? ['target'] : []),
  ])) return false;

  if (
    (value.purpose !== 'focused_contextual_answer' && value.purpose !== 'focused_contextual_answer_v2')
    || typeof value.requestId !== 'string'
    || value.requestId.trim().length === 0
    || value.requestId.length > 160
    || typeof value.inputRevision !== 'number' || !Number.isSafeInteger(value.inputRevision)
    || value.inputRevision < 0
    || !isQuestionCode(value.questionCode)
    || typeof value.state.currentUserText !== 'string'
    || value.state.currentUserText.trim().length === 0
    || new TextEncoder().encode(value.state.currentUserText).length > 8_000
    || !isQuantityRole(pendingQuestion.targetQuantityRole)
    || (pendingQuestion.questionBasis !== null
      && pendingQuestion.questionBasis !== 'completed_workload_total')
    || typeof pendingQuestion.hasEstimateTarget !== 'boolean'
  ) return false;

  if (value.purpose === 'focused_contextual_answer_v2') {
    const target = pendingQuestion.target;
    if (!isFocusedContextualTargetBinding(target) || typeof value.targetToken !== 'string'
      || target.targetToken !== value.targetToken || target.sourceRevision !== value.inputRevision
      || target.questionCode !== value.questionCode || target.workload.quantityRole !== pendingQuestion.targetQuantityRole) return false;
  }

  if (value.questionCode === 'quantity_role_unresolved') {
    return (pendingQuestion.targetQuantityRole === 'declared'
      || pendingQuestion.targetQuantityRole === 'unknown')
      && pendingQuestion.questionBasis === null
      && pendingQuestion.hasEstimateTarget === false;
  }

  return (pendingQuestion.questionBasis === 'completed_workload_total')
    === pendingQuestion.hasEstimateTarget;
}

export function isFocusedDecisionContext(value: unknown): value is FocusedDecisionContext {
  return isFocusedAuthorizationDecisionContext(value)
    || isFocusedContextualDecisionContext(value)
    || isTemporalScopeRepairDecisionContext(value)
    || isUserContextRoutingDecisionContext(value);
}
