import {
  isFocusedAuthorizationDecisionContext,
  type FocusedAuthorizationDecisionContext,
} from '../../../../shared/focusedAuthorizationDecision';
import {
  isFocusedContextualDecisionContext,
  type FocusedContextualDecisionContext,
} from '../../../../shared/focusedContextualDecision';
import { focusedContextualTargetV5 } from './weeklyPlanningFocusedContextualAnswerV5';
import { focusedAuthorizationEligibleV5 } from './weeklyPlanningFocusedAuthorizationV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';

export function focusedDecisionContextV5(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): FocusedAuthorizationDecisionContext | undefined {
  if (!focusedAuthorizationEligibleV5(input)) return undefined;
  const context = {
    purpose: 'focused_authorization', requestId: input.traceRequestId,
    inputRevision: input.publicStateSummary?.graphRevision,
    previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
    state: {
      currentUserText: input.userText,
      lastAssistantMessage: typeof input.publicStateSummary?.lastAssistantMessage === 'string'
        ? input.publicStateSummary.lastAssistantMessage : null,
    },
  };
  return isFocusedAuthorizationDecisionContext(context) ? context : undefined;
}

export function focusedContextualDecisionContextV5(
  input: WeeklyPlanningSemanticNormalizerInputV5,
): FocusedContextualDecisionContext | undefined {
  const target = focusedContextualTargetV5(input);
  if (!target) return undefined;
  const context = {
    purpose: 'focused_contextual_answer' as const,
    requestId: input.traceRequestId,
    inputRevision: target.graphRevision,
    questionCode: target.questionCode,
    state: {
      currentUserText: input.userText,
      pendingQuestion: {
        targetQuantityRole: target.quantityRole,
        questionBasis: target.questionBasis,
        hasEstimateTarget: target.estimateForWorkload !== null,
      },
    },
  };
  return isFocusedContextualDecisionContext(context) ? context : undefined;
}
