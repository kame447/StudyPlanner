import { createWeeklyPlanningClarificationDecision } from '../dialogue/weeklyPlanningDialogueManager';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { applyWeeklyPlanningUserTurn } from '../intake/weeklyPlanningLegacyIntakeReducer.testSupport';
import type { PlanningIntakeState, WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import { parseRequestClarificationCommand } from '../intake/weeklyPlanningClarificationParsing';
import {
  buildPipelineOutput,
  initialAssumptionProposalState,
  type WeeklyPlanningIntakePipelineInput,
  type WeeklyPlanningIntakePipelineOutput,
} from './weeklyPlanningIntakePipeline';

function currentDateTime(input: WeeklyPlanningIntakePipelineInput): string {
  if (input.currentDateTime) return input.currentDateTime;
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
}

function applyClarificationDecision(
  output: WeeklyPlanningIntakePipelineOutput,
  request: ReturnType<typeof parseRequestClarificationCommand>,
  previousQuestionContext: WeeklyPlanningQuestionContext | undefined,
): WeeklyPlanningIntakePipelineOutput {
  if (!request) return output;
  const decision = createWeeklyPlanningClarificationDecision({
    state: output.state,
    target: request.target,
    ref: request.ref,
    previousQuestionContext,
  });
  const targetSlot = decision.clarification?.targetSlot;
  output.decision = decision;
  output.state.lastQuestionContext = request.target === 'referenced_question' && previousQuestionContext
    ? previousQuestionContext
    : targetSlot
      ? { kind: 'options', targetSlot, intent: decision.clarification?.intent }
      : previousQuestionContext;
  return output;
}

/** Legacy parser harness. Test-only; never import from production application code. */
export function runLegacyWeeklyPlanningIntakePipelineForTests(
  input: WeeklyPlanningIntakePipelineInput,
): WeeklyPlanningIntakePipelineOutput {
  const previousState: PlanningIntakeState = input.previousState ?? createInitialPlanningIntakeState();
  const clarificationRequest = parseRequestClarificationCommand(input.userText, {
    hasActiveQuestion: Boolean(previousState.lastQuestionContext),
    activeQuestionSource: 'rendered',
  });
  const state = applyWeeklyPlanningUserTurn(previousState, input.userText, {
    selectedDate: input.planningStartDate,
    planningDayCount: input.planningDayCount,
    currentDateTime: currentDateTime(input),
    weekStartsOn: input.weekStartsOn,
  });
  return applyClarificationDecision(buildPipelineOutput({
    input,
    state,
    assumptionProposalState: initialAssumptionProposalState(input),
  }), clarificationRequest, previousState.lastQuestionContext);
}
