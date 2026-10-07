import { hasSelfSufficientConversationActV5 } from './weeklyPlanningConversationActsV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import type { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticTypesV5';

/**
 * One semantic owner, two independently validated parts (Issue #488).
 *
 * When no planning delta of this turn is usable (every generic response was rejected after
 * the single permitted repair, or the repair call itself failed), a valid self-sufficient
 * conversation act from one of those responses still carries the turn: the user asked what
 * a question means, moved to an aside, resumed a topic or asked for advice. The result is an
 * ordinary accepted document with an EMPTY planning delta, so nothing invalid is applied and
 * nothing authoritative changes; the act itself grants no authorization, readiness, preview,
 * approval or save. A bare `answer_pending_question` act needs its delta and is never enough.
 *
 * No second model call is made; only acts the semantic model already returned are used.
 */
function conversationOnlyDocument(
  acts: NonNullable<WeeklyPlanningSemanticDocumentV5['conversationActs']>,
): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    conversationActs: acts,
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

export function continueWithConversationActsOnlyV5(params: {
  run: WeeklyPlanningSemanticNormalizerRunV5;
  result: WeeklyPlanningSemanticNormalizerResultV5;
}): WeeklyPlanningSemanticNormalizerResultV5 {
  if (params.result.status === 'accepted') return params.result;
  const candidate = [...params.run.conversationActCandidates]
    .reverse()
    .find((entry) => hasSelfSufficientConversationActV5(entry.acts));
  if (!candidate) return params.result;

  const result: WeeklyPlanningSemanticNormalizerResultV5 = {
    status: 'accepted',
    document: conversationOnlyDocument(candidate.acts),
    conversationOnly: {
      planningDelta: params.result.status === 'provider_failure' ? 'provider_failure' : 'rejected',
      planningContentPresent: candidate.planningContentPresent,
      actSource: candidate.source,
    },
    // The rejected attempts stay visible as evidence of what was not applied.
    diagnostics: params.result.diagnostics,
  };
  params.run.recordDecision(result, {
    route: 'conversation_acts_without_planning_delta',
    severity: 'warn',
  });
  return result;
}
