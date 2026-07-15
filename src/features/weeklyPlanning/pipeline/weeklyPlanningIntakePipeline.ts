import { createWeeklyPlanningClarificationDecision } from '../dialogue/weeklyPlanningDialogueManager';
import { parseRequestClarificationCommand } from '../intake/weeklyPlanningClarificationParsing';
import type { RequestClarificationCommand } from '../intake/weeklyPlanningCommandTypes';
import type { WeeklyPlanningQuestionContext } from '../intake/weeklyPlanningIntakeTypes';
import { rebuildWeeklyPlanningDialogueDecision } from './weeklyPlanningDialogueDecisionRebuilder';
import {
  runWeeklyPlanningIntakePipeline as runCore,
  runWeeklyPlanningIntakePipelineWithInterpreter as runCoreWithInterpreter,
  type WeeklyPlanningIntakePipelineInput,
  type WeeklyPlanningIntakePipelineOutput,
  type WeeklyPlanningIntakePipelineWithInterpreterInput,
} from './weeklyPlanningIntakePipelineCore';

export type {
  WeeklyPlanningAssumedDraft,
  WeeklyPlanningAssumptionProposalDiagnostics,
  WeeklyPlanningIntakePipelineInput,
  WeeklyPlanningIntakePipelineOutput,
  WeeklyPlanningIntakePipelineWithInterpreterInput,
} from './weeklyPlanningIntakePipelineCore';

function deterministicRequest(input: WeeklyPlanningIntakePipelineInput): RequestClarificationCommand | undefined {
  return parseRequestClarificationCommand(input.userText, {
    hasActiveQuestion: Boolean(input.previousState?.lastQuestionContext),
    activeQuestionSource: 'rendered',
  });
}

function applyClarification(
  output: WeeklyPlanningIntakePipelineOutput,
  input: WeeklyPlanningIntakePipelineInput,
  interpreterRequest?: RequestClarificationCommand,
): WeeklyPlanningIntakePipelineOutput {
  const request = interpreterRequest ?? deterministicRequest(input);
  if (!request) {
    return output.decision.kind === 'answer_clarification'
      ? { ...output, decision: rebuildWeeklyPlanningDialogueDecision(output) }
      : output;
  }
  const previousQuestionContext = input.previousState?.lastQuestionContext;
  const decision = createWeeklyPlanningClarificationDecision({
    state: output.state,
    target: request.target,
    ref: request.ref,
    previousQuestionContext,
  });
  const targetSlot = decision.clarification?.targetSlot;
  const lastQuestionContext: WeeklyPlanningQuestionContext | undefined =
    request.target === 'referenced_question' && previousQuestionContext
      ? previousQuestionContext
      : targetSlot
        ? { kind: 'options', targetSlot, intent: decision.clarification?.intent }
        : previousQuestionContext;
  return {
    ...output,
    decision,
    state: { ...output.state, lastQuestionContext },
  };
}

export function runWeeklyPlanningIntakePipeline(
  input: WeeklyPlanningIntakePipelineInput,
): WeeklyPlanningIntakePipelineOutput {
  return applyClarification(runCore(input), input);
}

export async function runWeeklyPlanningIntakePipelineWithInterpreter(
  input: WeeklyPlanningIntakePipelineWithInterpreterInput,
): Promise<WeeklyPlanningIntakePipelineOutput> {
  const output = await runCoreWithInterpreter(input);
  const candidate = output.interpreterDiagnostics?.clarificationRequests[0];
  const interpreterRequest = candidate?.type === 'request_clarification' ? candidate : undefined;
  const safeInterpreterRequest = interpreterRequest?.target === 'referenced_question'
    && !input.previousState?.lastQuestionContext
    ? undefined
    : interpreterRequest;
  return applyClarification(output, input, safeInterpreterRequest);
}
