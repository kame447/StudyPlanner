import {
  fallbackQuestionForSlot,
  vocabularyHintForSlot,
} from '../intake/weeklyPlanningQuestionSlots';
import type { Plan } from '../../../types/domain';
import type { ConstraintSourceRef, PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { createKnownFixedEventSummaries } from './weeklyPlanningKnownFixedEvents';
import { recordWeeklyPlanningRenderedAssistantTurn } from '../trace/weeklyPlanningTraceRuntime';
import type { WeeklyPlanningTraceResponseSource } from '../trace/weeklyPlanningTraceTypes';
import type { WeeklyPlanningDialogueDecision } from './weeklyPlanningDialogueManager';
import { createWeeklyPlanningDialogueMessage } from './weeklyPlanningDialogueMessages';
import {
  composeUniqueDialogueMessage,
  stripGenericAcknowledgementPrefix,
} from './weeklyPlanningDialogueText';

export interface DialogueNextQuestion {
  slotKey: string;
  intent: string;
  questionKind?: string;
  options?: string[];
  /** slot の内部キーをそのまま訳させないための、ユーザー語彙での平易な言い換えヒント。 */
  vocabularyHint?: string;
}

export interface DialogueRenderInput {
  /**
   * 計画対象期間のラベル(「来週」「今週」「週末」等)。
   * ユーザー発話由来のときだけ設定する。不明なときは undefined のままにし、AI に週を捏造させない。
   */
  planningPeriodLabel?: string;
  /** 目安時間の基準単位。過去問なら「1年分・1分野あたり」。 */
  unitRateBasisLabel?: string;
  /** 既に計画制約として利用中の schedule source の平易ラベル(「時間割」「登録済みの予定」等)。 */
  constraintSourcesInUse?: string[];
  knownFixedEventSummaries?: string[];
  acceptedFacts: {
    fields?: string[];
    totalFields?: number;
    goals?: string[];
    yearRange?: { startYear: number; endYear: number };
    unitRateMinutes?: number;
    unitRateDisplay?: string;
    priorityOrder?: string[];
    constraintSummary?: string[];
  };
  assumptions: string[];
  nextQuestions: DialogueNextQuestion[];
  styleConstraints: { tone: 'mentor'; maxQuestions: number };
}

const CONSTRAINT_SOURCE_LABELS: Record<ConstraintSourceRef['kind'], string> = {
  timetable: '時間割',
  existing_plans: '登録済みの予定',
  calendar: 'カレンダーの予定',
};

/**
 * 計画期間ラベルはユーザー発話(range.sourceText)に含まれる語からのみ導く。
 * 日付だけから「今週/来週」を推測して補完しない(実例1「来週」→「今週」の回帰防止)。
 */
function sameSemanticValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function planningRangeSemanticValue(state: PlanningIntakeState): unknown {
  return {
    range: state.range
      ? {
          startDateTime: state.range.startDateTime,
          endDateTime: state.range.endDateTime,
          calendarDayCount: state.range.calendarDayCount,
          confidence: state.range.confidence,
        }
      : undefined,
    pending: state.pendingPlanningRange
      ? {
          scope: state.pendingPlanningRange.scope,
          planningStartDate: state.pendingPlanningRange.planningStartDate,
          planningStartDateTime: state.pendingPlanningRange.planningStartDateTime,
          durationDays: state.pendingPlanningRange.durationDays,
          planningEndDateTime: state.pendingPlanningRange.planningEndDateTime,
        }
      : undefined,
  };
}

function planningPeriodLabel(
  state: PlanningIntakeState,
  previousState?: PlanningIntakeState,
): string | undefined {
  if (previousState && sameSemanticValue(
    planningRangeSemanticValue(state),
    planningRangeSemanticValue(previousState),
  )) {
    return undefined;
  }

  const source = state.range?.sourceText;
  if (source) {
    if (/来週/.test(source)) return '来週';
    if (/今週/.test(source)) return '今週';
    if (/週末|土日/.test(source)) return '週末';
    if (/今日/.test(source)) return '今日';
  }

  if (!state.range && state.pendingPlanningRange) {
    return state.pendingPlanningRange.scope.label;
  }

  return undefined;
}

function taskSemanticValue(task: PlanningIntakeState['tasks'][number]): unknown {
  return {
    title: task.title,
    subject: task.subject,
    examType: task.examType,
    field: task.field,
    year: task.year,
    unit: task.unit,
    amount: task.amount,
    requiresTimeEstimate: task.requiresTimeEstimate,
    source: task.source,
  };
}

function unitRateSemanticValue(rate: PlanningIntakeState['unitRates'][number]): unknown {
  return {
    unit: rate.unit,
    minutesPerUnit: rate.minutesPerUnit,
    source: rate.source,
    uncertainty: rate.uncertainty,
  };
}

function constraintSemanticValue(
  constraint: PlanningIntakeState['constraints'][number],
): unknown {
  return {
    kind: constraint.kind,
    date: constraint.date,
    start: constraint.start,
    end: constraint.end,
    durationMinutes: constraint.durationMinutes,
    studyAvailableStart: constraint.studyAvailableStart,
    hardness: constraint.hardness,
  };
}

function isNewSemanticItem<T>(
  item: T,
  previousItems: readonly T[],
  semanticValue: (value: T) => unknown,
): boolean {
  const currentValue = semanticValue(item);
  return !previousItems.some((previous) =>
    sameSemanticValue(currentValue, semanticValue(previous)));
}

function unitRateBasisLabel(state: PlanningIntakeState): string | undefined {
  return state.examPrepScope?.unitModel === 'year_field_chunk'
    ? '1年分・1分野あたり'
    : undefined;
}

function unitRateDisplayLabel(rawText: string | undefined, minutes: number): string {
  const match = rawText?.match(
    /([0-9０-９]+(?:\.[0-9０-９]+)?|[一二三四五六七八九十]+)\s*(時間|分)/,
  );
  return match ? `${match[1]}${match[2]}` : `${minutes}分`;
}

function constraintSourcesInUseLabels(state: PlanningIntakeState): string[] | undefined {
  const sources = state.constraintSourcesInUse;

  if (!sources || sources.length === 0) {
    return undefined;
  }

  return sources.map((source) => CONSTRAINT_SOURCE_LABELS[source.kind]);
}

export interface DialogueRenderOutput {
  acknowledgement?: string;
  questions: Array<{ slotKey: string; text: string }>;
}

export interface WeeklyPlanningDialogueRenderer {
  render(input: DialogueRenderInput): Promise<DialogueRenderOutput>;
}

function nextQuestionsFromDecision(
  decision: WeeklyPlanningDialogueDecision,
  maxQuestions: number,
  unitRateBasis?: string,
): DialogueNextQuestion[] {
  if (decision.questionPlan?.length) {
    return decision.questionPlan
      .slice(0, maxQuestions)
      .map((question) => ({
        slotKey: question.targetSlot,
        intent: question.intent,
        questionKind: question.kind,
        options: question.targetFields,
        vocabularyHint: vocabularyHintForSlot(question.targetSlot, {
          unitRateBasisLabel: unitRateBasis,
        }),
      }));
  }

  return (decision.requiredFields ?? [])
    .slice(0, maxQuestions)
    .map((field) => ({
      slotKey: field,
      intent: decision.messageKey,
      vocabularyHint: vocabularyHintForSlot(field, {
        unitRateBasisLabel: unitRateBasis,
      }),
    }));
}

function priorityPolicyChanged(
  current: PlanningIntakeState['priorityPolicy'],
  previous: PlanningIntakeState['priorityPolicy'] | undefined,
): boolean {
  if (!previous || current.kind !== previous.kind) return true;
  if (current.kind !== 'field_first' || previous.kind !== 'field_first') return false;
  return current.order.length !== previous.order.length
    || current.order.some((field, index) => field !== previous.order[index]);
}

export function createDialogueRenderInput(params: {
  state: PlanningIntakeState;
  previousState?: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
  existingPlans?: Plan[];
}): DialogueRenderInput {
  const previousTasks = params.previousState?.tasks ?? [];
  const previousUnitRates = params.previousState?.unitRates ?? [];
  const previousConstraints = params.previousState?.constraints ?? [];
  const priorityOrder = params.state.priorityPolicy.kind === 'field_first'
    ? params.state.priorityPolicy.order
    : undefined;
  const unitRate = params.state.unitRates.find((rate) =>
    typeof rate.minutesPerUnit === 'number'
    && isNewSemanticItem(rate, previousUnitRates, unitRateSemanticValue),
  );
  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command'
      && isNewSemanticItem(task, previousTasks, taskSemanticValue))
    .map((task) => task.title);
  const currentFields = {
    fields: params.state.examPrepScope?.fields ?? [],
    totalFields: params.state.examPrepScope?.totalFields,
  };
  const previousFields = {
    fields: params.previousState?.examPrepScope?.fields ?? [],
    totalFields: params.previousState?.examPrepScope?.totalFields,
  };
  const examScopeAcceptedThisTurn = !params.previousState
    || !sameSemanticValue(currentFields, previousFields);
  const yearRangeAcceptedThisTurn = !params.previousState
    || !sameSemanticValue(
      params.state.examPrepScope?.yearRange
        ? {
            startYear: params.state.examPrepScope.yearRange.startYear,
            endYear: params.state.examPrepScope.yearRange.endYear,
          }
        : undefined,
      params.previousState.examPrepScope?.yearRange
        ? {
            startYear: params.previousState.examPrepScope.yearRange.startYear,
            endYear: params.previousState.examPrepScope.yearRange.endYear,
          }
        : undefined,
    );
  const constraintSourcesChanged = !params.previousState
    || !sameSemanticValue(
      params.state.constraintSourcesInUse ?? [],
      params.previousState.constraintSourcesInUse ?? [],
    );
  const knownFixedEventSummaries = createKnownFixedEventSummaries(
    params.existingPlans ?? [],
    params.state.range,
  );

  const nextQuestions = nextQuestionsFromDecision(
    params.decision,
    2,
    unitRateBasisLabel(params.state),
  );
  const repeatedTargetSlot = params.previousState?.lastQuestionContext?.targetSlot;
  const shouldRepairRepeatedQuestion = Boolean(
    repeatedTargetSlot && nextQuestions[0]?.slotKey === repeatedTargetSlot,
  );
  const renderedQuestions = shouldRepairRepeatedQuestion
    ? [{ ...nextQuestions[0], questionKind: 'repair' }]
    : nextQuestions;
  const acceptedConstraintSummary = params.state.constraints
    .filter((constraint) =>
      isNewSemanticItem(constraint, previousConstraints, constraintSemanticValue))
    .map((constraint) => [constraint.kind, constraint.date, constraint.start, constraint.end]
      .filter(Boolean)
      .join(' '));

  return {
    planningPeriodLabel: planningPeriodLabel(params.state, params.previousState),
    unitRateBasisLabel: unitRateBasisLabel(params.state),
    constraintSourcesInUse: constraintSourcesChanged
      ? constraintSourcesInUseLabels(params.state)
      : undefined,
    knownFixedEventSummaries: knownFixedEventSummaries.length > 0
      ? knownFixedEventSummaries
      : undefined,
    acceptedFacts: {
      fields: examScopeAcceptedThisTurn ? params.state.examPrepScope?.fields : undefined,
      totalFields: examScopeAcceptedThisTurn ? params.state.examPrepScope?.totalFields : undefined,
      goals: commandGoalTitles.length > 0 ? commandGoalTitles : undefined,
      yearRange: yearRangeAcceptedThisTurn && params.state.examPrepScope?.yearRange
        ? {
            startYear: params.state.examPrepScope.yearRange.startYear,
            endYear: params.state.examPrepScope.yearRange.endYear,
          }
        : undefined,
      unitRateMinutes: unitRate?.minutesPerUnit,
      unitRateDisplay: unitRate && typeof unitRate.minutesPerUnit === 'number'
        ? unitRateDisplayLabel(unitRate.rawText, unitRate.minutesPerUnit)
        : undefined,
      priorityOrder: priorityPolicyChanged(params.state.priorityPolicy, params.previousState?.priorityPolicy)
        ? priorityOrder
        : undefined,
      constraintSummary: acceptedConstraintSummary.length > 0
        ? acceptedConstraintSummary
        : undefined,
    },
    assumptions: [...params.state.assumptions],
    nextQuestions: renderedQuestions,
    styleConstraints: { tone: 'mentor', maxQuestions: shouldRepairRepeatedQuestion ? 1 : 2 },
  };
}

function isDialogueRenderOutput(value: unknown): value is DialogueRenderOutput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const output = value as DialogueRenderOutput;
  return Array.isArray(output.questions) && output.questions.every((question) =>
    typeof question?.slotKey === 'string' && typeof question?.text === 'string',
  );
}


const DIALOGUE_FORBIDDEN_CONTENT = /https?:\/\/|(?:パスワード|暗証番号|秘密情報|APIキー|アクセストークン|設定画面|外部サイト|リンクを開|貼り付けて|送信して|睡眠薬|服用|何錠|診断|病歴|住所|メールアドレス|電話番号|口座番号|クレジットカード)/i;

const QUESTION_GROUNDING_VALIDATORS: Record<string, (text: string) => boolean> = {
  planning_period: (text) => /(?:いつ|何日|期間|今週|来週|週末|開始|始め|終わり|まで)/.test(text),
  planning_start_date: (text) => /(?:いつ|何日|何曜|開始|始め)/.test(text),
  planning_duration: (text) => /(?:何日|日数|期間|どれくらい|何週間)/.test(text),
  tasks_or_goals: (text) => /(?:何を|学習内容|目標|教材|課題|勉強|進めたい)/.test(text),
  fixed_events: (text) => /(?:固定|動かせない|外せない|時間が決ま|登録済み).*(?:予定|授業|仕事|用事)|(?:予定|授業|仕事|用事).*(?:固定|動かせない|外せない|ありますか)/.test(text),
  sleep_cycle: (text) => /(?:睡眠|就寝|起床|寝る|起きる|勉強を始め).*(?:時間|時刻|何時|いつ|リズム)|(?:何時|いつ).*(?:寝|起き|勉強を始め)/.test(text),
  meal_bath_constraints: (text) => /(?:食事|朝食|昼食|夕食|風呂|入浴).*(?:時間|時刻|何時|どれくらい|入れにくい)/.test(text),
  life_constraints: (text) => /(?:生活|睡眠|食事|風呂|入浴).*(?:制約|時間|リズム|入れにくい)/.test(text),
  year_range: (text) => /(?:対象|過去問|試験).*(?:年度|何年).*(?:から|まで|範囲)|(?:年度|何年).*(?:から|まで|範囲)/.test(text),
  progress: (text) => /(?:進捗|現在|今).*(?:どこまで|終わ|済み|未着手)|(?:どこまで).*(?:進め|終わ)/.test(text),
  completion_direction: (text) => /(?:新しい|古い|どちら|どっち).*(?:年度|側|順)|(?:年度).*(?:新しい|古い|側)/.test(text),
  unit_rate: (text) => /(?:(?:1|一)\s*(?:年分|分野).*(?:何時間|何分|どれくらい))|(?:目安|かかる|かかります|必要|所要).*(?:時間|何時間|何分|どれくらい)|(?:何時間|何分|どれくらい).*(?:かかる|必要|目安)/.test(text),
  unit_duration_estimate: (text) => /(?:(?:1|一)\s*(?:年分|分野).*(?:何時間|何分|どれくらい))|(?:目安|かかる|かかります|必要|所要).*(?:時間|何時間|何分|どれくらい)|(?:何時間|何分|どれくらい).*(?:かかる|必要|目安)/.test(text),
  priority_policy: (text) => /(?:優先|順番|先).*(?:分野|科目|どれ|何|進め)|(?:分野|科目|どれ|何).*(?:優先|順番|先)/.test(text),
  next_field_after_math: (text) => /(?:次|その次).*(?:分野|科目)|(?:分野|科目).*(?:次|その次)/.test(text),
};

function isGroundedDialogueQuestion(planned: DialogueNextQuestion, text: string): boolean {
  const normalized = stripGenericAcknowledgementPrefix(text).replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 240 || DIALOGUE_FORBIDDEN_CONTENT.test(normalized)) {
    return false;
  }
  const validator = QUESTION_GROUNDING_VALIDATORS[planned.slotKey];
  if (validator) return validator(normalized);
  const hintTokens = (planned.vocabularyHint ?? '')
    .split(/[\s、。・／/やをのにへはがとでか]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return hintTokens.some((token) => normalized.includes(token));
}

export function sanitizeDialogueRenderOutput(
  output: unknown,
  input: DialogueRenderInput,
): DialogueRenderOutput | null {
  if (!isDialogueRenderOutput(output)) {
    return null;
  }

  const plannedQuestions = input.nextQuestions.slice(0, input.styleConstraints.maxQuestions);
  const allowedSlotKeys = new Set(plannedQuestions.map((question) => question.slotKey));
  const plannedBySlotKey = new Map(plannedQuestions.map((question) => [question.slotKey, question]));

  if (output.questions.length !== plannedQuestions.length || plannedQuestions.length === 0) {
    return null;
  }

  const outputBySlotKey = new Map<string, { slotKey: string; text: string }>();
  for (const question of output.questions) {
    const plannedQuestion = plannedBySlotKey.get(question.slotKey);
    if (!allowedSlotKeys.has(question.slotKey)
      || outputBySlotKey.has(question.slotKey)
      || !plannedQuestion
      || !isGroundedDialogueQuestion(plannedQuestion, question.text)) {
      return null;
    }

    outputBySlotKey.set(question.slotKey, question);
  }

  const questions = plannedQuestions.map((plannedQuestion) => {
    const renderedQuestion = outputBySlotKey.get(plannedQuestion.slotKey);
    if (!renderedQuestion) return undefined;
    const text = plannedQuestion.questionKind === 'repair'
      || plannedQuestion.slotKey === 'planning_period'
      || plannedQuestion.slotKey === 'fixed_events'
      || plannedQuestion.slotKey === 'planning_start_date'
      ? fallbackQuestionText(
        plannedQuestion,
        input.planningPeriodLabel,
        input.knownFixedEventSummaries,
        input.unitRateBasisLabel,
      )
      : stripGenericAcknowledgementPrefix(renderedQuestion.text);
    return text ? { ...renderedQuestion, text } : undefined;
  });
  if (questions.some((question) => !question)) {
    return null;
  }
  const normalizedQuestionTexts = questions.map((question) =>
    question ? question.text.replace(/\s+/g, ' ').trim() : '',
  );
  if (new Set(normalizedQuestionTexts).size !== normalizedQuestionTexts.length) {
    return null;
  }

  return {
    acknowledgement: formatAcceptedFacts(input) ?? undefined,
    questions: questions as Array<{ slotKey: string; text: string }>,
  };
}

function formatAcceptedFacts(input: DialogueRenderInput): string | null {
  const fields = input.acceptedFacts.fields ?? [];
  const fieldList = fields.length === 2 ? fields.join('と') : fields.join('、');
  const facts = [
    fields.length
      ? input.acceptedFacts.totalFields === 1 && fields.length === 1
        ? `${fieldList}を1科目`
        : fields.length === 1
          ? `対象分野は${fieldList}`
          : `${fieldList}の${fields.length}分野`
      : null,
    input.acceptedFacts.goals?.length ? '目標は' + input.acceptedFacts.goals.join('、') : null,
    input.acceptedFacts.yearRange
      ? `対象年度は${input.acceptedFacts.yearRange.startYear}〜${input.acceptedFacts.yearRange.endYear}`
      : null,
    typeof input.acceptedFacts.unitRateMinutes === 'number'
      ? `${input.unitRateBasisLabel ?? '1単位あたり'}の目安時間は${input.acceptedFacts.unitRateDisplay ?? `${input.acceptedFacts.unitRateMinutes}分`}`
      : null,
    input.acceptedFacts.priorityOrder?.length
      ? `優先順は${input.acceptedFacts.priorityOrder.join('、')}`
      : null,
    input.constraintSourcesInUse?.length
      ? `${input.constraintSourcesInUse.join('、')}を予定として利用中`
      : null,
  ].filter((fact): fact is string => Boolean(fact));

  // 計画期間ラベルはユーザー発話由来のときだけ出す。無ければ週に触れない(捏造しない)。
  const periodPrefix = input.planningPeriodLabel ? `${input.planningPeriodLabel}の計画ですね。` : null;
  const factsSentence = facts.length > 0 ? `${facts.join('、')}で受け取りました。` : null;

  if (!periodPrefix && !factsSentence) {
    return null;
  }

  return [periodPrefix, factsSentence].filter((part): part is string => Boolean(part)).join('');
}

function fallbackQuestionText(
  question: DialogueNextQuestion,
  planningPeriodLabel?: string,
  knownFixedEventSummaries?: string[],
  unitRateBasis?: string,
): string {
  if (question.questionKind === 'repair') {
    switch (question.slotKey) {
      case 'priority_policy':
        return '進める順番だけ確認します。どちらを先にしますか？同じ優先度でも構いません。';
      case 'sleep_cycle':
        return '開始できる時刻だけ確認します。何時から勉強できますか？';
      case 'fixed_events':
        return '固定予定についてだけ確認します。登録済み以外に、動かせない予定はありますか？';
      case 'unit_rate':
        return `${unitRateBasis ?? '1単位あたり'}の目安時間だけ確認します。だいたい何時間かかりますか？`;
      case 'planning_period':
        return '計画期間だけ確認します。いつからいつまでにしますか？';
      default:
        return fallbackQuestionForSlot(question.slotKey, {
          planningPeriodLabel,
          options: question.options,
          knownFixedEventSummaries,
          unitRateBasisLabel: unitRateBasis,
        }) ?? '未回答の条件を一つだけ確認します。';
    }
  }
  return fallbackQuestionForSlot(question.slotKey, {
    planningPeriodLabel,
    options: question.options,
    knownFixedEventSummaries,
    unitRateBasisLabel: unitRateBasis,
  }) ?? '次に確認したい条件を教えてください。';
}

function renderDeterministicMissingQuestions(input: DialogueRenderInput): string {
  const acknowledgement = formatAcceptedFacts(input) ?? 'ここまでの条件を確認しました。';
  const questions = input.nextQuestions
    .slice(0, input.styleConstraints.maxQuestions)
    .map((question) => fallbackQuestionText(
      question,
      input.planningPeriodLabel,
      input.knownFixedEventSummaries,
      input.unitRateBasisLabel,
    ));

  return [acknowledgement, ...questions].join('\n');
}

function composeRenderedMessage(output: DialogueRenderOutput): string {
  return composeUniqueDialogueMessage([
    output.acknowledgement,
    ...output.questions.map((question) => question.text),
  ]);
}

function tracedMessage(
  message: string,
  responseSource: WeeklyPlanningTraceResponseSource,
  state: PlanningIntakeState,
  userId?: string,
): string {
  recordWeeklyPlanningRenderedAssistantTurn({
    content: message,
    responseSource,
    state,
    userId,
  });
  return message;
}

export async function renderWeeklyPlanningDialogueMessage(params: {
  state: PlanningIntakeState;
  previousState?: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
  renderer?: WeeklyPlanningDialogueRenderer;
  userId?: string;
  existingPlans?: Plan[];
}): Promise<string> {
  const input = createDialogueRenderInput({
    state: params.state,
    previousState: params.previousState,
    decision: params.decision,
    existingPlans: params.existingPlans,
  });

  const shouldRenderMissingQuestions = params.decision.kind === 'ask_missing_info' && input.nextQuestions.length > 0;

  if (!shouldRenderMissingQuestions) {
    return tracedMessage(createWeeklyPlanningDialogueMessage(params.decision), 'rules', params.state, params.userId);
  }

  if (!params.renderer) {
    return tracedMessage(renderDeterministicMissingQuestions(input), 'rules', params.state, params.userId);
  }

  try {
    const rendered = await params.renderer.render(input);
    const sanitized = sanitizeDialogueRenderOutput(rendered, input);

    if (sanitized) {
      return tracedMessage(composeRenderedMessage(sanitized), 'ai', params.state, params.userId);
    }

    return tracedMessage(renderDeterministicMissingQuestions(input), 'deterministic_fallback', params.state, params.userId);
  } catch {
    return tracedMessage(renderDeterministicMissingQuestions(input), 'deterministic_fallback', params.state, params.userId);
  }
}
