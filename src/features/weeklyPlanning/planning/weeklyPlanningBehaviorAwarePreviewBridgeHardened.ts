import {
  createBehaviorAwareNonExamDraftRun,
  type BehaviorAwarePlanningBridgeInput,
  type BehaviorAwarePlanningBridgeResult,
} from './weeklyPlanningBehaviorAwarePreviewBridge';
import { createPlanningHypothesisSnapshot } from './weeklyPlanningBehaviorPlanner';
import {
  createSafeAllowedDialogueActions,
  deriveCanonicalAvailabilityRanges,
  evaluateHardenedPreviewGate,
  hardenPlanningSnapshot,
} from './weeklyPlanningBehaviorSafety';

export function runHardenedBehaviorAwarePlanningPreviewBridge(
  input: BehaviorAwarePlanningBridgeInput,
): BehaviorAwarePlanningBridgeResult {
  const dayStartTime = input.sessionPolicy?.dayStartTime ?? '09:00';
  const dayEndTime = input.sessionPolicy?.dayEndTime ?? '22:00';
  const canonicalRanges = input.availabilityRanges ?? deriveCanonicalAvailabilityRanges({
    state: input.state,
    dayStartTime,
    dayEndTime,
  });

  const rawSnapshot = createPlanningHypothesisSnapshot({
    state: input.state,
    currentUserText: input.state.draftGenerationIntent === 'user_authorized'
      ? '仮で予定を組んで'
      : '',
    conversationId: input.conversationId,
    availabilityRanges: canonicalRanges,
  });
  const completeTaskDurations = input.state.tasks.length > 0 && input.state.tasks.every((task, index) => {
    if (task.unit === 'minutes' || task.unit === 'hours') {
      return typeof task.amount === 'number' && Number.isFinite(task.amount) && task.amount > 0;
    }
    const rate = input.state.unitRates.find((candidate) => candidate.unit === task.unit);
    const assumption = input.acceptedTaskDurationAssumptions?.find(
      (candidate) => candidate.taskRef === `task:${index}`,
    );
    return Boolean(
      typeof task.amount === 'number'
      && task.amount > 0
      && ((rate?.minutesPerUnit ?? 0) > 0 || (assumption?.minutes ?? 0) > 0),
    );
  });
  const hasExecutionShape = rawSnapshot.taskProfiles.length > 0
    && rawSnapshot.taskProfiles.every((profile) => profile.activityKind !== 'unknown')
    && completeTaskDurations;
  const hasAvailabilityBasis = canonicalRanges.length > 0;
  const snapshot = hardenPlanningSnapshot({
    snapshot: rawSnapshot,
    state: input.state,
    hasAvailabilityBasis,
  });
  const actions = createSafeAllowedDialogueActions(snapshot);
  const gate = evaluateHardenedPreviewGate({
    snapshot,
    hasExecutionShape,
    hasAvailabilityBasis,
  });
  const draftRun = gate.allowed && !input.state.examPrepScope
    ? createBehaviorAwareNonExamDraftRun({
      input: { ...input, availabilityRanges: canonicalRanges },
      snapshot,
    })
    : null;

  return { snapshot, actions, gate, draftRun };
}
