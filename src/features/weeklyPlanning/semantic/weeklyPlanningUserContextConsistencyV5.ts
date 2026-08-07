import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_USER_CONTEXT_CONSISTENCY_VERSION_V5 =
  'weekly-planning-user-context-consistency-v5' as const;

function normalizedEvidence(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function validateWeeklyPlanningUserContextConsistencyV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const goalEvents = (document.userContextFacts ?? []).filter(
    (fact) => fact.kind === 'goal_event' && fact.dateExpression,
  );
  if (goalEvents.length === 0) return [];

  const errors: string[] = [];
  for (const [taskIndex, task] of document.tasks.entries()) {
    for (const [constraintIndex, constraint] of task.temporalConstraints.entries()) {
      if (constraint.kind !== 'deadline' || !constraint.dateExpression) continue;
      const deadlineEvidence = normalizedEvidence(constraint.sourceText);
      const conflictingEvent = goalEvents.find((event) =>
        event.dateExpression === constraint.dateExpression
        && normalizedEvidence(event.sourceText) === deadlineEvidence,
      );
      if (!conflictingEvent) continue;
      errors.push(
        `document.tasks[${taskIndex}].temporalConstraints[${constraintIndex}]:goal-event-and-work-deadline-share-evidence:keep-goal-event-and-remove-work-deadline-unless-distinct-explicit-completion-evidence-exists`,
      );
    }
  }
  return errors;
}
