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
    goals?: string[];
    yearRange?: { startYear: number; endYear: number };
    unitRateMinutes?: number;
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
function planningPeriodLabel(state: PlanningIntakeState): string | undefined {
  const source = state.range?.sourceText;

  if (source) {
    if (/来週/.test(source)) return '来週';
    if (/今週/.test(source)) return '今週';
    if (/週末|土日/.test(source)) return '週末';
  }

  if (!state.range && state.pendingPlanningRange) {
    return state.pendingPlanningRange.scope.label;
  }

  return undefined;
}

function unitRateBasisLabel(state: PlanningIntakeState): string | undefined {
  return state.examPrepScope?.unitModel === 'year_field_chunk'
    ? '1年分・1分野あたり'
    : undefined;
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

function constraintSummary(state: PlanningIntakeState): string[] | undefined {
  const values = state.constraints.map((constraint) =>
    [constraint.kind, constraint.date, constraint.start, constraint.end]
      .filter(Boolean)
      .join(' '),
  );

  return values.length > 0 ? values : undefined;
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

export function createDialogueRenderInput(params: {
  state: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
  existingPlans?: Plan[];
}): DialogueRenderInput {
  const unitRate = params.state.unitRates.find((rate) => typeof rate.minutesPerUnit === 'number');
  const priorityOrder = params.state.priorityPolicy.kind === 'field_first'
    ? params.state.priorityPolicy.order
    : undefined;
  const commandGoalTitles = params.state.tasks
    .filter((task) => task.source === 'command')
    .map((task) => task.title);
  const knownFixedEventSummaries = createKnownFixedEventSummaries(
    params.existingPlans ?? [],
    params.state.range,
  );

  return {
    planningPeriodLabel: planningPeriodLabel(params.state),
    unitRateBasisLabel: unitRateBasisLabel(params.state),
    constraintSourcesInUse: constraintSourcesInUseLabels(params.state),
    knownFixedEventSummaries: knownFixedEventSummaries.length > 0
      ? knownFixedEventSummaries
      : undefined,
    acceptedFacts: {
      fields: params.state.examPrepScope?.fields,
      goals: commandGoalTitles.length > 0 ? commandGoalTitles : undefined,
      yearRange: params.state.examPrepScope?.yearRange
        ? {
            startYear: params.state.examPrepScope.yearRange.startYear,
            endYear: params.state.examPrepScope.yearRange.endYear,
          }
        : undefined,
      unitRateMinutes: unitRate?.minutesPerUnit,
      priorityOrder,
      constraintSummary: constraintSummary(params.state),
    },
    assumptions: [...params.state.assumptions],
    nextQuestions: nextQuestionsFromDecision(
      params.decision,
      2,
      unitRateBasisLabel(params.state),
    ),
    styleConstraints: { tone: 'mentor', maxQuestions: 2 },
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

export function sanitizeDialogueRenderOutput(
  output: unknown,
  input: DialogueRenderInput,
): DialogueRenderOutput | null {
  if (!isDialogueRenderOutput(output)) {
    return null;
  }

  const plannedQuestions = input.nextQuestions.slice(0, input.styleConstraints.maxQuestions);
  const allowedSlotKeys = new Set(plannedQuestions.map((question) => question.slotKey));

  if (output.questions.length !== plannedQuestions.length || plannedQuestions.length === 0) {
    return null;
  }

  const outputBySlotKey = new Map<string, { slotKey: string; text: string }>();
  for (const question of output.questions) {
    if (!allowedSlotKeys.has(question.slotKey) || outputBySlotKey.has(question.slotKey)) {
      return null;
    }

    outputBySlotKey.set(question.slotKey, question);
  }

  const questions = plannedQuestions.map((plannedQuestion) => {
    const renderedQuestion = outputBySlotKey.get(plannedQuestion.slotKey);
    if (!renderedQuestion) return undefined;
    const text = plannedQuestion.slotKey === 'fixed_events'
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
  const facts = [
    input.acceptedFacts.fields?.length
      ? `対象分野は${input.acceptedFacts.fields.join('、')}`
      : null,
    input.acceptedFacts.goals?.length ? '目標は' + input.acceptedFacts.goals.join('、') : null,
    input.acceptedFacts.yearRange
      ? `対象年度は${input.acceptedFacts.yearRange.startYear}〜${input.acceptedFacts.yearRange.endYear}`
      : null,
    typeof input.acceptedFacts.unitRateMinutes === 'number'
      ? `${input.unitRateBasisLabel ?? '1単位あたり'}の目安時間は${input.acceptedFacts.unitRateMinutes}分`
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
  decision: WeeklyPlanningDialogueDecision;
  renderer?: WeeklyPlanningDialogueRenderer;
  userId?: string;
  existingPlans?: Plan[];
}): Promise<string> {
  const input = createDialogueRenderInput({
    state: params.state,
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
