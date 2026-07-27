import { getAiConfig, getAiConfigValidationMessage } from '../../lib/aiConfig';
import type { Plan, ScheduleTemplate } from '../../types/domain';
import {
  isWeeklyPlanningStableV5RuntimeEnabled,
} from './application/weeklyPlanningRuntimeMode';
import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
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
import type { WeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import {
  takeWeeklyPlanningStableV5FailureDiagnostics,
} from './semantic/weeklyPlanningStableV5FailureDiagnostics';
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

export type WeeklyPlanningTurnFailureCode =
  | 'stable_v5_provider_failure'
  | 'stable_v5_normalization_rejected'
  | 'stable_v5_canonicalization_rejected';

export interface WeeklyPlanningTurnFailureDiagnostics {
  attemptCount: number;
  repairAttempted: boolean;
  validationErrorCategories: string[];
  providerErrorCategory: 'provider_error' | null;
}

export interface WeeklyPlanningTurnFailure {
  code: WeeklyPlanningTurnFailureCode;
  userMessage: string;
  traceCode: string;
  diagnostics: WeeklyPlanningTurnFailureDiagnostics;
}

export interface WeeklyPlanningTurnExecutionResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
  stableV5Graph?: WeeklyPlanningFactGraphV5;
  failure?: WeeklyPlanningTurnFailure;
}

export interface WeeklyPlanningTurnSubmissionResult {
  accepted: boolean;
  draftCandidates: WeeklyDraftCandidate[];
}

export async function executeWeeklyPlanningTurn(
  input: WeeklyPlanningTurnExecutionInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  if (isWeeklyPlanningStableV5RuntimeEnabled()) {
    takeWeeklyPlanningStableV5FailureDiagnostics(input.traceRequestId);
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
    const recordedFailure = takeWeeklyPlanningStableV5FailureDiagnostics(input.traceRequestId);
    if (!recordedFailure) return result;

    const failureCode = `stable_v5_${recordedFailure.status}` as WeeklyPlanningTurnFailureCode;
    return {
      ...result,
      state: {
        ...result.state,
        status: 'revision_pending',
        missing: [],
        questions: [],
        lastQuestionContext: undefined,
        shouldCreateDraft: false,
        draftGenerationIntent: 'not_requested',
      },
      failure: {
        code: failureCode,
        userMessage: result.message,
        traceCode: recordedFailure.traceCode,
        diagnostics: {
          attemptCount: recordedFailure.attemptCount,
          repairAttempted: recordedFailure.repairAttempted,
          validationErrorCategories: recordedFailure.validationErrorCategories,
          providerErrorCategory: recordedFailure.providerErrorCategory,
        },
      },
    };
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
