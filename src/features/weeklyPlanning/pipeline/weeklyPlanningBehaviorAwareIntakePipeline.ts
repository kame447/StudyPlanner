import {
  createAiBehaviorAwareWeeklyPlanningDialoguePlanner,
  createDeterministicBehaviorAwareDialoguePlanner,
  type BehaviorAwareDialoguePlannerInput,
  type BehaviorAwareDialoguePlannerResult,
} from '../dialogue/weeklyPlanningBehaviorAwareDialoguePlanner';
import {
  runHardenedBehaviorAwarePlanningPreviewBridge,
} from '../planning/weeklyPlanningBehaviorAwarePreviewBridgeHardened';
import type {
  BehaviorAwarePlanningBridgeResult,
} from '../planning/weeklyPlanningBehaviorAwarePreviewBridge';
import type { AllowedDialogueAction } from '../planning/weeklyPlanningBehaviorTypes';
import {
  applyDraftGenerationAuthorizationTurn,
} from '../planning/weeklyPlanningDraftGenerationAuthorization';
import {
  runWeeklyPlanningIntakePipeline,
  runWeeklyPlanningIntakePipelineWithInterpreter,
  type WeeklyPlanningIntakePipelineInput,
  type WeeklyPlanningIntakePipelineOutput,
  type WeeklyPlanningIntakePipelineWithInterpreterInput,
} from './weeklyPlanningIntakePipeline';

export interface WeeklyPlanningBehaviorAwarePipelineOutput
  extends WeeklyPlanningIntakePipelineOutput {
  behavior: BehaviorAwarePlanningBridgeResult;
  behaviorDialogue: BehaviorAwareDialoguePlannerResult;
}

export interface BehaviorAwareDialoguePlanner {
  plan(input: BehaviorAwareDialoguePlannerInput): Promise<BehaviorAwareDialoguePlannerResult>;
}

export interface WeeklyPlanningBehaviorAwarePipelineOptions {
  conversationId?: string;
  dialoguePlanner?: BehaviorAwareDialoguePlanner;
  useAiDialoguePlanner?: boolean;
}

function constraintSummary(
  output: WeeklyPlanningIntakePipelineOutput,
): string[] {
  return output.state.constraints.map((constraint) =>
    [constraint.kind, constraint.date, constraint.start, constraint.end, constraint.studyAvailableStart]
      .filter(Boolean)
      .join(' '),
  );
}

function planningPeriodLabel(
  output: WeeklyPlanningIntakePipelineOutput,
): string | undefined {
  const source = output.state.range?.sourceText;
  if (source && /来週/.test(source)) return '来週';
  if (source && /今週/.test(source)) return '今週';
  if (source && /週末|土日/.test(source)) return '週末';
  return output.state.pendingPlanningRange?.scope.label;
}

function behaviorDialogueInput(params: {
  base: WeeklyPlanningIntakePipelineOutput;
  behavior: BehaviorAwarePlanningBridgeResult;
  input: WeeklyPlanningIntakePipelineInput;
}): BehaviorAwareDialoguePlannerInput {
  return {
    snapshot: params.behavior.snapshot,
    allowedActions: params.behavior.actions,
    acceptedFacts: {
      taskLabels: params.base.state.tasks.map((task) => task.title),
      planningPeriodLabel: planningPeriodLabel(params.base),
      constraintSummary: constraintSummary(params.base),
    },
    recentConversation: params.input.recentTurns?.slice(-6),
    previewAllowed: params.behavior.gate.allowed,
  };
}

function selectDialoguePlanner(
  options: WeeklyPlanningBehaviorAwarePipelineOptions,
): BehaviorAwareDialoguePlanner {
  if (options.dialoguePlanner) return options.dialoguePlanner;
  if (options.useAiDialoguePlanner) {
    return createAiBehaviorAwareWeeklyPlanningDialoguePlanner();
  }
  return createDeterministicBehaviorAwareDialoguePlanner();
}

function applyNonExamDraftAuthorization(params: {
  base: WeeklyPlanningIntakePipelineOutput;
  userText: string;
}): WeeklyPlanningIntakePipelineOutput {
  if (params.base.state.examPrepScope) {
    return params.base;
  }

  return {
    ...params.base,
    state: applyDraftGenerationAuthorizationTurn({
      state: params.base.state,
      userText: params.userText,
    }),
  };
}

async function finalizeBehaviorAwareOutput(params: {
  base: WeeklyPlanningIntakePipelineOutput;
  input: WeeklyPlanningIntakePipelineInput;
  options: WeeklyPlanningBehaviorAwarePipelineOptions;
}): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  const authorizedBase = applyNonExamDraftAuthorization({
    base: params.base,
    userText: params.input.userText,
  });
  const behavior = runHardenedBehaviorAwarePlanningPreviewBridge({
    state: authorizedBase.state,
    currentUserText: params.input.userText,
    conversationId: params.options.conversationId,
    planningStartDate: params.input.planningStartDate,
    planningDayCount: params.input.planningDayCount,
    sessionPolicy: params.input.sessionPolicy,
    existingPlans: params.input.existingPlans,
    scheduleTemplates: params.input.scheduleTemplates,
    timetableTermId: params.input.timetableTermId,
    existingPlanBufferMinutes: params.input.existingPlanBufferMinutes,
  });
  const behaviorDialogue = await selectDialoguePlanner(params.options).plan(
    behaviorDialogueInput({ base: authorizedBase, behavior, input: params.input }),
  );

  if (authorizedBase.state.examPrepScope) {
    // Exam flow remains on the compatibility path until its policy is migrated.
    return {
      ...authorizedBase,
      behavior,
      behaviorDialogue,
    };
  }

  return {
    ...authorizedBase,
    draftCandidates: behavior.draftRun?.candidates ?? null,
    diagnostics: behavior.draftRun?.diagnostics ?? null,
    behavior,
    behaviorDialogue,
  };
}

export async function runWeeklyPlanningBehaviorAwarePipeline(
  input: WeeklyPlanningIntakePipelineInput,
  options: WeeklyPlanningBehaviorAwarePipelineOptions = {},
): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  const base = runWeeklyPlanningIntakePipeline(input);
  return finalizeBehaviorAwareOutput({ base, input, options });
}

export async function runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
  input: WeeklyPlanningIntakePipelineWithInterpreterInput,
  options: WeeklyPlanningBehaviorAwarePipelineOptions = {},
): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  const base = await runWeeklyPlanningIntakePipelineWithInterpreter(input);
  return finalizeBehaviorAwareOutput({ base, input, options });
}

export function hasAllowedDialogueAction(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
  kind: AllowedDialogueAction['kind'],
): boolean {
  return output.behavior.actions.some((action) => action.kind === kind);
}
