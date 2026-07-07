import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningDialogueDecision } from './weeklyPlanningDialogueManager';
import { createWeeklyPlanningDialogueMessage } from './weeklyPlanningDialogueMessages';

export interface DialogueNextQuestion {
  slotKey: string;
  intent: string;
  questionKind?: string;
  options?: string[];
}

export interface DialogueRenderInput {
  acceptedFacts: {
    fields?: string[];
    yearRange?: { startYear: number; endYear: number };
    unitRateMinutes?: number;
    priorityOrder?: string[];
    constraintSummary?: string[];
  };
  assumptions: string[];
  nextQuestions: DialogueNextQuestion[];
  styleConstraints: { tone: 'mentor'; maxQuestions: number };
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
): DialogueNextQuestion[] {
  if (decision.questionPlan?.length) {
    return decision.questionPlan
      .slice(0, maxQuestions)
      .map((question) => ({
        slotKey: question.targetSlot,
        intent: question.intent,
        questionKind: question.kind,
      }));
  }

  return (decision.requiredFields ?? [])
    .slice(0, maxQuestions)
    .map((field) => ({
      slotKey: field,
      intent: decision.messageKey,
    }));
}

export function createDialogueRenderInput(params: {
  state: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
}): DialogueRenderInput {
  const unitRate = params.state.unitRates.find((rate) => typeof rate.minutesPerUnit === 'number');
  const priorityOrder = params.state.priorityPolicy.kind === 'field_first'
    ? params.state.priorityPolicy.order
    : undefined;

  return {
    acceptedFacts: {
      fields: params.state.examPrepScope?.fields,
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
    nextQuestions: nextQuestionsFromDecision(params.decision, 2),
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

  const questions = plannedQuestions.map((plannedQuestion) => outputBySlotKey.get(plannedQuestion.slotKey));
  if (questions.some((question) => !question)) {
    return null;
  }

  return {
    acknowledgement: output.acknowledgement,
    questions: questions as Array<{ slotKey: string; text: string }>,
  };
}


function formatAcceptedFacts(input: DialogueRenderInput): string | null {
  const facts = [
    input.acceptedFacts.fields?.length ? `分野は${input.acceptedFacts.fields.join('、')}` : null,
    input.acceptedFacts.yearRange
      ? `対象年度は${input.acceptedFacts.yearRange.startYear}〜${input.acceptedFacts.yearRange.endYear}`
      : null,
    typeof input.acceptedFacts.unitRateMinutes === 'number'
      ? `目安時間は${input.acceptedFacts.unitRateMinutes}分`
      : null,
    input.acceptedFacts.priorityOrder?.length
      ? `優先順は${input.acceptedFacts.priorityOrder.join('、')}`
      : null,
  ].filter((fact): fact is string => Boolean(fact));

  return facts.length > 0 ? `${facts.join('、')}で受け取りました。` : null;
}

function fallbackQuestionText(question: DialogueNextQuestion): string {
  switch (question.slotKey) {
    case 'tasks_or_goals':
      return '計画したい学習内容や目標を教えてください。';
    case 'year_range':
      return '対象年度は何年から何年までですか？';
    case 'completion_direction':
      return '完了済み年度の範囲を確認したいです。新しい年度側からか、古い年度側からか教えてください。';
    case 'progress':
      return '現在の進捗を教えてください。';
    case 'unit_rate':
      return '1年分または1単位あたりの目安時間を教えてください。';
    case 'priority_policy':
      return '週末で優先する分野や進める順番を教えてください。';
    case 'fixed_events':
      return '授業・バイト・通院など、動かせない予定があれば教えてください。';
    case 'sleep_cycle':
      return '睡眠時間や、何時から勉強を始められるかを教えてください。';
    case 'meal_bath_constraints':
      return '食事やお風呂など、勉強を入れにくい時間を教えてください。';
    case 'life_constraints':
      return '食事・お風呂・睡眠など、生活上の制約を教えてください。';
    default:
      return '次に確認したい条件を教えてください。';
  }
}

function renderDeterministicMissingQuestions(input: DialogueRenderInput): string {
  const acknowledgement = formatAcceptedFacts(input) ?? 'ここまでの条件を確認しました。';
  const questions = input.nextQuestions
    .slice(0, input.styleConstraints.maxQuestions)
    .map(fallbackQuestionText);

  return [acknowledgement, ...questions].join('\n');
}

function composeRenderedMessage(output: DialogueRenderOutput): string {
  return [
    output.acknowledgement,
    ...output.questions.map((question) => question.text),
  ].filter((part): part is string => Boolean(part)).join('\n');
}

export async function renderWeeklyPlanningDialogueMessage(params: {
  state: PlanningIntakeState;
  decision: WeeklyPlanningDialogueDecision;
  renderer?: WeeklyPlanningDialogueRenderer;
}): Promise<string> {
  const input = createDialogueRenderInput({
    state: params.state,
    decision: params.decision,
  });

  const shouldRenderMissingQuestions = params.decision.kind === 'ask_missing_info' && input.nextQuestions.length > 0;

  if (!shouldRenderMissingQuestions) {
    return createWeeklyPlanningDialogueMessage(params.decision);
  }

  if (!params.renderer) {
    return renderDeterministicMissingQuestions(input);
  }

  try {
    const rendered = await params.renderer.render(input);
    const sanitized = sanitizeDialogueRenderOutput(rendered, input);

    if (sanitized) {
      return composeRenderedMessage(sanitized);
    }

    return renderDeterministicMissingQuestions(input);
  } catch {
    return renderDeterministicMissingQuestions(input);
  }
}
