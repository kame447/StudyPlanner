import type {
  ExamPrepScope,
  LifeConstraint,
  PlanningAssumption,
  PlanningIntakeMissing,
  PlanningIntakeState,
  PriorityPolicy,
  StudyProgress,
  UnitRateEstimate,
} from './weeklyPlanningIntakeTypes';
import { QUESTION_SLOT_DEFINITION_BY_MISSING } from './weeklyPlanningQuestionSlots';

export interface WeeklyPlanningDraftRequest {
  examPrepScope: ExamPrepScope & {
    yearRange: NonNullable<ExamPrepScope['yearRange']>;
  };
  progress: StudyProgress[];
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

function hasProgressForDraft(progress: StudyProgress): boolean {
  return Boolean(
    (progress.completedYears && progress.completedYears.length > 0) ||
    progress.completionTarget,
  );
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

  const progress = state.progress.filter(hasProgressForDraft);
  const unitRate = state.unitRates.find(isYearFieldUnitRate);

  if (!unitRate) {
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

export const DEFAULT_ASSUMED_UNIT_MINUTES = 120;

export interface AssumedWeeklyDraftRequestContext {
  currentDateTime: string;
}

export interface AssumedWeeklyDraftRequest {
  draftRequest: WeeklyPlanningDraftRequest;
  assumptions: PlanningAssumption[];
  /** pending scope の開始日を仮定した場合だけ scheduler 入力へ渡す。 */
  planningStartDate?: string;
}

function currentYearFromContext(context: AssumedWeeklyDraftRequestContext): number | null {
  const currentYear = Number(context.currentDateTime.slice(0, 4));
  return Number.isInteger(currentYear) && currentYear > 0 ? currentYear : null;
}

function hasMissingSlot(
  state: PlanningIntakeState,
  missing: PlanningIntakeMissing,
): boolean {
  return state.missing.includes(missing);
}

function hasBlockingPreviewSlot(state: PlanningIntakeState): boolean {
  return state.missing.some(
    (missing) =>
      QUESTION_SLOT_DEFINITION_BY_MISSING[missing].previewPolicy === 'blocking',
  );
}

function addAssumption(
  assumptions: PlanningAssumption[],
  slot: PlanningIntakeMissing,
  source: PlanningAssumption['source'],
  description: string,
): void {
  assumptions.push({ slot, source, description });
}

function isUsableTotalYears(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function hasPendingScopeStartDate(state: PlanningIntakeState): boolean {
  return state.pendingPlanningRange?.scope.kind === 'next_week'
    && Boolean(state.pendingPlanningRange.scope.startDate);
}

/**
 * Creates a dry-run-only exam-prep request without changing confirmed intake state.
 * The confirmed adapter remains the authoritative path whenever it can build a request.
 */
export function createAssumedWeeklyDraftRequest(
  state: PlanningIntakeState,
  context: AssumedWeeklyDraftRequestContext,
): AssumedWeeklyDraftRequest | null {
  const confirmedDraftRequest = createWeeklyDraftRequestFromIntakeState(state);

  if (confirmedDraftRequest) {
    return { draftRequest: confirmedDraftRequest, assumptions: [] };
  }

  if (hasBlockingPreviewSlot(state) || !state.examPrepScope || state.examPrepScope.fields.length === 0) {
    return null;
  }

  const assumptions: PlanningAssumption[] = [];
  let planningStartDate: string | undefined;

  if (hasMissingSlot(state, 'planning_period') && !state.range && !state.pendingPlanningRange) {
    addAssumption(
      assumptions,
      'planning_period',
      'default',
      '期間の指定がないため、既定の期間(選択中の開始日から7日間)で仮の計画を作ります。',
    );
  }

  if (hasMissingSlot(state, 'planning_start_date')) {
    if (!hasPendingScopeStartDate(state)) {
      return null;
    }

    planningStartDate = state.pendingPlanningRange?.scope.startDate;
    addAssumption(
      assumptions,
      'planning_start_date',
      'derived',
      `${state.pendingPlanningRange?.scope.label}の開始日を仮の計画開始日にします。`,
    );
  }

  let yearRange = state.examPrepScope.yearRange;
  if (hasMissingSlot(state, 'year_range')) {
    const currentYear = currentYearFromContext(context);
    if (!isUsableTotalYears(state.examPrepScope.totalYears) || !currentYear) {
      return null;
    }

    yearRange = {
      startYear: currentYear - (state.examPrepScope.totalYears - 1),
      endYear: currentYear,
      sourceText: `${state.examPrepScope.totalYears}年分の仮定`,
    };
    addAssumption(
      assumptions,
      'year_range',
      'derived',
      `対象年度は${yearRange.startYear}年から${yearRange.endYear}年までの${state.examPrepScope.totalYears}年分として扱います。`,
    );
  } else if (!yearRange) {
    return null;
  }

  let unitRate = state.unitRates.find(isYearFieldUnitRate);
  if (hasMissingSlot(state, 'unit_duration_estimate')) {
    if (!unitRate) {
      unitRate = {
        unit: 'year_field_chunk',
        minutesPerUnit: DEFAULT_ASSUMED_UNIT_MINUTES,
        source: 'default',
        uncertainty: 'high',
        rawText: 'preview default',
      };
    }
    addAssumption(
      assumptions,
      'unit_duration_estimate',
      'default',
      `1年分・1分野あたり${DEFAULT_ASSUMED_UNIT_MINUTES}分として仮置きします。`,
    );
  } else if (!unitRate) {
    return null;
  }

  let priorityPolicy = state.priorityPolicy;
  if (hasMissingSlot(state, 'priority_policy') || hasMissingSlot(state, 'next_field_after_math')) {
    const existingOrder = priorityPolicy.kind === 'field_first'
      ? priorityPolicy.order
      : [];
    priorityPolicy = {
      kind: 'field_first',
      order: Array.from(new Set([
        ...existingOrder,
        ...state.examPrepScope.fields,
      ])),
    };
    addAssumption(
      assumptions,
      hasMissingSlot(state, 'priority_policy') ? 'priority_policy' : 'next_field_after_math',
      'derived',
      '分野の宣言順を仮の優先順として扱います。',
    );
  }

  if (!isFieldFirstPriority(priorityPolicy) || !unitRate) {
    return null;
  }

  if (hasMissingSlot(state, 'progress')) {
    addAssumption(
      assumptions,
      'progress',
      'default',
      '進捗は未完了として仮置きします。',
    );
  }
  if (hasMissingSlot(state, 'completion_direction')) {
    addAssumption(
      assumptions,
      'completion_direction',
      'default',
      '完了済み年度はないものとして仮置きします。',
    );
  }
  if (hasMissingSlot(state, 'fixed_events')) {
    addAssumption(
      assumptions,
      'fixed_events',
      'default',
      '追加の固定予定はないものとし、時間割・既存予定は既存の回避処理を利用します。',
    );
  }
  if (hasMissingSlot(state, 'sleep_cycle')) {
    addAssumption(
      assumptions,
      'sleep_cycle',
      'default',
      '睡眠の制約は既定のsession policy枠に委ねます。',
    );
  }
  if (hasMissingSlot(state, 'meal_bath_constraints')) {
    addAssumption(
      assumptions,
      'meal_bath_constraints',
      'default',
      '食事・入浴の制約は既定のsession policy枠に委ねます。',
    );
  }
  if (hasMissingSlot(state, 'life_constraints')) {
    addAssumption(
      assumptions,
      'life_constraints',
      'default',
      '生活制約は既定のsession policy枠に委ねます。',
    );
  }

  const fixedEvents = state.constraints.filter(isFixedEvent);
  const constraints = state.constraints.filter((constraint) => !isFixedEvent(constraint));

  return {
    draftRequest: {
      examPrepScope: {
        ...state.examPrepScope,
        yearRange,
      },
      progress: state.progress.filter(hasProgressForDraft),
      unitRate,
      priorityPolicy,
      constraints,
      fixedEvents,
      shouldCreateDraft: true,
      shouldSavePlan: false,
      sourceTurns: [...state.sourceTurns],
    },
    assumptions,
    planningStartDate,
  };
}
