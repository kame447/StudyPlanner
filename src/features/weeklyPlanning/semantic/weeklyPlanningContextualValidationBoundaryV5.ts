import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  isWeeklyPlanningContextualQuestionCodeV5,
  readWeeklyPlanningPendingQuestionV5,
} from './weeklyPlanningPendingQuestionV5';

/*
 * Validation boundary for machine-targeted short answers.
 *
 * The pending question owns the exact public target. The semantic document only
 * supplies the newly interpreted answer value. Normalizer-time validation must
 * therefore not require the AI to rediscover an existing entity binding that
 * the contextual-answer adapter intentionally resolves later.
 *
 * This predicate deliberately validates structure only. It never interprets
 * userText, labels, quantities, or units.
 */
export function isWeeklyPlanningMachineContextualValidationEnvelopeV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): boolean {
  const pending = readWeeklyPlanningPendingQuestionV5(params.publicStateSummary);
  if (
    !pending
    || !isWeeklyPlanningContextualQuestionCodeV5(pending.questionCode)
    || typeof pending.targetFactId !== 'string'
    || pending.targetFactId.length === 0
  ) return false;

  const stateRevision = params.publicStateSummary?.graphRevision;
  if (
    typeof stateRevision === 'number'
    && Number.isInteger(stateRevision)
    && pending.graphRevision !== stateRevision
  ) return false;

  const { document } = params;
  return document.planningIntent !== 'create_plan'
    && document.planningWindow === null
    && document.tasks.length === 1
    && document.relations.length === 0
    && document.availabilityDeclarations.length === 0
    && document.constraintSourceRequests.length === 0
    && document.decisions.length === 0;
}

export function allowsInheritedWorkloadEvidenceForContextualAnswerV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): boolean {
  if (!isWeeklyPlanningMachineContextualValidationEnvelopeV5(params)) return false;
  return readWeeklyPlanningPendingQuestionV5(params.publicStateSummary)?.questionCode
    === 'missing_effort_estimate';
}
