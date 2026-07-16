import { getAiConfig, getAiConfigValidationMessage } from '../../lib/aiConfig';
import type { Plan, ScheduleTemplate } from '../../types/domain';
import { createAiWeeklyPlanningDialogueRenderer } from './dialogue/weeklyPlanningAiDialogueRenderer';
import { renderWeeklyPlanningDialogueMessage } from './dialogue/weeklyPlanningDialogueRenderer';
import { createAiWeeklyPlanningInterpreter } from './intake/weeklyPlanningAiInterpreter';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import {
  runWeeklyPlanningBehaviorAwarePipeline,
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
} from './pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningMessage } from './types';

const RECENT_TURN_LIMIT = 6;

export interface WeeklyPlanningTurnExecutionInput {
  previousState?: PlanningIntakeState;
  messages: readonly WeeklyPlanningMessage[];
  userText: string;
  selectedDate: string;
  userId: string;
  plans: Plan[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId?: string;
  traceRequestId: string;
}

export interface WeeklyPlanningTurnExecutionResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
}

export interface WeeklyPlanningTurnSubmissionResult {
  accepted: boolean;
  draftCandidates: WeeklyDraftCandidate[];
}

export async function executeWeeklyPlanningTurn(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const pipelineInput = {
    previousState: input.previousState,
    recentTurns: input.messages
      .slice(-RECENT_TURN_LIMIT)
      .map(({ role, content }) => ({ role, content })),
    userText: input.userText,
    planningStartDate: input.selectedDate,
    planningDayCount: 7,
    sessionPolicy: {
      firstDayStartTime: '09:00',
      dayStartTime: '09:00',
      dayEndTime: '22:00',
      breakMinutes: 10,
    },
    existingPlans: input.plans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
  };
  const aiConfig = getAiConfig();
  const shouldUseAiInterpreter =
    aiConfig.provider !== 'rules' && !getAiConfigValidationMessage(aiConfig);
  const pipelineOutput = shouldUseAiInterpreter
    ? await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineInput,
      interpreter: createAiWeeklyPlanningInterpreter(aiConfig),
    }, {
      useAiDialoguePlanner: true,
      userId: input.userId,
      traceRequestId: input.traceRequestId,
    })
    : await runWeeklyPlanningBehaviorAwarePipeline(pipelineInput, {
      userId: input.userId,
      traceRequestId: input.traceRequestId,
    });
  const isExamFlow = Boolean(pipelineOutput.state.examPrepScope);
  const dialogueRenderer = isExamFlow && shouldUseAiInterpreter
    ? createAiWeeklyPlanningDialogueRenderer(aiConfig)
    : undefined;
  const message = isExamFlow
    ? await renderWeeklyPlanningDialogueMessage({
      state: pipelineOutput.state,
      decision: pipelineOutput.decision,
      renderer: dialogueRenderer,
      userId: input.userId,
      existingPlans: input.plans,
    })
    : pipelineOutput.behaviorDialogue.message;

  return {
    state: pipelineOutput.state,
    message,
    draftCandidates: pipelineOutput.draftCandidates ?? [],
  };
}
