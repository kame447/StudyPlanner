import type { PlanningIntakeMissing, PlanningIntakeState, PlanningIntakeStatus } from './weeklyPlanningIntakeTypes';
import {
  QUESTION_SLOT_DEFINITION_BY_MISSING,
  statusForMissing,
} from './weeklyPlanningQuestionSlots';

function uniqueList<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function addMissing(
  current: PlanningIntakeMissing[],
  additions: PlanningIntakeMissing[],
): PlanningIntakeMissing[] {
  return uniqueList([...current, ...additions]);
}

export function removeMissing(
  current: PlanningIntakeMissing[],
  removals: PlanningIntakeMissing[],
): PlanningIntakeMissing[] {
  const removalSet = new Set(removals);
  return current.filter((item) => !removalSet.has(item));
}

export function hasConfirmedFixedEvents(state: PlanningIntakeState): boolean {
  return state.fixedEventsDeclaredNone === true
    || Boolean(state.constraintSourcesInUse?.length)
    || state.constraints.some((constraint) =>
      constraint.kind === 'unavailable'
      || (constraint.kind === 'fixed_event' && constraint.hardness === 'hard'),
    );
}

export function hasConfirmedSleepCycle(state: PlanningIntakeState): boolean {
  return state.constraints.some((constraint) =>
    constraint.kind === 'sleep' || constraint.kind === 'buffer',
  );
}

export function hasConfirmedMealBathConstraints(state: PlanningIntakeState): boolean {
  return state.constraints.some((constraint) =>
    constraint.kind === 'meal' || constraint.kind === 'bath',
  );
}

export function hasConfirmedLifeConstraints(state: PlanningIntakeState): boolean {
  return hasConfirmedSleepCycle(state) && hasConfirmedMealBathConstraints(state);
}

export function hasConfirmedYearFieldUnitRate(state: PlanningIntakeState): boolean {
  return state.unitRates.some((rate) =>
    rate.unit === 'year_field_chunk'
    && typeof rate.minutesPerUnit === 'number'
    && Number.isFinite(rate.minutesPerUnit)
    && rate.minutesPerUnit > 0,
  );
}

function applyUnitRateMissingState(state: PlanningIntakeState): PlanningIntakeState {
  if (state.examPrepScope?.unitModel !== 'year_field_chunk') return state;
  const missing = hasConfirmedYearFieldUnitRate(state)
    ? removeMissing(state.missing, ['unit_duration_estimate'])
    : addMissing(state.missing, ['unit_duration_estimate']);
  return missing.length === state.missing.length
    && missing.every((item, index) => item === state.missing[index])
    ? state
    : { ...state, missing };
}

export function deriveMissingForPlanningRange(
  state: PlanningIntakeState,
): PlanningIntakeMissing[] {
  const missing: PlanningIntakeMissing[] = [];
  if (!state.examPrepScope && state.tasks.length === 0) missing.push('tasks_or_goals');
  if (!hasConfirmedFixedEvents(state)) missing.push('fixed_events');
  if (!hasConfirmedSleepCycle(state)) missing.push('sleep_cycle');
  if (!hasConfirmedMealBathConstraints(state)) missing.push('meal_bath_constraints');
  return missing;
}

function applyPriorityMissingState(state: PlanningIntakeState): PlanningIntakeState {
  const fields = uniqueList((state.examPrepScope?.fields ?? []).map((field) => field.trim()).filter(Boolean));
  const totalFields = state.examPrepScope?.totalFields;
  const isPriorityStage = Boolean(
    state.examPrepScope
    && hasConfirmedYearFieldUnitRate(state)
    && !state.missing.includes('year_range')
    && !state.missing.includes('completion_direction'),
  );
  if (!isPriorityStage) return state;

  const isKnownSingleField = fields.length === 1 && (totalFields === undefined || totalFields === 1);
  let nextState = state;
  if (!isKnownSingleField && state.priorityPolicySource === 'derived_single_field') {
    nextState = {
      ...state,
      priorityPolicy: { kind: 'unknown' },
      priorityPolicySource: undefined,
    };
  }

  if (isKnownSingleField) {
    const missing = removeMissing(nextState.missing, ['priority_policy', 'next_field_after_math']);
    if (nextState.priorityPolicy.kind === 'unknown') {
      return {
        ...nextState,
        priorityPolicy: { kind: 'field_first', order: [fields[0]] },
        priorityPolicySource: 'derived_single_field',
        missing,
      };
    }
    return missing.length === nextState.missing.length ? nextState : { ...nextState, missing };
  }

  if (nextState.priorityPolicy.kind === 'unknown') {
    return {
      ...nextState,
      missing: addMissing(nextState.missing, ['priority_policy', 'next_field_after_math']),
    };
  }
  return nextState;
}

const STATE_QUESTION_MISSING_ORDER: readonly PlanningIntakeMissing[] = [
  'planning_period',
  'planning_start_date',
  'planning_duration',
  'tasks_or_goals',
  'year_range',
  'completion_direction',
  'unit_duration_estimate',
  'priority_policy',
];

function resolveQuestions(state: PlanningIntakeState): string[] {
  return STATE_QUESTION_MISSING_ORDER.flatMap((missing) => {
    const definition = QUESTION_SLOT_DEFINITION_BY_MISSING[missing];
    if (!definition.isStateQuestionEligible(state)) return [];
    if (missing === 'planning_duration' && state.missing.includes('planning_start_date')) {
      return [];
    }
    const question = definition.deterministicQuestion(state);
    return question ? [question] : [];
  });
}

function resolveStatus(state: PlanningIntakeState): PlanningIntakeStatus {
  const missingStatus = statusForMissing(state.missing);
  if (missingStatus) return missingStatus;
  return state.tasks.length > 0 || state.examPrepScope ? 'draft_ready' : 'idle';
}

export function finalizeState(state: PlanningIntakeState): PlanningIntakeState {
  const stateWithUnitRateMissing = applyUnitRateMissingState(state);
  const stateWithPriorityMissing = applyPriorityMissingState(stateWithUnitRateMissing);
  const status = resolveStatus(stateWithPriorityMissing);
  const nextState = {
    ...stateWithPriorityMissing,
    status,
    missing: uniqueList(stateWithPriorityMissing.missing),
    assumptions: uniqueList(stateWithPriorityMissing.assumptions),
    uncertainties: uniqueList(stateWithPriorityMissing.uncertainties),
  };
  const shouldCreateDraft = status === 'draft_ready' && nextState.missing.length === 0;
  return {
    ...nextState,
    questions: resolveQuestions(nextState),
    shouldCreateDraft,
    shouldSavePlan: false,
  };
}
