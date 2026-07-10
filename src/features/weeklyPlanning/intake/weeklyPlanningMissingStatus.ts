import type { PlanningIntakeMissing, PlanningIntakeState, PlanningIntakeStatus } from './weeklyPlanningIntakeTypes';
import { uniqueList } from './weeklyPlanningTextParsing';

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

function applyPriorityMissingState(state: PlanningIntakeState): PlanningIntakeState {
  if (
    state.examPrepScope &&
    state.unitRates.length > 0 &&
    state.priorityPolicy.kind === 'unknown' &&
    !state.missing.includes('year_range') &&
    !state.missing.includes('completion_direction')
  ) {
    return {
      ...state,
      missing: addMissing(state.missing, [
        'priority_policy',
        'next_field_after_math',
      ]),
    };
  }

  return state;
}

function resolveQuestions(state: PlanningIntakeState): string[] {
  const questions: string[] = [];

  if (state.missing.includes('planning_start_date')) {
    const scopeLabel = state.pendingPlanningRange?.scope.label ?? 'その期間';
    questions.push(scopeLabel + 'のどの日から計画を始めますか？');
  }

  if (state.missing.includes('tasks_or_goals')) {
    questions.push('計画したい学習内容や目標を教えてください。');
  }

  if (state.missing.includes('year_range')) {
    questions.push('7年分は何年から何年までですか？');
  }

  if (state.missing.includes('completion_direction')) {
    questions.push('2021まで完了は、新しい年度から2021までですか？古い年度から2021までですか？');
  }

  if (state.missing.includes('unit_duration_estimate')) {
    questions.push('1つの年度×分野にだいたい何分かかりますか？');
  }

  if (state.missing.includes('priority_policy')) {
    questions.push('週末で優先する分野や進める順番を教えてください。');
  }

  return questions;
}

function resolveStatus(state: PlanningIntakeState): PlanningIntakeStatus {
  if (state.missing.includes('planning_start_date')) {
    return 'needs_scope';
  }

  if (state.missing.includes('tasks_or_goals')) {
    return 'needs_scope';
  }

  if (state.missing.includes('completion_direction')) {
    return 'needs_progress_clarification';
  }

  if (state.missing.includes('year_range')) {
    return 'needs_year_range';
  }

  if (state.missing.includes('unit_duration_estimate')) {
    return 'needs_unit_rate';
  }

  if (state.missing.includes('priority_policy') || state.missing.includes('next_field_after_math')) {
    return 'needs_priority_policy';
  }

  if (
    state.missing.includes('life_constraints') ||
    state.missing.includes('fixed_events') ||
    state.missing.includes('sleep_cycle') ||
    state.missing.includes('meal_bath_constraints')
  ) {
    return 'needs_life_constraints';
  }

  return state.tasks.length > 0 || state.examPrepScope ? 'draft_ready' : 'idle';
}

export function finalizeState(state: PlanningIntakeState): PlanningIntakeState {
  const stateWithPriorityMissing = applyPriorityMissingState(state);
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
