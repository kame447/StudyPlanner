import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import {
  SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
  WP_RP_001_WEEKEND_EXAM_TURNS,
} from '../testFixtures/weeklyPlanningRoleplayCases';

export const context = {
  selectedDate: SELECTED_DATE_FOR_WEEKEND_ROLEPLAY,
};

export function applyWeekendRangeAndExamScope() {
  const afterRange = applyWeeklyPlanningUserTurn(
    createInitialPlanningIntakeState(),
    WP_RP_001_WEEKEND_EXAM_TURNS.rangeOnly,
    context,
  );

  return applyWeeklyPlanningUserTurn(
    afterRange,
    WP_RP_001_WEEKEND_EXAM_TURNS.examScope,
    context,
  );
}

export function applyCompletionTextAfterKnownYearRange(completionText: string) {
  return applyWeeklyPlanningUserTurn(
    applyWeekendRangeAndExamScope(),
    '7年分は2019〜2025\n' + completionText,
    context,
  );
}

export function applyDetailsTextAfterExamScope(detailsText: string) {
  return applyWeeklyPlanningUserTurn(
    applyWeekendRangeAndExamScope(),
    detailsText,
    context,
  );
}

export function applyWeekendExamReadyForLifeConstraints() {
  const afterDetails = applyWeeklyPlanningUserTurn(
    applyWeekendRangeAndExamScope(),
    WP_RP_001_WEEKEND_EXAM_TURNS.yearRangeProgressAndUnitRate,
    context,
  );

  return applyWeeklyPlanningUserTurn(
    afterDetails,
    WP_RP_001_WEEKEND_EXAM_TURNS.priorityPolicy,
    context,
  );
}

export function applyWeekendExamReadyForDraftRequest() {
  const afterLifeConstraints = applyWeeklyPlanningUserTurn(
    applyWeekendExamReadyForLifeConstraints(),
    WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
    context,
  );

  return applyWeeklyPlanningUserTurn(
    afterLifeConstraints,
    WP_RP_001_WEEKEND_EXAM_TURNS.noFixedEvents,
    context,
  );
}