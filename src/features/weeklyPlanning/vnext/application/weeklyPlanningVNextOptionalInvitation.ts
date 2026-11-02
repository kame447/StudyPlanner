import { stableV5MissingSchedulableWorkQuestion } from '../weeklyPlanningVNextV5Boundary';
import type { VNextQuestion, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createVNextLineageResolver, withCurrentVNextReferences } from '../weeklyPlanningVNextWorkIdentity';

/** Presentation adapter only: V5 owns the question's target, intent and wording. The session's
 * final V5 compilation/status decides whether to ask it. Never replace a required owner question
 * with this invitation. OptionalInvitation integration guards decline, reload and required priority.
 */
export function createVNextOptionalInvitation(state: WeeklyPlanningVNextState): VNextQuestion | null {
  const resolver = createVNextLineageResolver(state.graph);
  const graph = withCurrentVNextReferences(state.graph, id => resolver.leafOf(id) ?? id);
  const question = stableV5MissingSchedulableWorkQuestion(graph);
  if (question.targetFactId !== null) return null;
  return { code: question.questionCode, key: `missing_schedulable_work:optional-invitation:${graph.revision}`,
    ownerKey: 'optional-invitation', taskId: null, componentId: null, subjectLineageIds: [], forWork: null,
    options: [], optionalInvitation: { message: question.message, intent: question.intent } };
}
