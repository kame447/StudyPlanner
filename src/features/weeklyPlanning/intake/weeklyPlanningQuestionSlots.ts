import type {
  PlanningIntakeMissing,
  PlanningIntakeState,
  PlanningIntakeStatus,
} from './weeklyPlanningIntakeTypes';

export type PlanningQuestionSlotKind =
  | 'missing_slot'
  | 'missing_life_constraint';

export type PlanningQuestionSlotPreviewPolicy =
  | 'blocking'
  | 'assumable'
  | 'deferrable';

interface FallbackQuestionContext {
  planningPeriodLabel?: string;
  options?: string[];
  knownFixedEventSummaries?: string[];
}

export interface PlanningQuestionSlotDefinition {
  missing: readonly PlanningIntakeMissing[];
  targetSlot: string;
  intent: string;
  dependsOn?: readonly PlanningIntakeMissing[];
  kind: PlanningQuestionSlotKind;
  previewPolicy: PlanningQuestionSlotPreviewPolicy;
  /** previewと同時に尋ねる候補の優先順位。未指定なら添付しない。 */
  previewQuestionPriority?: number;
  status: PlanningIntakeStatus | undefined;
  deterministicQuestion: (state: PlanningIntakeState) => string | undefined;
  isStateQuestionEligible: (state: PlanningIntakeState) => boolean;
  isQuestionPlanEligible: (
    state: PlanningIntakeState,
    missing: ReadonlySet<PlanningIntakeMissing>,
  ) => boolean;
  targetFields?: (state: PlanningIntakeState) => string[] | undefined;
  termExplanation: string;
  clarificationKeywords: readonly RegExp[];
  vocabularyHint: string;
  fallbackQuestion: (context: FallbackQuestionContext) => string;
  userLabel: string;
}

const isMissing = (
  state: PlanningIntakeState,
  missing: PlanningIntakeMissing,
): boolean => state.missing.includes(missing);

const defaultQuestionPlanEligibility = (): boolean => true;

const resolveMissingCompletionTargetFields = (
  state: PlanningIntakeState,
): string[] | undefined => {
  const fields = state.examPrepScope?.fields ?? [];
  const hasCompletionTarget = state.progress.some(
    (progress) => progress.completionTarget,
  );

  if (!hasCompletionTarget || fields.length === 0) {
    return undefined;
  }

  const targetedFields = new Set(
    state.progress
      .filter((progress) => progress.field && progress.completionTarget)
      .map((progress) => progress.field as string),
  );

  const remainingFields = fields.filter((field) => !targetedFields.has(field));
  return remainingFields.length > 0 ? remainingFields : undefined;
};

const planningPeriodSlot: PlanningQuestionSlotDefinition = {
  missing: ['planning_period'],
  targetSlot: 'planning_period',
  intent: 'ask_planning_period',
  kind: 'missing_slot',
  previewPolicy: 'assumable',
  status: 'needs_scope',
  deterministicQuestion: () => 'いつからいつまでの計画にしますか？',
  isStateQuestionEligible: (state) => isMissing(state, 'planning_period'),
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  termExplanation:
    '「計画の期間」は、いつからいつまでの予定を作るかのことです。',
  clarificationKeywords: [/期間|いつから|いつまで/],
  vocabularyHint: '計画を作る期間(開始日と終了日)',
  fallbackQuestion: () => 'いつからいつまでの計画にしますか？',
  userLabel: '計画の期間',
};

const planningStartDateSlot: PlanningQuestionSlotDefinition = {
  missing: ['planning_start_date'],
  targetSlot: 'planning_start_date',
  intent: 'ask_planning_start_date',
  kind: 'missing_slot',
  previewPolicy: 'assumable',
  previewQuestionPriority: 2,
  status: 'needs_scope',
  deterministicQuestion: (state) => {
    const scopeLabel = state.pendingPlanningRange?.scope.label ?? 'その期間';
    return `${scopeLabel}のどの日から計画を始めますか？`;
  },
  isStateQuestionEligible: (state) => isMissing(state, 'planning_start_date'),
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  termExplanation:
    '計画を始める日です。質問中の期間内で、開始したい曜日や日付を教えてください。',
  clarificationKeywords: [],
  vocabularyHint: '計画を始める日(質問中の期間内の曜日や日付)',
  fallbackQuestion: ({ planningPeriodLabel }) =>
    planningPeriodLabel
      ? `${planningPeriodLabel}のどの日から計画を始めますか？`
      : 'どの日から計画を始めますか？',
  userLabel: '計画の開始日',
};

const planningDurationSlot: PlanningQuestionSlotDefinition = {
  missing: ['planning_duration'],
  targetSlot: 'planning_duration',
  intent: 'ask_planning_duration',
  kind: 'missing_slot',
  previewPolicy: 'assumable',
  previewQuestionPriority: 2,
  status: 'needs_scope',
  deterministicQuestion: (state) => {
    const scopeLabel = state.pendingPlanningRange?.scope.label ?? 'その期間';
    return `${scopeLabel}の計画は、開始日から何日間にしますか？`;
  },
  isStateQuestionEligible: (state) => isMissing(state, 'planning_duration'),
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  dependsOn: ['planning_start_date'],
  termExplanation:
    '計画を続ける日数です。開始日を1日目として、何日間の計画にするか教えてください。',
  clarificationKeywords: [/何日間|期間の長さ|日数/],
  vocabularyHint: '計画の日数',
  fallbackQuestion: ({ planningPeriodLabel }) =>
    `${planningPeriodLabel ?? 'その期間'}の計画は何日間にしますか？`,
  userLabel: '計画の日数',
};

const tasksOrGoalsSlot: PlanningQuestionSlotDefinition = {
  missing: ['tasks_or_goals'],
  targetSlot: 'tasks_or_goals',
  intent: 'ask_tasks_or_goals',
  kind: 'missing_slot',
  previewPolicy: 'blocking',
  status: 'needs_scope',
  deterministicQuestion: () => '計画したい学習内容や目標を教えてください。',
  isStateQuestionEligible: (state) => isMissing(state, 'tasks_or_goals'),
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  termExplanation:
    '「学習内容や目標」は、この期間に取り組みたい教材やゴールのことです。',
  clarificationKeywords: [],
  vocabularyHint: '取り組みたい学習内容や目標',
  fallbackQuestion: () => '計画したい学習内容や目標を教えてください。',
  userLabel: '学習内容や目標',
};

const yearRangeSlot: PlanningQuestionSlotDefinition = {
  missing: ['year_range'],
  targetSlot: 'year_range',
  intent: 'ask_year_range',
  kind: 'missing_slot',
  previewPolicy: 'assumable',
  status: 'needs_year_range',
  deterministicQuestion: () => '7年分は何年から何年までですか？',
  isStateQuestionEligible: (state) => isMissing(state, 'year_range'),
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  dependsOn: ['tasks_or_goals'],
  termExplanation:
    '「対象年度」は、過去問などで何年から何年までを対象にするかのことです。',
  clarificationKeywords: [/年度/],
  vocabularyHint: '対象の年度範囲',
  fallbackQuestion: () => '対象年度は何年から何年までですか？',
  userLabel: '対象年度',
};

const completionDirectionSlot: PlanningQuestionSlotDefinition = {
  missing: ['completion_direction'],
  targetSlot: 'completion_direction',
  intent: 'ask_progress_clarification',
  kind: 'missing_slot',
  previewPolicy: 'deferrable',
  status: 'needs_progress_clarification',
  deterministicQuestion: () =>
    '2021まで完了は、新しい年度から2021までですか？古い年度から2021までですか？',
  isStateQuestionEligible: (state) => isMissing(state, 'completion_direction'),
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  dependsOn: ['tasks_or_goals', 'year_range'],
  termExplanation:
    '「完了済みの向き」は、終わった年度が新しい側からか古い側からかのことです。',
  clarificationKeywords: [],
  vocabularyHint: '完了済みの年度が新しい側からか古い側からか',
  fallbackQuestion: () =>
    '完了済み年度の範囲を確認したいです。新しい年度側からか、古い年度側からか教えてください。',
  userLabel: '完了済み年度の範囲',
};

const progressSlot: PlanningQuestionSlotDefinition = {
  missing: ['progress'],
  targetSlot: 'progress',
  intent: 'ask_progress_clarification',
  kind: 'missing_slot',
  previewPolicy: 'deferrable',
  status: undefined,
  deterministicQuestion: () => undefined,
  isStateQuestionEligible: () => false,
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  dependsOn: ['tasks_or_goals', 'year_range'],
  targetFields: resolveMissingCompletionTargetFields,
  termExplanation: '「進捗」は、今どこまで終わっているかのことです。',
  clarificationKeywords: [/進捗|進み/],
  vocabularyHint: '今どこまで進んでいるか',
  fallbackQuestion: ({ options }) =>
    options && options.length > 0
      ? `${options.join('、')}はどこまで進めたいですか？`
      : '現在の進捗を教えてください。',
  userLabel: '現在の進捗',
};

const unitDurationEstimateSlot: PlanningQuestionSlotDefinition = {
  missing: ['unit_duration_estimate'],
  targetSlot: 'unit_rate',
  intent: 'ask_unit_rate',
  kind: 'missing_slot',
  previewPolicy: 'assumable',
  previewQuestionPriority: 1,
  status: 'needs_unit_rate',
  deterministicQuestion: () =>
    '1つの年度×分野にだいたい何分かかりますか？',
  isStateQuestionEligible: (state) =>
    isMissing(state, 'unit_duration_estimate'),
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  dependsOn: ['tasks_or_goals', 'year_range', 'completion_direction'],
  termExplanation:
    '「目安時間」は、1年分(1単位)にだいたい何分かかるかのことです。',
  clarificationKeywords: [/目安|単位/],
  vocabularyHint: '1年分(1単位)あたりの目安時間',
  fallbackQuestion: () =>
    '1年分または1単位あたりの目安時間を教えてください。',
  userLabel: '1年分または1単位あたりの目安時間',
};

const priorityPolicySlot: PlanningQuestionSlotDefinition = {
  missing: ['priority_policy', 'next_field_after_math'],
  targetSlot: 'priority_policy',
  intent: 'ask_priority_policy',
  kind: 'missing_slot',
  previewPolicy: 'assumable',
  status: 'needs_priority_policy',
  deterministicQuestion: () =>
    '週末で優先する分野や進める順番を教えてください。',
  isStateQuestionEligible: (state) => isMissing(state, 'priority_policy'),
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  dependsOn: [
    'tasks_or_goals',
    'year_range',
    'completion_direction',
    'unit_duration_estimate',
  ],
  termExplanation:
    '「優先順」は、どの分野からどの順番で進めるかのことです。',
  clarificationKeywords: [/優先/],
  vocabularyHint: '優先する分野や進める順番',
  fallbackQuestion: () =>
    '週末で優先する分野や進める順番を教えてください。',
  userLabel: '分野や年度の優先順',
};

const fixedEventsSlot: PlanningQuestionSlotDefinition = {
  missing: ['fixed_events'],
  targetSlot: 'fixed_events',
  intent: 'ask_fixed_events',
  kind: 'missing_life_constraint',
  previewPolicy: 'assumable',
  status: 'needs_life_constraints',
  deterministicQuestion: () => undefined,
  isStateQuestionEligible: () => false,
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  termExplanation:
    '「固定の予定」は、時間が決まっていて動かせない予定のことです。',
  clarificationKeywords: [/固定|動かせない/],
  vocabularyHint: '時間が決まっていて動かせない予定',
  fallbackQuestion: ({ knownFixedEventSummaries }) =>
    knownFixedEventSummaries && knownFixedEventSummaries.length > 0
      ? `登録済みの予定は、${knownFixedEventSummaries.join('、')}です。これ以外に、時間が決まっていて動かせない予定はありますか？`
      : 'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？',
  userLabel: '時間が決まっていて動かせない予定',
};

const sleepCycleSlot: PlanningQuestionSlotDefinition = {
  missing: ['sleep_cycle'],
  targetSlot: 'sleep_cycle',
  intent: 'ask_life_constraints',
  kind: 'missing_life_constraint',
  previewPolicy: 'assumable',
  status: 'needs_life_constraints',
  deterministicQuestion: () => undefined,
  isStateQuestionEligible: () => false,
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  termExplanation:
    '「睡眠のリズム」は、就寝・起床の時刻や、何時から勉強を始められるかのことです。',
  clarificationKeywords: [/睡眠|寝|起き/],
  vocabularyHint: '睡眠時間や、何時から勉強を始められるか',
  fallbackQuestion: () =>
    '睡眠時間や、何時から勉強を始められるかを教えてください。',
  userLabel: '睡眠時間',
};

const mealBathConstraintsSlot: PlanningQuestionSlotDefinition = {
  missing: ['meal_bath_constraints'],
  targetSlot: 'meal_bath_constraints',
  intent: 'ask_life_constraints',
  kind: 'missing_life_constraint',
  previewPolicy: 'assumable',
  status: 'needs_life_constraints',
  deterministicQuestion: () => undefined,
  isStateQuestionEligible: () => false,
  isQuestionPlanEligible: defaultQuestionPlanEligibility,
  termExplanation:
    '「生活の制約」は、食事やお風呂など、勉強を入れにくい時間のことです。',
  clarificationKeywords: [/食事|風呂/],
  vocabularyHint: '食事やお風呂など勉強を入れにくい時間',
  fallbackQuestion: () =>
    '食事やお風呂など、勉強を入れにくい時間を教えてください。',
  userLabel: '食事・風呂などの生活制約',
};

const lifeConstraintsSlot: PlanningQuestionSlotDefinition = {
  missing: ['life_constraints'],
  targetSlot: 'life_constraints',
  intent: 'ask_life_constraints',
  kind: 'missing_life_constraint',
  previewPolicy: 'assumable',
  status: 'needs_life_constraints',
  deterministicQuestion: () => undefined,
  isStateQuestionEligible: () => false,
  isQuestionPlanEligible: (_state, missing) =>
    !missing.has('sleep_cycle') && !missing.has('meal_bath_constraints'),
  termExplanation:
    '「生活の制約」は、食事・お風呂・睡眠などの生活リズムのことです。',
  clarificationKeywords: [],
  vocabularyHint: '食事・お風呂・睡眠などの生活リズム',
  fallbackQuestion: () =>
    '食事・お風呂・睡眠など、生活上の制約を教えてください。',
  userLabel: '食事・風呂・睡眠などの生活制約',
};

export const QUESTION_SLOT_DEFINITION_BY_MISSING: Record<
  PlanningIntakeMissing,
  PlanningQuestionSlotDefinition
> = {
  planning_period: planningPeriodSlot,
  planning_start_date: planningStartDateSlot,
  planning_duration: planningDurationSlot,
  tasks_or_goals: tasksOrGoalsSlot,
  fixed_events: fixedEventsSlot,
  sleep_cycle: sleepCycleSlot,
  meal_bath_constraints: mealBathConstraintsSlot,
  year_range: yearRangeSlot,
  progress: progressSlot,
  completion_direction: completionDirectionSlot,
  unit_duration_estimate: unitDurationEstimateSlot,
  priority_policy: priorityPolicySlot,
  next_field_after_math: priorityPolicySlot,
  life_constraints: lifeConstraintsSlot,
};

const QUESTION_SLOT_DEFINITIONS: readonly PlanningQuestionSlotDefinition[] = [
  planningPeriodSlot,
  planningStartDateSlot,
  planningDurationSlot,
  tasksOrGoalsSlot,
  yearRangeSlot,
  completionDirectionSlot,
  progressSlot,
  unitDurationEstimateSlot,
  priorityPolicySlot,
  fixedEventsSlot,
  sleepCycleSlot,
  mealBathConstraintsSlot,
  lifeConstraintsSlot,
];

export const STATUS_SLOT_ORDER: readonly PlanningQuestionSlotDefinition[] = [
  planningPeriodSlot,
  planningStartDateSlot,
  planningDurationSlot,
  tasksOrGoalsSlot,
  completionDirectionSlot,
  yearRangeSlot,
  unitDurationEstimateSlot,
  priorityPolicySlot,
  lifeConstraintsSlot,
  fixedEventsSlot,
  sleepCycleSlot,
  mealBathConstraintsSlot,
];

export const QUESTION_PLAN_SLOT_ORDER = QUESTION_SLOT_DEFINITIONS;

const STATE_QUESTION_SLOT_ORDER: readonly PlanningQuestionSlotDefinition[] = [
  planningPeriodSlot,
  planningStartDateSlot,
  planningDurationSlot,
  tasksOrGoalsSlot,
  yearRangeSlot,
  completionDirectionSlot,
  unitDurationEstimateSlot,
  priorityPolicySlot,
];

const MESSAGE_KEY_SLOT_ORDER: readonly PlanningQuestionSlotDefinition[] = [
  planningPeriodSlot,
  planningStartDateSlot,
  planningDurationSlot,
  yearRangeSlot,
  unitDurationEstimateSlot,
  priorityPolicySlot,
  lifeConstraintsSlot,
  sleepCycleSlot,
  mealBathConstraintsSlot,
  fixedEventsSlot,
  tasksOrGoalsSlot,
  completionDirectionSlot,
  progressSlot,
];

const CLARIFICATION_KEYWORD_SLOT_ORDER: readonly PlanningQuestionSlotDefinition[] = [
  fixedEventsSlot,
  sleepCycleSlot,
  mealBathConstraintsSlot,
  yearRangeSlot,
  progressSlot,
  priorityPolicySlot,
  unitDurationEstimateSlot,
];

export function targetSlotForMissing(missing: PlanningIntakeMissing): string {
  return QUESTION_SLOT_DEFINITION_BY_MISSING[missing].targetSlot;
}

export function statusForMissing(
  missing: readonly PlanningIntakeMissing[],
): PlanningIntakeStatus | undefined {
  for (const definition of STATUS_SLOT_ORDER) {
    if (
      definition.status &&
      definition.missing.some((key) => missing.includes(key))
    ) {
      return definition.status;
    }
  }

  return undefined;
}

export function deterministicQuestionsForState(
  state: PlanningIntakeState,
): string[] {
  const missing = new Set(state.missing);
  return STATE_QUESTION_SLOT_ORDER.flatMap((definition) =>
    definition.isStateQuestionEligible(state)
      && !(definition.dependsOn ?? []).some((dependency) =>
        missing.has(dependency),
      )
      ? [definition.deterministicQuestion(state)].filter(
          (question): question is string => Boolean(question),
        )
      : [],
  );
}

export function messageKeyForMissing(
  missing: readonly PlanningIntakeMissing[],
): string {
  for (const definition of MESSAGE_KEY_SLOT_ORDER) {
    if (definition.missing.some((key) => missing.includes(key))) {
      return definition.intent;
    }
  }

  return 'ask_missing_info';
}

export function questionSlotDefinitionForTargetSlot(
  targetSlot: string,
): PlanningQuestionSlotDefinition | undefined {
  return QUESTION_SLOT_DEFINITIONS.find(
    (definition) => definition.targetSlot === targetSlot,
  );
}

export function vocabularyHintForSlot(slotKey: string): string | undefined {
  return questionSlotDefinitionForTargetSlot(slotKey)?.vocabularyHint;
}

export function fallbackQuestionForSlot(
  slotKey: string,
  context: FallbackQuestionContext,
): string | undefined {
  return questionSlotDefinitionForTargetSlot(slotKey)?.fallbackQuestion(context);
}

export function userLabelForSlot(slotKey: string): string | undefined {
  return questionSlotDefinitionForTargetSlot(slotKey)?.userLabel;
}

export function termExplanationForSlot(slotKey: string): string | undefined {
  return questionSlotDefinitionForTargetSlot(slotKey)?.termExplanation;
}

export function clarificationKeywordTarget(
  clarificationRef: string,
): string | undefined {
  for (const definition of CLARIFICATION_KEYWORD_SLOT_ORDER) {
    if (
      definition.clarificationKeywords.some((keyword) =>
        keyword.test(clarificationRef),
      )
    ) {
      return definition.targetSlot;
    }
  }

  return undefined;
}
