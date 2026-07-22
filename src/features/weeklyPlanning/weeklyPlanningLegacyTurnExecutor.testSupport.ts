import { renderWeeklyPlanningDialogueMessage } from './dialogue/weeklyPlanningDialogueRenderer';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import { runLegacyWeeklyPlanningBehaviorAwarePipelineForTests } from './pipeline/weeklyPlanningLegacyBehaviorAwareIntakePipeline.testSupport';
import type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
} from './weeklyPlanningTurnExecutor';

const RECENT_TURN_LIMIT = 6;

export async function executeLegacyWeeklyPlanningTurnForTests(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  const pipelineOutput = await runLegacyWeeklyPlanningBehaviorAwarePipelineForTests({
    previousState: input.previousState,
    recentTurns: input.messages
      .slice(-RECENT_TURN_LIMIT)
      .map(({ role, content }) => ({ role, content })),
    userText: input.userText,
    planningStartDate: input.selectedDate,
    planningDayCount: 7,
    currentDateTime: `${input.selectedDate}T09:00:00`,
    sessionPolicy: {
      firstDayStartTime: '09:00',
      dayStartTime: '09:00',
      dayEndTime: '22:00',
      breakMinutes: 10,
    },
    existingPlans: input.plans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    weekStartsOn: input.weekStartsOn,
  }, {
    userId: input.userId,
    conversationId: input.conversationId,
    traceRequestId: input.traceRequestId,
  });
  const isExamFlow = Boolean(pipelineOutput.state.examPrepScope);
  const message = isExamFlow
    ? await renderWeeklyPlanningDialogueMessage({
        state: pipelineOutput.state,
        previousState: input.previousState,
        decision: pipelineOutput.decision,
        userId: input.userId,
        existingPlans: input.plans,
      })
    : pipelineOutput.behaviorDialogue.message;
  const firstRenderedQuestion = isExamFlow
    ? pipelineOutput.decision.questionPlan?.[0]
    : undefined;
  const state: PlanningIntakeState = firstRenderedQuestion
    ? {
        ...pipelineOutput.state,
        lastQuestionContext: {
          kind: pipelineOutput.decision.kind === 'offer_dry_run_preview' ? 'preview' : 'missing',
          targetSlot: firstRenderedQuestion.targetSlot,
          intent: firstRenderedQuestion.intent,
        },
      }
    : pipelineOutput.state;

  return {
    state,
    message,
    draftCandidates: pipelineOutput.draftCandidates ?? [],
  };
}
