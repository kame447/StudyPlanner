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
  AcceptedTaskDurationAssumption,
  BehaviorAwarePlanningBridgeResult,
} from '../planning/weeklyPlanningBehaviorAwarePreviewBridge';
import type { AllowedDialogueAction } from '../planning/weeklyPlanningBehaviorTypes';
import {
  applyDraftGenerationAuthorizationTurn,
} from '../planning/weeklyPlanningDraftGenerationAuthorization';
import { markAssistantSuggested } from '../planning/weeklyPlanningAssumptionLifecycle';
import {
  createFeasibilityDialogueActions,
  createFeasibilitySummary,
  type FeasibilitySummary,
} from '../planning/weeklyPlanningFeasibility';
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
  feasibility: FeasibilitySummary;
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

function mergeActions(
  primary: readonly AllowedDialogueAction[],
  additional: readonly AllowedDialogueAction[],
): AllowedDialogueAction[] {
  const byId = new Map<string, AllowedDialogueAction>();
  [...primary, ...additional].forEach((action) => {
    if (!byId.has(action.actionId)) byId.set(action.actionId, action);
  });
  return Array.from(byId.values()).slice(0, 3);
}

function behaviorDialogueInput(params: {
  base: WeeklyPlanningIntakePipelineOutput;
  behavior: BehaviorAwarePlanningBridgeResult;
  actions: AllowedDialogueAction[];
  input: WeeklyPlanningIntakePipelineInput;
}): BehaviorAwareDialoguePlannerInput {
  return {
    snapshot: params.behavior.snapshot,
    allowedActions: params.actions,
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
  if (params.base.state.examPrepScope) return params.base;
  return {
    ...params.base,
    state: applyDraftGenerationAuthorizationTurn({
      state: params.base.state,
      userText: params.userText,
    }),
  };
}

function acceptedDurationAssumptions(
  base: WeeklyPlanningIntakePipelineOutput,
): AcceptedTaskDurationAssumption[] {
  return (base.assumptionProposalState?.records ?? []).flatMap((record) => {
    if (record.status !== 'accepted' || record.slot !== 'duration' || typeof record.proposedValue !== 'number') {
      return [];
    }
    const minutes = record.proposedUnit === 'hours'
      ? record.proposedValue * 60
      : record.proposedValue;
    if (!Number.isFinite(minutes) || minutes <= 0 || !/^task:\d+$/.test(record.targetRef)) return [];
    return [{
      taskRef: record.targetRef,
      minutes,
      proposalRef: record.proposalId,
      sourceFactRefs: [...record.sourceFactRefs],
    }];
  });
}

function runBehavior(params: {
  base: WeeklyPlanningIntakePipelineOutput;
  input: WeeklyPlanningIntakePipelineInput;
  options: WeeklyPlanningBehaviorAwarePipelineOptions;
}): BehaviorAwarePlanningBridgeResult {
  return runHardenedBehaviorAwarePlanningPreviewBridge({
    state: params.base.state,
    currentUserText: params.input.userText,
    conversationId: params.options.conversationId,
    planningStartDate: params.input.planningStartDate,
    planningDayCount: params.input.planningDayCount,
    sessionPolicy: params.input.sessionPolicy,
    existingPlans: params.input.existingPlans,
    scheduleTemplates: params.input.scheduleTemplates,
    timetableTermId: params.input.timetableTermId,
    existingPlanBufferMinutes: params.input.existingPlanBufferMinutes,
    acceptedTaskDurationAssumptions: acceptedDurationAssumptions(params.base),
  });
}

async function finalizeBehaviorAwareOutput(params: {
  base: WeeklyPlanningIntakePipelineOutput;
  input: WeeklyPlanningIntakePipelineInput;
  options: WeeklyPlanningBehaviorAwarePipelineOptions;
}): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  let currentBase = applyNonExamDraftAuthorization({
    base: params.base,
    userText: params.input.userText,
  });
  let behavior = runBehavior({ base: currentBase, input: params.input, options: params.options });

  if (!currentBase.state.examPrepScope
    && currentBase.state.draftGenerationIntent !== 'user_authorized'
    && behavior.actions.some((action) => action.kind === 'suggest_draft_generation')) {
    currentBase = {
      ...currentBase,
      state: markAssistantSuggested(currentBase.state),
    };
    behavior = runBehavior({ base: currentBase, input: params.input, options: params.options });
  }

  const feasibility = createFeasibilitySummary({
    diagnostics: behavior.draftRun?.diagnostics ?? currentBase.diagnostics,
    stateRevision: behavior.snapshot.stateRevision,
    previewId: behavior.draftRun ? `behavior-preview:${behavior.snapshot.stateRevision}` : undefined,
    pendingAssumption: acceptedDurationAssumptions(currentBase).length > 0,
    supported: true,
    bottleneckFactRefs: behavior.snapshot.readiness.blockingDimensions.map((dimension) =>
      `planning-dimension:${dimension}`,
    ),
  });
  const actions = mergeActions(behavior.actions, createFeasibilityDialogueActions(feasibility));
  behavior = { ...behavior, actions };
  const behaviorDialogue = await selectDialoguePlanner(params.options).plan(
    behaviorDialogueInput({ base: currentBase, behavior, actions, input: params.input }),
  );

  if (currentBase.state.examPrepScope) {
    return { ...currentBase, behavior, behaviorDialogue, feasibility };
  }

  return {
    ...currentBase,
    draftCandidates: behavior.draftRun?.candidates ?? null,
    diagnostics: behavior.draftRun?.diagnostics ?? null,
    behavior,
    behaviorDialogue,
    feasibility,
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
