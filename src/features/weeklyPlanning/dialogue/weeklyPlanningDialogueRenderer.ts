import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningDialogueDecision } from './weeklyPlanningDialogueManager';
import { createWeeklyPlanningDialogueMessage } from './weeklyPlanningDialogueMessages';

export interface DialogueRenderInput {
  acceptedFacts: {
    fields?: string[];
    yearRange?: { startYear: number; endYear: number };
    unitRateMinutes?: number;
    priorityOrder?: string[];
    constraintSummary?: string[];
  };
  assumptions: string[];
  nextQuestions: Array<{ slotKey: string; intent: string; options?: string[] }>;
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
): Array<{ slotKey: string; intent: string }> {
  if (decision.questionPlan?.length) {
    return decision.questionPlan
      .slice(0, maxQuestions)
      .map((question) => ({
        slotKey: question.targetSlot,
        intent: question.intent,
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

  const allowedSlotKeys = new Set(input.nextQuestions.map((question) => question.slotKey));
  const questions = output.questions
    .filter((question) => allowedSlotKeys.has(question.slotKey))
    .slice(0, input.styleConstraints.maxQuestions);

  if (questions.length === 0) {
    return null;
  }

  return {
    acknowledgement: output.acknowledgement,
    questions,
  };
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
  if (!params.renderer) {
    return createWeeklyPlanningDialogueMessage(params.decision);
  }

  const input = createDialogueRenderInput({
    state: params.state,
    decision: params.decision,
  });

  try {
    const rendered = await params.renderer.render(input);
    const sanitized = sanitizeDialogueRenderOutput(rendered, input);

    return sanitized
      ? composeRenderedMessage(sanitized)
      : createWeeklyPlanningDialogueMessage(params.decision);
  } catch {
    return createWeeklyPlanningDialogueMessage(params.decision);
  }
}
