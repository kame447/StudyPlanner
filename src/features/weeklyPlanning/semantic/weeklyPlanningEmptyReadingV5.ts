import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { hasSelfSufficientConversationActV5 } from './weeklyPlanningConversationActsV5';

/**
 * The one typed definition of an EMPTY reading (Issue #488, x6): the reading carries no delta anywhere and no
 * conversational act the renderer would answer. An existing-entity shell with nothing in it counts as empty (it is
 * binding context only). A bare `answer_pending_question` act counts as empty too: it is not a change. Any other act
 * (consultation, explain/aside, topic shift, resume, decline, event registration) is meaning the application answers,
 * so the reading is not empty. Typed fields only; never text.
 *
 * Used by the no-op re-read eligibility, the `nothingRead` turn fact and the free-form release.
 */
export function hasTaskSemanticPayloadV5(document: WeeklyPlanningSemanticDocumentV5): boolean {
  return document.tasks.some((task) => {
    if (!task.existingPublicId) return true;
    if (
      task.workloads.length > 0
      || task.effortEstimates.length > 0
      || task.temporalConstraints.length > 0
      || task.recurrence.length > 0
      || (task.durableContextSignals?.length ?? 0) > 0
    ) return true;

    return (task.study?.components ?? []).some((component) =>
      !component.existingPublicId
      || component.workloads.length > 0
      || (component.durableContextSignals?.length ?? 0) > 0);
  });
}

export function hasNoDeltaAnywhereV5(document: WeeklyPlanningSemanticDocumentV5): boolean {
  // An explicit `create_plan` intent is the model's typed creation-authorization reading (the user said go ahead and make
  // it): it is meaning the application acts on, not an empty reading, even with no task payload.
  return document.planningIntent !== 'create_plan'
    && document.planningWindow === null
    && document.relations.length === 0
    && document.availabilityDeclarations.length === 0
    && document.constraintSourceRequests.length === 0
    && (document.userContextFacts?.length ?? 0) === 0
    && document.uncertainties.length === 0
    && document.corrections.length === 0
    && document.decisions.length === 0
    && !hasTaskSemanticPayloadV5(document);
}

export function isEmptyReadingV5(document: WeeklyPlanningSemanticDocumentV5): boolean {
  return hasNoDeltaAnywhereV5(document) && !hasSelfSufficientConversationActV5(document.conversationActs);
}
