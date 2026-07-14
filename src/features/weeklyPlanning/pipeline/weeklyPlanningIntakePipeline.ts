import {
  createMissingQuestionPlan,
  createWeeklyPlanningClarificationDecision,
  createWeeklyPlanningDialogueDecision,
  type WeeklyPlanningDialogueDecision,
} from '../dialogue/weeklyPlanningDialogueManager';
import {
  createAssumedWeeklyDraftRequest,
  createWeeklyDraftRequestFromIntakeState,
  type AssumedWeeklyDraftRequest,
  type WeeklyPlanningDraftRequest,
} from '../intake/weeklyPlanningDraftRequestAdapter';
import {
  applyWeeklyPlanningCommands,
  applyWeeklyPlanningUserTurn,
  beginWeeklyPlanningUserTurn,
  applyWeeklyPlanningUserTurnWithDiagnostics,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeState, PlanningRange, WeeklyPlanningIntakeContext } from '../intake/weeklyPlanningIntakeTypes';
import {
  finalizeState,
  hasConfirmedFixedEvents,
  hasConfirmedLifeConstraints,
} from '../intake/weeklyPlanningMissingStatus';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import {
  normalizeSetPendingPlanningRangeCommand,
  toPlanningRangeFromSetPlanningRangeCommand,
} from '../intake/weeklyPlanningCommandAdapter';
import { resolveConstraintSourceReferences } from '../intake/weeklyPlanningReferenceResolution';
import type {
  CandidateValidationResult,
  ConstraintSourceAvailability,
  PlannerCapabilitySnapshot,
  InterpreterRecentTurn,
  WeeklyPlanningIntakeInterpreter,
  InterpreterStateSummary,
} from '../intake/weeklyPlanningInterpreterTypes';
import {
  createRemainingWorkItemsFromDraftRequest,
  type WeeklyPlanningRemainingWorkItemsResult,
} from '../intake/weeklyPlanningRemainingWorkItems';
import type { Plan, ScheduleTemplate } from '../../../types/domain';
import {
  canonicalizeAssumptionProposalDrafts,
  createAssumptionProposalSessionState,
  type AssumptionProposalCanonicalizationContext,
  type AssumptionProposalSessionState,
  type PendingAssumptionProposal,
} from '../intake/weeklyPlanningAssumptionProposals';
import {
  createWeeklyDraftCandidatesFromRemainingWorkItems,
  type WeeklyDraftCandidate,
  type WeeklyDraftCandidateDiagnostics,
  type WeeklyDraftCandidateSessionPolicy,
} from '../scheduling/weeklyDraftCandidateGenerator';

export interface WeeklyPlanningIntakePipelineInput {
  previousState?: PlanningIntakeState;
  previousAssumptionProposalState?: AssumptionProposalSessionState;
  assumptionProposalContext?: AssumptionProposalCanonicalizationContext;
  userText: string;
  recentTurns?: InterpreterRecentTurn[];
  planningStartDate: string;
  planningDayCount: number;
  sessionPolicy?: Partial<WeeklyDraftCandidateSessionPolicy>;
  currentDateTime?: string;
  existingPlans?: Plan[];
  scheduleTemplates?: ScheduleTemplate[];
  timetableTermId?: string;
  existingPlanBufferMinutes?: number;
}

export interface WeeklyPlanningIntakePipelineWithInterpreterInput extends WeeklyPlanningIntakePipelineInput {
  interpreter?: WeeklyPlanningIntakeInterpreter;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function currentLocalDateTime(): string {
  const now = new Date();
  return now.getFullYear()
    + '-' + padDatePart(now.getMonth() + 1)
    + '-' + padDatePart(now.getDate())
    + 'T' + padDatePart(now.getHours())
    + ':' + padDatePart(now.getMinutes())
    + ':00';
}

function resolveCurrentDateTime(input: WeeklyPlanningIntakePipelineInput): string {
  return input.currentDateTime ?? currentLocalDateTime();
}

function initialAssumptionProposalState(
  input: WeeklyPlanningIntakePipelineInput,
): AssumptionProposalSessionState | undefined {
  if (!input.assumptionProposalContext) {
    return undefined;
  }

  return createAssumptionProposalSessionState(
    input.previousAssumptionProposalState?.records
      ?? input.assumptionProposalContext.existingProposalRecords,
  );
}

function minutesFromTime(time: string): number {
  const [hour = '0', minute = '0'] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

function maxTime(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return minutesFromTime(left) >= minutesFromTime(right) ? left : right;
}

function dateDiffDays(startDate: string, endDate: string): number {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function planningDayCountFromRange(range: PlanningRange, fallback: number): number {
  if (!range.startDateTime || !range.endDateTime) return fallback;
  const startDate = range.startDateTime.slice(0, 10);
  const endDate = range.endDateTime.slice(0, 10);
  return Math.max(1, dateDiffDays(startDate, endDate) + 1);
}

function resolveSchedulingInput(
  input: WeeklyPlanningIntakePipelineInput,
  state: PlanningIntakeState,
  overrides?: { planningStartDate?: string },
): {
  planningStartDate: string;
  planningDayCount: number;
  sessionPolicy?: Partial<WeeklyDraftCandidateSessionPolicy>;
} {
  const rangeStartDateTime = state.range?.startDateTime;
  const usesResolvedCalendarWindow = Boolean(state.range?.calendarDayCount);
  const resolvedPlanningStartDate = usesResolvedCalendarWindow && rangeStartDateTime
    ? rangeStartDateTime.slice(0, 10)
    : input.planningStartDate;
  const planningStartDate = overrides?.planningStartDate ?? resolvedPlanningStartDate;
  const rangeStartTime = rangeStartDateTime?.slice(11, 16);
  const planningDayCount = state.range?.calendarDayCount
    ?? (usesResolvedCalendarWindow ? planningDayCountFromRange(state.range as PlanningRange, input.planningDayCount) : input.planningDayCount);
  const sessionPolicy = {
    ...input.sessionPolicy,
    firstDayStartTime: maxTime(input.sessionPolicy?.firstDayStartTime, rangeStartTime),
  };

  return { planningStartDate, planningDayCount, sessionPolicy };
}

function createDraftRun(
  input: WeeklyPlanningIntakePipelineInput,
  draftRequest: WeeklyPlanningDraftRequest,
  schedulingInput: {
    planningStartDate: string;
    planningDayCount: number;
    sessionPolicy?: Partial<WeeklyDraftCandidateSessionPolicy>;
  },
): {
  remainingWorkItems: WeeklyPlanningRemainingWorkItemsResult;
  candidates: WeeklyDraftCandidate[];
  diagnostics: WeeklyDraftCandidateDiagnostics;
} {
  const remainingWorkItems = createRemainingWorkItemsFromDraftRequest(draftRequest);
  const dryRun = createWeeklyDraftCandidatesFromRemainingWorkItems({
    remainingWorkItems: remainingWorkItems.items,
    constraints: draftRequest.constraints,
    fixedEvents: draftRequest.fixedEvents,
    planningStartDate: schedulingInput.planningStartDate,
    planningDayCount: schedulingInput.planningDayCount,
    sessionPolicy: schedulingInput.sessionPolicy,
    existingPlans: input.existingPlans,
    scheduleTemplates: input.scheduleTemplates,
    timetableTermId: input.timetableTermId,
    existingPlanBufferMinutes: input.existingPlanBufferMinutes,
  });

  return {
    remainingWorkItems,
    candidates: dryRun.candidates,
    diagnostics: dryRun.diagnostics,
  };
}

export interface WeeklyPlanningAssumedDraft {
  draftRequest: WeeklyPlanningDraftRequest;
  assumptions: AssumedWeeklyDraftRequest['assumptions'];
  candidates: WeeklyDraftCandidate[];
  diagnostics: WeeklyDraftCandidateDiagnostics;
}

export interface WeeklyPlanningAssumptionProposalDiagnostics {
  accepted: PendingAssumptionProposal[];
  rejected: Array<{ draft: unknown; reason: string }>;
}

export interface WeeklyPlanningIntakePipelineOutput {
  state: PlanningIntakeState;
  draftRequest: WeeklyPlanningDraftRequest | null;
  remainingWorkItems: WeeklyPlanningRemainingWorkItemsResult | null;
  draftCandidates: WeeklyDraftCandidate[] | null;
  diagnostics: WeeklyDraftCandidateDiagnostics | null;
  /** Stage 2 の仮定つき dry-run。既存preview block経路へ昇格する。 */
  assumedDraft?: WeeklyPlanningAssumedDraft;
  decision: WeeklyPlanningDialogueDecision;
  interpreterDiagnostics?: CandidateValidationResult;
  assumptionProposalState?: AssumptionProposalSessionState;
  assumptionProposalRefs?: string[];
  assumptionProposalDiagnostics?: WeeklyPlanningAssumptionProposalDiagnostics;
}

function buildPipelineOutput(params: {
  input: WeeklyPlanningIntakePipelineInput;
  state: PlanningIntakeState;
  interpreterDiagnostics?: CandidateValidationResult;
  assumptionProposalState?: AssumptionProposalSessionState;
  assumptionProposalRefs?: string[];
  assumptionProposalDiagnostics?: WeeklyPlanningAssumptionProposalDiagnostics;
}): WeeklyPlanningIntakePipelineOutput {
  const { input, state } = params;
  const draftRequest = createWeeklyDraftRequestFromIntakeState(state);
  const schedulingInput = resolveSchedulingInput(input, state);
  const confirmedDraftRun = draftRequest
    ? createDraftRun(input, draftRequest, schedulingInput)
    : null;
  const assumedDraftRequest = draftRequest
    ? null
    : createAssumedWeeklyDraftRequest(state, {
      currentDateTime: resolveCurrentDateTime(input),
    });
  const assumedDraftRun = assumedDraftRequest
    ? createDraftRun(
      input,
      assumedDraftRequest.draftRequest,
      resolveSchedulingInput(input, state, {
        planningStartDate: assumedDraftRequest.planningStartDate,
      }),
    )
    : null;
  const assumedDraft = assumedDraftRequest && assumedDraftRun
    ? {
      draftRequest: assumedDraftRequest.draftRequest,
      assumptions: assumedDraftRequest.assumptions,
      candidates: assumedDraftRun.candidates,
      diagnostics: assumedDraftRun.diagnostics,
    }
    : undefined;
  const previewCandidates = confirmedDraftRun?.candidates ?? assumedDraft?.candidates ?? null;
  const previewDiagnostics = confirmedDraftRun?.diagnostics ?? assumedDraft?.diagnostics ?? null;
  const decision = createWeeklyPlanningDialogueDecision({
    state,
    draftRequest,
    remainingWorkItems: confirmedDraftRun?.remainingWorkItems ?? null,
    dryRunCandidates: previewCandidates,
    dryRunDiagnostics: previewDiagnostics,
    assumedDraft,
  });
  const output: WeeklyPlanningIntakePipelineOutput = {
    state,
    draftRequest,
    remainingWorkItems: confirmedDraftRun?.remainingWorkItems ?? null,
    draftCandidates: previewCandidates,
    diagnostics: previewDiagnostics,
    decision,
  };

  if (assumedDraft) {
    output.assumedDraft = assumedDraft;
  }

  if (params.interpreterDiagnostics) {
    output.interpreterDiagnostics = params.interpreterDiagnostics;
  }

  if (params.assumptionProposalState) {
    output.assumptionProposalState = params.assumptionProposalState;
  }
  if (params.assumptionProposalRefs) {
    output.assumptionProposalRefs = params.assumptionProposalRefs;
  }
  if (params.assumptionProposalDiagnostics) {
    output.assumptionProposalDiagnostics = params.assumptionProposalDiagnostics;
  }
  return output;
}

export function runWeeklyPlanningIntakePipeline(
  input: WeeklyPlanningIntakePipelineInput,
): WeeklyPlanningIntakePipelineOutput {
  const previousState = input.previousState ?? createInitialPlanningIntakeState();
  const state = applyWeeklyPlanningUserTurn(previousState, input.userText, {
    selectedDate: input.planningStartDate,
    planningDayCount: input.planningDayCount,
    currentDateTime: resolveCurrentDateTime(input),
  });

  return buildPipelineOutput({
    input,
    state,
    assumptionProposalState: initialAssumptionProposalState(input),
  });
}

function confirmedSlotsFromState(state: PlanningIntakeState): string[] {
  const slots: string[] = [];

  if (state.range) slots.push('planning_range');
  if (state.examPrepScope) slots.push('exam_scope');
  if (state.examPrepScope?.yearRange) slots.push('year_range');
  if (state.unitRates.length > 0) slots.push('unit_duration_estimate');
  if (state.priorityPolicy.kind !== 'unknown') slots.push('priority_policy');
  if (state.progress.some((progress) => progress.completedYears?.length || progress.completionBoundaryYear)) {
    slots.push('progress');
  }
  if (hasConfirmedFixedEvents(state)) slots.push('fixed_events');
  if (hasConfirmedLifeConstraints(state)) slots.push('life_constraints');

  return Array.from(new Set(slots));
}

function createPlannerCapabilitySnapshot(
  input: WeeklyPlanningIntakePipelineInput,
): PlannerCapabilitySnapshot {
  const termId = input.timetableTermId ?? 'default';
  const hasActiveTimetable = (input.scheduleTemplates ?? []).some(
    (template) => (template.termId || 'default') === termId,
  );

  return {
    hasActiveTimetable,
    existingPlanCount: (input.existingPlans ?? []).length,
  };
}

function toConstraintSourceAvailability(
  snapshot: PlannerCapabilitySnapshot,
): ConstraintSourceAvailability {
  const hasExistingPlans = snapshot.existingPlanCount > 0;

  // 現在 active な参照元は timetable と existing_plans のみ。
  // calendar(Google/Apple/Outlook 等の外部連携)は未実装のため、常に利用不可として扱う
  // (将来拡張用の内部型は残すが、現在の AI に利用可能と誤認させない)。
  return {
    timetable: snapshot.hasActiveTimetable,
    existingPlans: hasExistingPlans,
    calendar: false,
  };
}

function createInterpreterStateSummary(
  state: PlanningIntakeState,
  snapshot: PlannerCapabilitySnapshot,
  previousState?: PlanningIntakeState,
): InterpreterStateSummary {
  return {
    knownFields: state.examPrepScope?.fields ?? [],
    confirmedSlots: confirmedSlotsFromState(state),
    lastQuestions: previousState
      ? createMissingQuestionPlan(previousState).map((question) => ({
          slotKey: question.targetSlot,
          intent: question.intent,
        }))
      : undefined,
    planningRangeSummary: state.range
      ? [state.range.startDateTime, state.range.endDateTime].filter(Boolean).join('〜')
      : undefined,
    pendingPlanningRange: state.pendingPlanningRange
      ? {
          label: state.pendingPlanningRange.scope.label,
          startDate: state.pendingPlanningRange.scope.startDate,
          endDate: state.pendingPlanningRange.scope.endDate,
        }
      : undefined,
    availableConstraintSources: toConstraintSourceAvailability(snapshot),
  };
}

function createInterpreterContext(input: WeeklyPlanningIntakePipelineInput): WeeklyPlanningIntakeContext {
  return {
    selectedDate: input.planningStartDate,
    planningDayCount: input.planningDayCount,
    currentDateTime: resolveCurrentDateTime(input),
  };
}

function addConfirmationAssumptions(
  state: PlanningIntakeState,
  validation: CandidateValidationResult,
): PlanningIntakeState {
  if (validation.acceptedWithConfirmation.length === 0) {
    return state;
  }

  const assumptions = validation.acceptedWithConfirmation.map((command) =>
    command.type === 'set_planning_range'
      ? 'AI が set_planning_range として解釈しましたが、開始日の確認中のため適用前に確認が必要です。'
      : `AI が ${command.type} として解釈しましたが、確信度が中程度のため確認が必要です。`,
  );

  return {
    ...state,
    assumptions: Array.from(new Set([...state.assumptions, ...assumptions])),
  };
}

const CONSTRAINT_SOURCE_UNAVAILABLE_NOTE =
  '指定された予定表・カレンダーに該当する予定が見つかりませんでした。動かせない予定があれば教えてください。';

function addConstraintSourceConfirmationAssumptions(
  state: PlanningIntakeState,
  unavailableSourceCount: number,
): PlanningIntakeState {
  if (unavailableSourceCount === 0) {
    return state;
  }

  return {
    ...state,
    assumptions: Array.from(new Set([...state.assumptions, CONSTRAINT_SOURCE_UNAVAILABLE_NOTE])),
  };
}

export async function runWeeklyPlanningIntakePipelineWithInterpreter(
  input: WeeklyPlanningIntakePipelineWithInterpreterInput,
): Promise<WeeklyPlanningIntakePipelineOutput> {
  if (!input.interpreter) {
    return runWeeklyPlanningIntakePipeline(input);
  }

  const previousState = input.previousState ?? createInitialPlanningIntakeState();
  const context = createInterpreterContext(input);
  const preparedState = beginWeeklyPlanningUserTurn(previousState, input.userText);
  const capabilitySnapshot = createPlannerCapabilitySnapshot(input);
  const stateSummary = createInterpreterStateSummary(
    preparedState,
    capabilitySnapshot,
    input.previousState,
  );
  let interpreterResult;
  const proposalState = initialAssumptionProposalState(input);

  try {
    interpreterResult = await input.interpreter.interpretUserTurn({
      userText: input.userText,
      context,
      stateSummary,
      recentTurns: input.recentTurns,
    });
  } catch {
    // Provider failures switch the whole turn to the existing rules path. Empty AI results do not.
    const fallbackTurn = applyWeeklyPlanningUserTurnWithDiagnostics(
      previousState,
      input.userText,
      context,
    );
    return buildPipelineOutput({
      input,
      state: fallbackTurn.state,
      assumptionProposalState: proposalState,
    });
  }

  const proposalResult = input.assumptionProposalContext && proposalState
    ? canonicalizeAssumptionProposalDrafts(
      interpreterResult.assumptionProposalDrafts ?? [],
      {
        ...input.assumptionProposalContext,
        existingProposalRecords: proposalState.records,
      },
    )
    : undefined;

  const resolvedCandidates = resolveConstraintSourceReferences({
    candidates: interpreterResult.candidates,
    userText: input.userText,
    stateSummary,
  });
  const interpreterDiagnostics = validateInterpretedCandidates(resolvedCandidates, stateSummary);
  interpreterDiagnostics.parseRejections = interpreterResult.parseRejections;

  const clarificationRequest = interpreterDiagnostics.clarificationRequests[0];
  const interpretedCommands = [
    ...interpreterDiagnostics.accepted,
    ...interpreterDiagnostics.acceptedWithConfirmation.filter((command) =>
      !(stateSummary.pendingPlanningRange && command.type === 'set_planning_range'),
    ),
  ].map((command) => {
    if (command.type === 'set_planning_range') {
      return { ...command, range: toPlanningRangeFromSetPlanningRangeCommand(command) };
    }

    if (command.type === 'set_pending_planning_range') {
      return normalizeSetPendingPlanningRangeCommand(command, context);
    }

    return command;
  });
  const unavailableSourceCount = interpreterDiagnostics.rejected.filter(
    (rejection) => rejection.reason === 'constraint-source-unavailable',
  ).length;
  const interpretedState = finalizeState(addConstraintSourceConfirmationAssumptions(
    addConfirmationAssumptions(
      applyWeeklyPlanningCommands(preparedState, interpretedCommands),
      interpreterDiagnostics,
    ),
    unavailableSourceCount,
  ));

  const output = buildPipelineOutput({
    input,
    state: interpretedState,
    interpreterDiagnostics,
    assumptionProposalState: proposalResult?.state ?? proposalState,
    assumptionProposalRefs: proposalResult?.assumptionProposalRefs,
    assumptionProposalDiagnostics: proposalResult
      ? { accepted: proposalResult.accepted, rejected: proposalResult.rejected }
      : undefined,
  });

  if (clarificationRequest) {
    const ref = clarificationRequest.type === 'request_clarification'
      ? clarificationRequest.ref
      : undefined;
    output.decision = createWeeklyPlanningClarificationDecision({
      state: interpretedState,
      ref,
    });
  }

  return output;
}
