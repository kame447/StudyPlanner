import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
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

function minutes(time: string): number {
  const [hour = '0', minute = '0'] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

function timeFromMinutes(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function schedulingAvailabilityLowerBound(state: PlanningIntakeState): string | undefined {
  const lowerBounds = state.constraints.flatMap((constraint) => {
    if (constraint.studyAvailableStart) return [constraint.studyAvailableStart];
    if (constraint.kind === 'commute' && constraint.end) return [constraint.end];
    return [];
  });
  const morningAvoided = state.sourceTurns.some((turn) =>
    /朝(?:は|だと).*(?:続かない|苦手|無理|できない)/.test(turn),
  );
  if (morningAvoided) lowerBounds.push('12:00');

  if (lowerBounds.length === 0) {
    const mealEnd = state.constraints.find((constraint) =>
      constraint.kind === 'meal' && Boolean(constraint.end),
    )?.end;
    if (mealEnd) lowerBounds.push(mealEnd);
  }

  if (lowerBounds.length === 0) return undefined;
  return timeFromMinutes(Math.max(...lowerBounds.map(minutes)));
}

function stateForScheduling(state: PlanningIntakeState): PlanningIntakeState {
  const lowerBound = schedulingAvailabilityLowerBound(state);
  if (!lowerBound) return state;

  return {
    ...state,
    constraints: [
      ...state.constraints,
      {
        kind: 'buffer',
        studyAvailableStart: lowerBound,
        hardness: 'soft',
        rawText: 'behavior-aware availability lower bound',
      },
    ],
  };
}

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
    currentUserText: '',
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
    const hasRateDuration = typeof task.amount === 'number'
      && task.amount > 0
      && (rate?.minutesPerUnit ?? 0) > 0;
    const hasAcceptedAssumption = (assumption?.minutes ?? 0) > 0;
    return hasRateDuration || hasAcceptedAssumption;
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
      input: {
        ...input,
        state: stateForScheduling(input.state),
        availabilityRanges: canonicalRanges,
      },
      snapshot,
    })
    : null;

  return { snapshot, actions, gate, draftRun };
}
