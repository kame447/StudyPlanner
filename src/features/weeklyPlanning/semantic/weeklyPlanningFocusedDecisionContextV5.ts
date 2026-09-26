import {
  isFocusedAuthorizationDecisionContext,
  type FocusedAuthorizationDecisionContext,
} from '../../../../shared/focusedAuthorizationDecision';
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
