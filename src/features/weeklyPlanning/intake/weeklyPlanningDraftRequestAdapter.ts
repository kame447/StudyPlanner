import type {
  ExamPrepScope,
  LifeConstraint,
  PlanningIntakeState,
  PriorityPolicy,
  StudyProgress,
  UnitRateEstimate,
} from './weeklyPlanningIntakeTypes';

export interface WeeklyPlanningDraftRequest {
  examPrepScope: ExamPrepScope & {
    yearRange: NonNullable<ExamPrepScope['yearRange']>;
  };
  progress: Array<StudyProgress & { completedYears: number[] }>;
  unitRate: UnitRateEstimate & { minutesPerUnit: number };
  priorityPolicy: Extract<PriorityPolicy, { kind: 'field_first' }>;
  constraints: LifeConstraint[];
  fixedEvents: LifeConstraint[];
  shouldCreateDraft: true;
  shouldSavePlan: false;
  sourceTurns: string[];
}

function hasYearRange(
  examPrepScope: ExamPrepScope | undefined,
): examPrepScope is ExamPrepScope & {
  yearRange: NonNullable<ExamPrepScope['yearRange']>;
} {
  return Boolean(examPrepScope?.yearRange);
}

function hasCompletedYears(
  progress: StudyProgress,
): progress is StudyProgress & { completedYears: number[] } {
  return Boolean(progress.completedYears && progress.completedYears.length > 0);
}

function hasMinutesPerUnit(
  unitRate: UnitRateEstimate,
): unitRate is UnitRateEstimate & { minutesPerUnit: number } {
  return typeof unitRate.minutesPerUnit === 'number';
}

function isFieldFirstPriority(
  priorityPolicy: PriorityPolicy,
): priorityPolicy is Extract<PriorityPolicy, { kind: 'field_first' }> {
  return priorityPolicy.kind === 'field_first' && priorityPolicy.order.length > 0;
}

function isYearFieldUnitRate(
  unitRate: UnitRateEstimate,
): unitRate is UnitRateEstimate & { minutesPerUnit: number } {
  return unitRate.unit === 'year_field_chunk' && hasMinutesPerUnit(unitRate);
}

function isFixedEvent(constraint: LifeConstraint): boolean {
  return constraint.kind === 'fixed_event' || constraint.kind === 'unavailable';
}

export function createWeeklyDraftRequestFromIntakeState(
  state: PlanningIntakeState,
): WeeklyPlanningDraftRequest | null {
  if (
    state.status !== 'draft_ready' ||
    !state.shouldCreateDraft ||
    state.shouldSavePlan ||
    state.missing.length > 0 ||
    !hasYearRange(state.examPrepScope) ||
    !isFieldFirstPriority(state.priorityPolicy)
  ) {
    return null;
  }

  const progress = state.progress.filter(hasCompletedYears);
  const unitRate = state.unitRates.find(isYearFieldUnitRate);

  if (progress.length === 0 || !unitRate) {
    return null;
  }

  const fixedEvents = state.constraints.filter(isFixedEvent);
  const constraints = state.constraints.filter((constraint) => !isFixedEvent(constraint));

  return {
    examPrepScope: state.examPrepScope,
    progress,
    unitRate,
    priorityPolicy: state.priorityPolicy,
    constraints,
    fixedEvents,
    shouldCreateDraft: true,
    shouldSavePlan: false,
    sourceTurns: [...state.sourceTurns],
  };
}