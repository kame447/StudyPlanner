import {
  createAiBehaviorAwareWeeklyPlanningDialoguePlanner,
  createDeterministicBehaviorAwareDialoguePlanner,
  type BehaviorAwareDialoguePlannerInput,
  type BehaviorAwareDialoguePlannerResult,
} from '../dialogue/weeklyPlanningBehaviorAwareDialoguePlanner';
import { createLifecycleAwareWeeklyPlanningInterpreter } from '../intake/weeklyPlanningLifecycleInterpreter';
import {
  createAssumptionProposalSessionState,
  type AssumptionProposalCanonicalizationContext,
  type AssumptionProposalRecord,
} from '../intake/weeklyPlanningAssumptionProposals';
import type {
  InterpreterCorrectionTargetSummary,
  InterpreterPendingAssumptionSummary,
  WeeklyPlanningInterpreterResult,
  WeeklyPlanningIntakeInterpreter,
} from '../intake/weeklyPlanningInterpreterTypes';
import { runHardenedBehaviorAwarePlanningPreviewBridge } from '../planning/weeklyPlanningBehaviorAwarePreviewBridgeHardened';
import type {
  AcceptedTaskDurationAssumption,
  BehaviorAwarePlanningBridgeResult,
} from '../planning/weeklyPlanningBehaviorAwarePreviewBridge';
import type { AllowedDialogueAction } from '../planning/weeklyPlanningBehaviorTypes';
import { applyDraftGenerationAuthorizationTurn } from '../planning/weeklyPlanningDraftGenerationAuthorization';
import {
  applyAssumptionDecision,
  applyCorrectionEnvelopes,
  markAssistantSuggested,
  validateAssumptionDecisionCommand,
  type CorrectionEnvelope,
} from '../planning/weeklyPlanningAssumptionLifecycle';
import {
  createFeasibilityDialogueActions,
  createFeasibilitySummary,
  type FeasibilitySummary,
} from '../planning/weeklyPlanningFeasibility';
import {
  prepareWeeklyPlanningTraceOptions,
  recordWeeklyPlanningPipelineTrace,
} from '../trace/weeklyPlanningTraceRuntime';
import {
  runWeeklyPlanningIntakePipeline,
  runWeeklyPlanningIntakePipelineWithInterpreter,
  type WeeklyPlanningIntakePipelineInput,
  type WeeklyPlanningIntakePipelineOutput,
  type WeeklyPlanningIntakePipelineWithInterpreterInput,
} from './weeklyPlanningIntakePipeline';

export interface WeeklyPlanningLifecycleDiagnostics {
  acceptedDecisionCount: number;
  rejectedDecisions: Array<{ value: unknown; reason: string }>;
  acceptedCorrectionCount: number;
  rejectedCorrections: Array<{ value: unknown; reason: string }>;
}

export interface WeeklyPlanningBehaviorAwarePipelineOutput extends WeeklyPlanningIntakePipelineOutput {
  behavior: BehaviorAwarePlanningBridgeResult;
  behaviorDialogue: BehaviorAwareDialoguePlannerResult;
  feasibility: FeasibilitySummary;
  lifecycleDiagnostics?: WeeklyPlanningLifecycleDiagnostics;
}

export interface BehaviorAwareDialoguePlanner {
  plan(input: BehaviorAwareDialoguePlannerInput): Promise<BehaviorAwareDialoguePlannerResult>;
}

export interface WeeklyPlanningBehaviorAwarePipelineOptions {
  conversationId?: string;
  traceRequestId?: string;
  userId?: string;
  dialoguePlanner?: BehaviorAwareDialoguePlanner;
  useAiDialoguePlanner?: boolean;
}

function getConversationId(options: WeeklyPlanningBehaviorAwarePipelineOptions): string {
  return options.conversationId?.trim() || 'weekly-planning-session';
}

function cloneProposalRecords(records: readonly AssumptionProposalRecord[]): AssumptionProposalRecord[] {
  return records.map((record) => ({
    ...record,
    sourceFactRefs: [...record.sourceFactRefs],
    ...(record.resolvedBy ? { resolvedBy: { ...record.resolvedBy } } : {}),
  }));
}

function proposalRecords(input: WeeklyPlanningIntakePipelineInput): AssumptionProposalRecord[] {
  return cloneProposalRecords(
    input.previousAssumptionProposalState?.records
      ?? input.previousState?.assumptionProposalRecords
      ?? input.assumptionProposalContext?.existingProposalRecords
      ?? [],
  );
}

function createSessionProposalContext(
  input: WeeklyPlanningIntakePipelineInput,
  options: WeeklyPlanningBehaviorAwarePipelineOptions,
  records: readonly AssumptionProposalRecord[],
): AssumptionProposalCanonicalizationContext {
  const conversationId = getConversationId(options);
  const stateRevision = (input.previousState?.sourceTurns.length ?? 0) + 1;
  const userId = options.userId?.trim() || 'session-local-user';
  const taskRefs = (input.previousState?.tasks ?? []).map((_, index) => `task:${index}`);
  const validTargetRefs = [
    ...taskRefs,
    ...(input.previousState?.range ? ['planning-range:current'] : []),
    ...(input.previousState?.priorityPolicy.kind !== 'unknown' ? ['priority:current'] : []),
  ];
  return {
    authorization: { userId },
    conversationId,
    turnId: `${conversationId}:turn:${stateRevision}`,
    stateRevision,
    validTargetRefs,
    currentPublicSourceFacts: taskRefs.map((factId) => ({
      factId,
      userId,
      conversationId,
      stateRevision,
      visibility: 'public',
    })),
    allowedPolicyIds: ['domain-default', 'first-trial'],
    existingProposalRecords: cloneProposalRecords(records),
  };
}

function withSessionProposalContext<T extends WeeklyPlanningIntakePipelineInput>(
  input: T,
  options: WeeklyPlanningBehaviorAwarePipelineOptions,
): T {
  const records = proposalRecords(input);
  return {
    ...input,
    previousAssumptionProposalState: createAssumptionProposalSessionState(records),
    assumptionProposalContext: input.assumptionProposalContext
      ?? createSessionProposalContext(input, options, records),
  } as T;
}

function constraintSummary(output: WeeklyPlanningIntakePipelineOutput): string[] {
  return output.state.constraints.map((constraint) =>
    [constraint.kind, constraint.date, constraint.start, constraint.end, constraint.studyAvailableStart]
      .filter(Boolean)
      .join(' '),
  );
}

function planningPeriodLabel(output: WeeklyPlanningIntakePipelineOutput): string | undefined {
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
  [...additional, ...primary].forEach((action) => {
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

function selectDialoguePlanner(options: WeeklyPlanningBehaviorAwarePipelineOptions): BehaviorAwareDialoguePlanner {
  if (options.dialoguePlanner) return options.dialoguePlanner;
  if (options.useAiDialoguePlanner) return createAiBehaviorAwareWeeklyPlanningDialoguePlanner();
  return createDeterministicBehaviorAwareDialoguePlanner();
}

function applyNonExamDraftAuthorization(params: {
  base: WeeklyPlanningIntakePipelineOutput;
  userText: string;
}): WeeklyPlanningIntakePipelineOutput {
  if (params.base.state.examPrepScope || params.base.state.draftGenerationIntent === 'user_authorized') {
    return params.base;
  }
  return {
    ...params.base,
    state: applyDraftGenerationAuthorizationTurn({ state: params.base.state, userText: params.userText }),
  };
}

function acceptedDurationAssumptions(base: WeeklyPlanningIntakePipelineOutput): AcceptedTaskDurationAssumption[] {
  const records = base.assumptionProposalState?.records ?? base.state.assumptionProposalRecords ?? [];
  return records.flatMap((record) => {
    if (record.status !== 'accepted' || record.slot !== 'duration' || typeof record.proposedValue !== 'number') {
      return [];
    }
    const minutes = record.proposedUnit === 'hours' ? record.proposedValue * 60 : record.proposedValue;
    if (!Number.isFinite(minutes) || minutes <= 0 || !/^task:\d+$/.test(record.targetRef)) return [];
    return [{
      taskRef: record.targetRef,
      minutes,
      proposalRef: record.proposalId,
      proposalCreatedFromStateRevision: record.createdFromStateRevision,
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
    conversationId: getConversationId(params.options),
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

function pendingAssumptionSummaries(input: WeeklyPlanningIntakePipelineInput): InterpreterPendingAssumptionSummary[] {
  return proposalRecords(input).filter((record) => record.status === 'pending').map((record) => ({
    proposalId: record.proposalId,
    slot: record.slot,
    targetRef: record.targetRef,
    proposedValue: record.proposedValue,
    ...(record.proposedUnit ? { proposedUnit: record.proposedUnit } : {}),
  }));
}

function correctionTargetSummaries(input: WeeklyPlanningIntakePipelineInput): InterpreterCorrectionTargetSummary[] {
  const state = input.previousState;
  if (!state) return [];
  return [
    ...state.tasks.map((task, index) => ({ kind: 'task' as const, ref: `task:${index}`, label: task.title })),
    ...state.constraints.map((constraint, index) => ({
      kind: 'constraint' as const,
      ref: `constraint:${index}`,
      label: constraint.rawText ?? constraint.kind,
    })),
    ...(state.range ? [{ kind: 'planning_range' as const, ref: 'current', label: state.range.sourceText ?? '計画期間' }] : []),
    ...(state.priorityPolicy.kind !== 'unknown'
      ? [{ kind: 'priority' as const, ref: 'current', label: '優先順位' }]
      : []),
    ...proposalRecords(input).filter((record) => record.status === 'pending').map((record) => ({
      kind: 'proposal' as const,
      ref: record.proposalId,
      label: `${record.slot}:${record.targetRef}`,
    })),
  ];
}

function isCorrectionEnvelope(value: unknown): value is CorrectionEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const target = record.target;
  return typeof record.correctionId === 'string'
    && typeof record.conversationId === 'string'
    && Number.isInteger(record.expectedStateRevision)
    && ['replace', 'remove', 'supersede', 'restore'].includes(String(record.operation))
    && typeof record.sourceText === 'string'
    && Boolean(target && typeof target === 'object' && !Array.isArray(target));
}

function synchronizeProposalRecords(
  base: WeeklyPlanningIntakePipelineOutput,
  records: readonly AssumptionProposalRecord[],
): WeeklyPlanningIntakePipelineOutput {
  const clonedRecords = cloneProposalRecords(records);
  return {
    ...base,
    state: {
      ...base.state,
      assumptionProposalRecords: clonedRecords,
    },
    assumptionProposalState: createAssumptionProposalSessionState(clonedRecords),
  };
}

function applyLifecycleResult(params: {
  base: WeeklyPlanningIntakePipelineOutput;
  input: WeeklyPlanningIntakePipelineInput;
  options: WeeklyPlanningBehaviorAwarePipelineOptions;
  result?: WeeklyPlanningInterpreterResult;
}): WeeklyPlanningIntakePipelineOutput & { lifecycleDiagnostics?: WeeklyPlanningLifecycleDiagnostics } {
  let records = cloneProposalRecords(params.base.assumptionProposalState?.records ?? proposalRecords(params.input));
  if (!params.result) return synchronizeProposalRecords(params.base, records);

  const conversationId = getConversationId(params.options);
  const currentStateRevision = params.input.previousState?.sourceTurns.length ?? 0;
  const context = {
    conversationId,
    turnId: `${conversationId}:turn:${currentStateRevision + 1}`,
    currentStateRevision,
  };
  const rejectedDecisions: Array<{ value: unknown; reason: string }> = [];
  let acceptedDecisionCount = 0;
  for (const value of params.result.assumptionDecisions ?? []) {
    const validation = validateAssumptionDecisionCommand(value, records, context);
    if (!validation.accepted) {
      rejectedDecisions.push({ value, reason: validation.reason });
      continue;
    }
    const applied = applyAssumptionDecision({ records, validation, context });
    records = applied.records;
    acceptedDecisionCount += 1;
  }

  const correctionValues = params.result.correctionEnvelopes ?? [];
  const validCorrections = correctionValues.filter(isCorrectionEnvelope);
  const rejectedCorrections = correctionValues
    .filter((value) => !isCorrectionEnvelope(value))
    .map((value) => ({ value, reason: 'invalid-correction-envelope' }));
  const correctionResult = applyCorrectionEnvelopes({
    state: params.base.state,
    records,
    envelopes: validCorrections,
    context,
  });
  records = correctionResult.records;
  rejectedCorrections.push(...correctionResult.rejected.map((item) => ({
    value: item.envelope,
    reason: item.reason,
  })));
  const state = correctionResult.previewStale
    ? { ...correctionResult.state, sourceTurns: [...params.base.state.sourceTurns] }
    : params.base.state;
  const synchronized = synchronizeProposalRecords({ ...params.base, state }, records);
  return {
    ...synchronized,
    lifecycleDiagnostics: {
      acceptedDecisionCount,
      rejectedDecisions,
      acceptedCorrectionCount: correctionResult.accepted.length,
      rejectedCorrections,
    },
  };
}

async function finalizeBehaviorAwareOutput(params: {
  base: WeeklyPlanningIntakePipelineOutput & { lifecycleDiagnostics?: WeeklyPlanningLifecycleDiagnostics };
  input: WeeklyPlanningIntakePipelineInput;
  options: WeeklyPlanningBehaviorAwarePipelineOptions;
}): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  let currentBase = applyNonExamDraftAuthorization({ base: params.base, userText: params.input.userText });
  let behavior = runBehavior({ base: currentBase, input: params.input, options: params.options });
  if (!currentBase.state.examPrepScope
    && currentBase.state.draftGenerationIntent !== 'user_authorized'
    && behavior.actions.some((action) => action.kind === 'suggest_draft_generation')) {
    currentBase = { ...currentBase, state: markAssistantSuggested(currentBase.state) };
    behavior = runBehavior({ base: currentBase, input: params.input, options: params.options });
  }

  const feasibility = createFeasibilitySummary({
    diagnostics: behavior.draftRun?.diagnostics ?? currentBase.diagnostics,
    stateRevision: behavior.snapshot.stateRevision,
    previewId: behavior.draftRun ? `behavior-preview:${behavior.snapshot.stateRevision}` : undefined,
    pendingAssumption: false,
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
  const common = {
    ...currentBase,
    behavior,
    behaviorDialogue,
    feasibility,
    ...(params.base.lifecycleDiagnostics ? { lifecycleDiagnostics: params.base.lifecycleDiagnostics } : {}),
  };
  if (currentBase.state.examPrepScope) return common;
  return {
    ...common,
    draftCandidates: behavior.draftRun?.candidates ?? null,
    diagnostics: behavior.draftRun?.diagnostics ?? null,
  };
}

export async function runWeeklyPlanningBehaviorAwarePipeline(
  rawInput: WeeklyPlanningIntakePipelineInput,
  rawOptions: WeeklyPlanningBehaviorAwarePipelineOptions = {},
): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  const options = prepareWeeklyPlanningTraceOptions(rawInput, rawOptions);
  const input = withSessionProposalContext(rawInput, options);
  const base = synchronizeProposalRecords(runWeeklyPlanningIntakePipeline(input), proposalRecords(input));
  const output = await finalizeBehaviorAwareOutput({ base, input, options });
  recordWeeklyPlanningPipelineTrace({ input, options, output });
  return output;
}

export async function runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
  rawInput: WeeklyPlanningIntakePipelineWithInterpreterInput,
  rawOptions: WeeklyPlanningBehaviorAwarePipelineOptions = {},
): Promise<WeeklyPlanningBehaviorAwarePipelineOutput> {
  const options = prepareWeeklyPlanningTraceOptions(rawInput, rawOptions);
  const input = withSessionProposalContext(rawInput, options);
  let capturedResult: WeeklyPlanningInterpreterResult | undefined;
  const conversationId = getConversationId(options);
  const lifecycleInterpreter: WeeklyPlanningIntakeInterpreter | undefined = input.interpreter
    ? (() => {
        const decorated = createLifecycleAwareWeeklyPlanningInterpreter({
          interpreter: input.interpreter as WeeklyPlanningIntakeInterpreter,
          conversationId,
          currentStateRevision: input.previousState?.sourceTurns.length ?? 0,
          pendingAssumptions: pendingAssumptionSummaries(input),
          correctionTargets: correctionTargetSummaries(input),
        });
        return {
          async interpretUserTurn(params) {
            const result = await decorated.interpretUserTurn(params);
            capturedResult = result;
            return result;
          },
        } satisfies WeeklyPlanningIntakeInterpreter;
      })()
    : undefined;
  const base = await runWeeklyPlanningIntakePipelineWithInterpreter({
    ...input,
    ...(lifecycleInterpreter ? { interpreter: lifecycleInterpreter } : {}),
  });
  const lifecycleBase = applyLifecycleResult({ base, input, options, result: capturedResult });
  const output = await finalizeBehaviorAwareOutput({ base: lifecycleBase, input, options });
  recordWeeklyPlanningPipelineTrace({ input, options, output });
  return output;
}

export function hasAllowedDialogueAction(
  output: WeeklyPlanningBehaviorAwarePipelineOutput,
  kind: AllowedDialogueAction['kind'],
): boolean {
  return output.behavior.actions.some((action) => action.kind === kind);
}
