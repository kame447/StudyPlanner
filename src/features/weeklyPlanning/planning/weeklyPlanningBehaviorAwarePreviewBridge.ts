import type { Plan, ScheduleTemplate } from '../../../types/domain';
import type {
  LifeConstraint,
  PlanningIntakeState,
  StudyTaskScope,
} from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningRemainingWorkItem } from '../intake/weeklyPlanningRemainingWorkItems';
import {
  createWeeklyDraftCandidatesFromRemainingWorkItems,
  type WeeklyDraftCandidate,
  type WeeklyDraftCandidateDiagnostics,
  type WeeklyDraftCandidateSessionPolicy,
} from '../scheduling/weeklyDraftCandidateGenerator';
import {
  createAllowedDialogueActions,
  createPlanningHypothesisSnapshot,
  evaluatePreviewGate,
  type AvailabilityRangeReference,
} from './weeklyPlanningBehaviorPlanner';
import type {
  AllowedDialogueAction,
  PlanningHypothesisSnapshot,
  PlanningOpportunityTag,
  PreviewGateResult,
  TaskExecutionProfile,
} from './weeklyPlanningBehaviorTypes';

export interface BehaviorAwarePreviewMetadata {
  stateRevision: number;
  sourceFactRefs: string[];
  usedAssumptionProposalRefs: string[];
  taskRef: string;
  opportunityTags: PlanningOpportunityTag[];
  reasoningKey:
    | 'explicit-duration'
    | 'explicit-unit-rate'
    | 'accepted-assumption-duration';
}

export interface BehaviorAwarePreviewCandidate extends WeeklyDraftCandidate {
  behaviorMetadata: BehaviorAwarePreviewMetadata;
}

export interface BehaviorAwareNonExamDraftRun {
  candidates: BehaviorAwarePreviewCandidate[];
  diagnostics: WeeklyDraftCandidateDiagnostics;
}

export interface BehaviorAwarePlanningBridgeResult {
  snapshot: PlanningHypothesisSnapshot;
  actions: AllowedDialogueAction[];
  gate: PreviewGateResult;
  draftRun: BehaviorAwareNonExamDraftRun | null;
}

export interface AcceptedTaskDurationAssumption {
  taskRef: string;
  minutes: number;
  proposalRef: string;
  sourceFactRefs: string[];
}

export interface BehaviorAwarePlanningBridgeInput {
  state: PlanningIntakeState;
  currentUserText: string;
  conversationId?: string;
  planningStartDate: string;
  planningDayCount: number;
  sessionPolicy?: Partial<WeeklyDraftCandidateSessionPolicy>;
  existingPlans?: Plan[];
  scheduleTemplates?: ScheduleTemplate[];
  timetableTermId?: string;
  existingPlanBufferMinutes?: number;
  availabilityRanges?: AvailabilityRangeReference[];
  acceptedTaskDurationAssumptions?: AcceptedTaskDurationAssumption[];
}

interface ResolvedTaskDuration {
  task: StudyTaskScope;
  taskRef: string;
  minutes: number;
  sourceFactRefs: string[];
  usedAssumptionProposalRefs: string[];
  reasoningKey: BehaviorAwarePreviewMetadata['reasoningKey'];
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function positiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function resolveTaskDuration(params: {
  task: StudyTaskScope;
  taskIndex: number;
  state: PlanningIntakeState;
  acceptedAssumptions: AcceptedTaskDurationAssumption[];
}): ResolvedTaskDuration | null {
  const taskRef = `task:${params.taskIndex}`;
  const amount = params.task.amount;

  if (params.task.unit === 'minutes' && positiveFinite(amount)) {
    return {
      task: params.task,
      taskRef,
      minutes: amount,
      sourceFactRefs: [taskRef],
      usedAssumptionProposalRefs: [],
      reasoningKey: 'explicit-duration',
    };
  }

  if (params.task.unit === 'hours' && positiveFinite(amount)) {
    return {
      task: params.task,
      taskRef,
      minutes: amount * 60,
      sourceFactRefs: [taskRef],
      usedAssumptionProposalRefs: [],
      reasoningKey: 'explicit-duration',
    };
  }

  const matchingRate = params.state.unitRates.find(
    (rate) => rate.unit === params.task.unit && positiveFinite(rate.minutesPerUnit),
  );
  if (positiveFinite(amount) && matchingRate && positiveFinite(matchingRate.minutesPerUnit)) {
    return {
      task: params.task,
      taskRef,
      minutes: amount * matchingRate.minutesPerUnit,
      sourceFactRefs: [taskRef, `unit-rate:${params.task.unit}`],
      usedAssumptionProposalRefs: [],
      reasoningKey: 'explicit-unit-rate',
    };
  }

  const assumption = params.acceptedAssumptions.find(
    (candidate) => candidate.taskRef === taskRef && positiveFinite(candidate.minutes),
  );
  if (assumption) {
    return {
      task: params.task,
      taskRef,
      minutes: assumption.minutes,
      sourceFactRefs: unique([taskRef, ...assumption.sourceFactRefs]),
      usedAssumptionProposalRefs: [assumption.proposalRef],
      reasoningKey: 'accepted-assumption-duration',
    };
  }

  return null;
}

function toRemainingWorkItem(
  resolved: ResolvedTaskDuration,
  taskIndex: number,
  profile: TaskExecutionProfile,
): WeeklyPlanningRemainingWorkItem {
  return {
    field: resolved.task.title,
    year: taskIndex + 1,
    estimatedMinutes: Math.round(resolved.minutes),
    unit: resolved.task.unit,
    splitPolicy: profile.distributionPolicy === 'single_block'
      || profile.distributionPolicy === 'contiguous'
      || profile.distributionPolicy === 'sequential_units'
      ? 'atomic'
      : 'splittable',
    source: 'exam_prep_request',
  };
}

function fixedEvents(state: PlanningIntakeState): LifeConstraint[] {
  return state.constraints.filter(
    (constraint) => constraint.kind === 'fixed_event' || constraint.kind === 'unavailable',
  );
}

function lifeConstraints(state: PlanningIntakeState): LifeConstraint[] {
  return state.constraints.filter(
    (constraint) => constraint.kind !== 'fixed_event' && constraint.kind !== 'unavailable',
  );
}

function opportunityTagsForTask(
  snapshot: PlanningHypothesisSnapshot,
  profile: TaskExecutionProfile,
): PlanningOpportunityTag[] {
  return unique(snapshot.opportunityAnnotations
    .filter((annotation) => (annotation.suitabilityByActivity[profile.activityKind] ?? 0) >= 2)
    .flatMap((annotation) => annotation.tags));
}

export function createBehaviorAwareNonExamDraftRun(params: {
  input: BehaviorAwarePlanningBridgeInput;
  snapshot: PlanningHypothesisSnapshot;
}): BehaviorAwareNonExamDraftRun | null {
  const acceptedAssumptions = params.input.acceptedTaskDurationAssumptions ?? [];
  const resolved = params.input.state.tasks.map((task, taskIndex) =>
    resolveTaskDuration({
      task,
      taskIndex,
      state: params.input.state,
      acceptedAssumptions,
    }),
  );

  if (
    resolved.length === 0
    || resolved.some((item) => !item)
    || params.snapshot.taskProfiles.length !== resolved.length
  ) {
    return null;
  }

  const complete = resolved as ResolvedTaskDuration[];
  const remainingWorkItems = complete.map((item, index) =>
    toRemainingWorkItem(item, index, params.snapshot.taskProfiles[index]),
  );
  const run = createWeeklyDraftCandidatesFromRemainingWorkItems({
    remainingWorkItems,
    constraints: lifeConstraints(params.input.state),
    fixedEvents: fixedEvents(params.input.state),
    planningStartDate: params.input.planningStartDate,
    planningDayCount: params.input.planningDayCount,
    sessionPolicy: params.input.sessionPolicy,
    existingPlans: params.input.existingPlans,
    scheduleTemplates: params.input.scheduleTemplates,
    timetableTermId: params.input.timetableTermId,
    existingPlanBufferMinutes: params.input.existingPlanBufferMinutes,
  });
  const resolvedByTitle = new Map(complete.map((item) => [item.task.title, item]));
  const profileByTitle = new Map(
    params.snapshot.taskProfiles.map((profile, index) => [complete[index].task.title, profile]),
  );

  const candidates = run.candidates.map((candidate) => {
    const item = resolvedByTitle.get(candidate.field);
    const profile = profileByTitle.get(candidate.field);
    if (!item || !profile) {
      throw new Error(`Missing behavior metadata for candidate: ${candidate.stableKey}`);
    }

    return {
      ...candidate,
      title: item.task.title,
      field: item.task.subject ?? item.task.title,
      year: 0,
      behaviorMetadata: {
        stateRevision: params.snapshot.stateRevision,
        sourceFactRefs: [...item.sourceFactRefs],
        usedAssumptionProposalRefs: [...item.usedAssumptionProposalRefs],
        taskRef: item.taskRef,
        opportunityTags: opportunityTagsForTask(params.snapshot, profile),
        reasoningKey: item.reasoningKey,
      },
    };
  });

  return { candidates, diagnostics: run.diagnostics };
}

export function runBehaviorAwarePlanningPreviewBridge(
  input: BehaviorAwarePlanningBridgeInput,
): BehaviorAwarePlanningBridgeResult {
  const snapshot = createPlanningHypothesisSnapshot({
    state: input.state,
    currentUserText: input.currentUserText,
    conversationId: input.conversationId,
    availabilityRanges: input.availabilityRanges,
  });
  const actions = createAllowedDialogueActions(snapshot);
  const completeTaskDurations = input.state.tasks.length > 0 && input.state.tasks.every((task, index) =>
    Boolean(resolveTaskDuration({
      task,
      taskIndex: index,
      state: input.state,
      acceptedAssumptions: input.acceptedTaskDurationAssumptions ?? [],
    })),
  );
  const gate = evaluatePreviewGate({
    readiness: snapshot.readiness,
    currentStateRevision: input.state.sourceTurns.length,
    hasExecutionShape:
      snapshot.taskProfiles.length > 0
      && snapshot.taskProfiles.every((profile) => profile.activityKind !== 'unknown')
      && completeTaskDurations,
    hasAvailabilityBasis: snapshot.readiness.resolvedDimensions.includes('availability_basis'),
  });
  const draftRun = gate.allowed && !input.state.examPrepScope
    ? createBehaviorAwareNonExamDraftRun({ input, snapshot })
    : null;

  return { snapshot, actions, gate, draftRun };
}
