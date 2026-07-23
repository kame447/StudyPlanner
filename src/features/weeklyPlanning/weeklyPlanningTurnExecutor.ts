import { getAiConfig, getAiConfigValidationMessage } from '../../lib/aiConfig';
import type { Plan, ScheduleTemplate } from '../../types/domain';
import {
  isWeeklyPlanningStableV5RuntimeEnabled,
} from './application/weeklyPlanningRuntimeMode';
import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './application/weeklyPlanningStableV5RuntimeExecutor';
import {
  getWeeklyPlanningStableV5RuntimeSession,
} from './application/weeklyPlanningStableV5RuntimeSession';
import { createAiWeeklyPlanningDialogueRenderer } from './dialogue/weeklyPlanningAiDialogueRenderer';
import { renderWeeklyPlanningDialogueMessage } from './dialogue/weeklyPlanningDialogueRenderer';
import { createAiWeeklyPlanningInterpreter } from './intake/weeklyPlanningAiInterpreter';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import {
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
} from './pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import type { WeeklyPlanningWeekStartsOn } from './personalization/weeklyPlanningWeek';
import { WeeklyPlanningSemanticInterpreterError } from './pipeline/weeklyPlanningSemanticInterpreterError';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import {
  recordWeeklyPlanningStableV5TurnTrace,
} from './trace/weeklyPlanningStableV5TraceRuntime';
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
  conversationId: string;
  traceRequestId: string;
  weekStartsOn?: WeeklyPlanningWeekStartsOn;
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

function stableV5TraceContext(conversationId: string) {
  const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
  const graph = runtime?.graph;
  const activeFactIds = new Set(
    graph?.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId) ?? [],
  );
  const planningWindow = graph?.planningWindows.find((fact) => activeFactIds.has(fact.id));
  return {
    graphRevision: graph?.revision ?? 0,
    graphSummary: {
      taskCount: graph?.tasks.length ?? 0,
      workloadCount: graph?.workloads.length ?? 0,
      availabilityCount: graph?.availabilityDeclarations.length ?? 0,
      activeFactCount: activeFactIds.size,
    },
    planningRangeStart: planningWindow?.start ?? undefined,
    planningRangeEnd: planningWindow?.end ?? undefined,
  };
}

export async function executeWeeklyPlanningTurn(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  if (isWeeklyPlanningStableV5RuntimeEnabled()) {
    try {
      const result = await executeWeeklyPlanningStableV5RuntimeTurn({
        previousState: input.previousState,
        messages: input.messages,
        userText: input.userText,
        selectedDate: input.selectedDate,
        userId: input.userId,
        plans: input.plans,
        scheduleTemplates: input.scheduleTemplates,
        timetableTermId: input.timetableTermId,
        conversationId: input.conversationId,
        traceRequestId: input.traceRequestId,
      });
      const trace = stableV5TraceContext(input.conversationId);
      void recordWeeklyPlanningStableV5TurnTrace({
        userId: input.userId,
        conversationId: input.conversationId,
        requestId: input.traceRequestId,
        userText: input.userText,
        assistantMessage: result.message,
        outcome: result.draftCandidates.length > 0 ? 'preview_ready' : result.state.status,
        graphRevision: trace.graphRevision,
        graphSummary: trace.graphSummary,
        compatibilityState: result.state,
        previewCount: result.draftCandidates.length,
        planningRangeStart: trace.planningRangeStart,
        planningRangeEnd: trace.planningRangeEnd,
      });
      return result;
    } catch (error) {
      const trace = stableV5TraceContext(input.conversationId);
      void recordWeeklyPlanningStableV5TurnTrace({
        userId: input.userId,
        conversationId: input.conversationId,
        requestId: input.traceRequestId,
        userText: input.userText,
        assistantMessage: '週間計画の会話状態を更新できませんでした。',
        outcome: 'failed',
        graphRevision: trace.graphRevision,
        graphSummary: trace.graphSummary,
        previewCount: 0,
        planningRangeStart: trace.planningRangeStart,
        planningRangeEnd: trace.planningRangeEnd,
        errorCode: error instanceof Error ? error.name : 'unknown-error',
      });
      throw error;
    }
  }

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
    weekStartsOn: input.weekStartsOn,
  };
  const aiConfig = getAiConfig();
  const aiConfigError = getAiConfigValidationMessage(aiConfig);
  if (aiConfig.provider === 'rules' || aiConfigError) {
    throw new WeeklyPlanningSemanticInterpreterError(
      'interpreter_unavailable',
      aiConfigError ?? 'rules provider is not permitted for weekly-planning interpretation',
    );
  }
  const pipelineOutput = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
    ...pipelineInput,
    interpreter: createAiWeeklyPlanningInterpreter(aiConfig),
  }, {
    useAiDialoguePlanner: true,
    userId: input.userId,
    conversationId: input.conversationId,
    traceRequestId: input.traceRequestId,
  });
  const isExamFlow = Boolean(pipelineOutput.state.examPrepScope);
  const semanticInterpretationSuppressed = pipelineOutput.interpretationOutcome === 'failed'
    || pipelineOutput.interpretationOutcome === 'rejected';
  const shouldRenderExamDialogue = isExamFlow && !semanticInterpretationSuppressed;
  const dialogueRenderer = shouldRenderExamDialogue
    ? createAiWeeklyPlanningDialogueRenderer(aiConfig)
    : undefined;
  const message = shouldRenderExamDialogue
    ? await renderWeeklyPlanningDialogueMessage({
      state: pipelineOutput.state,
      previousState: input.previousState,
      decision: pipelineOutput.decision,
      renderer: dialogueRenderer,
      userId: input.userId,
      existingPlans: input.plans,
    })
    : pipelineOutput.behaviorDialogue.message;
  const firstRenderedQuestion = shouldRenderExamDialogue
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
