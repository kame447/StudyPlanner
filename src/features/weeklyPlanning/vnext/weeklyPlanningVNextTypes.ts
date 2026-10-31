// Experimental VNext conversation core (Issue #926). Not wired to production;
// Stable V5 remains the only runtime until an explicit, atomic switch is approved.
import type {
  EffortEstimateFactV5,
  WeeklyPlanningFactDiffV5,
  WeeklyPlanningFactGraphV5,
  TemporalConstraintFactV5,
  WeeklyPlanningLearningStrategyProposalRecord,
  PlanningDraftGenerationIntent,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningVNextV5Boundary';
import type {
  SemanticComponentRoleV5,
  SemanticConstraintLevelV5,
  SemanticNamedTimePeriodV5,
  SemanticQuantityRoleV5,
  SemanticStudyActivityKindV5,
  SemanticTaskCategoryV5,
  SemanticWorkloadUnitCodeV5,
} from '../semantic/weeklyPlanningSemanticTypesV5';
import type { WeeklyPlanningWeekStartsOn } from '../personalization/weeklyPlanningWeek';

export const WEEKLY_PLANNING_VNEXT_STATE_VERSION = 'weekly-planning-vnext-state-v1' as const;

// ---- state: stated facts and user decisions only -----------------------------
// The graph keeps the V5 shape and lifecycle so that lineage (root of the
// supersede chain) comes from the existing `supersededByFactId` record. VNext
// graphs never contain derived workloads (remaining computed from total and
// completed, percent remaining, bounded remaining, task-total minute targets).

/**
 * What a stated total measures, fixed when it is stated (the AI's meaning,
 * carried by which work or completed fact the total was about) and bound by
 * code to that work's lineage, amount and quantity basis. It applies only
 * while all three still match.
 * - future_work: time the work still to do will take.
 * - observed_pace: time the completed amount took; a pace for similar work.
 */
export interface VNextEffortWorkBinding {
  kind: 'future_work' | 'observed_pace';
  workLineageId: string;
  boundAmount: number;
  boundBasisKey: string;
}

export interface VNextEffortEstimateFact extends EffortEstimateFactV5 {
  /** Custom-unit label for rate identity; null unless unitCode is 'custom'. */
  unitLabel: string | null;
  /** Set only for a total about one work or completed amount; null for owner-wide totals and other kinds. */
  workBinding: VNextEffortWorkBinding | null;
}

/** Explicit activity meaning retained by VNext; V5's stored context omitted it. */
export type VNextStudyContextFact = WeeklyPlanningFactGraphV5['studyContexts'][number] & {
  activityKind: SemanticStudyActivityKindV5;
};

export interface WeeklyPlanningVNextGraph extends WeeklyPlanningFactGraphV5 {
  effortEstimates: VNextEffortEstimateFact[];
  studyContexts: VNextStudyContextFact[];
}

export type VNextWorkRelationKind = 'same' | 'distinct';

export interface VNextWorkRelation {
  kind: VNextWorkRelationKind;
  /** Two lineage ids, sorted ascending. */
  lineageIds: readonly [string, string];
  createdRevision: number;
}

/**
 * What a deferral lets the scheduler do meanwhile. provisional_timebox is Stable V5's scheduler
 * permission (#305): the effort is unknown and the user asks to place a provisional block anyway.
 * It never states an amount or estimate; only missing-estimate and missing-work questions take it.
 */
export type VNextDeferralAllocation = 'none' | 'provisional_timebox';

export interface VNextQuestionDeferral {
  questionKey: string;
  allocation: VNextDeferralAllocation;
  createdRevision: number;
}

export interface WeeklyPlanningVNextState {
  version: typeof WEEKLY_PLANNING_VNEXT_STATE_VERSION;
  graph: WeeklyPlanningVNextGraph;
  workRelations: VNextWorkRelation[];
  deferrals: VNextQuestionDeferral[];
  learningStrategyProposalRecords: WeeklyPlanningLearningStrategyProposalRecord[];
  /** Durable application permission, never inferred from complete facts or a shown preview. */
  draftGenerationIntent: PlanningDraftGenerationIntent;
}

export type VNextPlanningIntent = WeeklyPlanningSemanticDocumentV5['planningIntent'];

// ---- one turn = one typed delta, applied as one transaction -------------------

/**
 * Reference to a stored fact (any version of a lineage whose current version is
 * active), or to a fact added earlier in the same delta.
 */
export type VNextFactRef = { factId: string } | { localId: string };

/** Reference to a projected work by its identity, for estimates about work that has no fact of its own. */
export interface VNextWorkRef {
  workLineageId: string;
}

export interface VNextAddTask {
  kind: 'task';
  localId: string;
  category: SemanticTaskCategoryV5;
  title: string;
}

export interface VNextAddComponent {
  kind: 'component';
  localId: string;
  taskRef: VNextFactRef;
  parentComponentRef: VNextFactRef | null;
  role: SemanticComponentRoleV5;
  label: string;
}

export interface VNextAddWorkload {
  kind: 'workload';
  localId: string;
  taskRef: VNextFactRef;
  componentRef: VNextFactRef | null;
  quantityRole: SemanticQuantityRoleV5;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
}

export interface VNextAddEffort {
  kind: 'effort_estimate';
  localId: string;
  taskRef: VNextFactRef;
  /**
   * What the estimate is about (AI-owned meaning): a task or component (owner-wide),
   * a workload (that work; a completed workload means observed pace), or a projected
   * work by identity (a total answer for the asked work).
   */
  targetRef: VNextFactRef | VNextWorkRef;
  effortKind: EffortEstimateFactV5['kind'];
  minutes: number;
  unitCode: SemanticWorkloadUnitCodeV5 | null;
  unitLabel: string | null;
  precision: EffortEstimateFactV5['precision'];
}

export interface VNextAddTemporal {
  kind: 'temporal_constraint';
  localId: string;
  taskRef: VNextFactRef;
  targetRef: VNextFactRef;
  constraintKind: TemporalConstraintFactV5['kind'];
  constraintLevel: SemanticConstraintLevelV5;
  dateExpression: string | null;
  namedTimePeriod: SemanticNamedTimePeriodV5 | null;
  startTime: string | null;
  endTime: string | null;
  precision: TemporalConstraintFactV5['precision'];
}

// Reuse each V5 collection's payload. VNext changes only the wire discriminant,
// transaction-owned metadata, and references; the stored fact keeps its V5 shape.
type StatedPayload<T> = Omit<T, 'id' | 'source' | 'createdRevision'>;
type PlanningWindowPayload = StatedPayload<WeeklyPlanningFactGraphV5['planningWindows'][number]>;
type RecurrencePayload = StatedPayload<WeeklyPlanningFactGraphV5['recurrences'][number]>;
type TaskDateRulePayload = StatedPayload<WeeklyPlanningFactGraphV5['taskDateRules'][number]>;
type AvailabilityPayload = StatedPayload<WeeklyPlanningFactGraphV5['availabilityDeclarations'][number]>;
type RelationPayload = StatedPayload<WeeklyPlanningFactGraphV5['relations'][number]>;
type ConstraintSourcePayload = StatedPayload<WeeklyPlanningFactGraphV5['constraintSourceRequests'][number]>;

export type VNextAddStudyContext = Omit<StatedPayload<VNextStudyContextFact>, 'taskId'> & {
  kind: 'study_context'; localId: string; taskRef: VNextFactRef;
};
export type VNextAddPlanningWindow = Omit<PlanningWindowPayload, 'kind'> & {
  kind: 'planning_window'; localId: string; windowKind: PlanningWindowPayload['kind'];
};
export type VNextAddRecurrence = Omit<RecurrencePayload, 'kind' | 'taskId' | 'targetFactId'> & {
  kind: 'recurrence'; localId: string; recurrenceKind: RecurrencePayload['kind']; taskRef: VNextFactRef; targetRef: VNextFactRef;
};
export type VNextAddTaskDateRule = Omit<TaskDateRulePayload, 'kind' | 'taskId' | 'targetFactId'> & {
  kind: 'task_date_rule'; localId: string; ruleKind: TaskDateRulePayload['kind']; taskRef: VNextFactRef; targetRef: VNextFactRef;
};
export type VNextAddAvailability = Omit<AvailabilityPayload, 'kind' | 'resolutionStatus' | 'capacityMinutes'> & {
  kind: 'availability_declaration'; localId: string; availabilityKind: AvailabilityPayload['kind']; capacityMinutes: number | null;
};
export type VNextAddRelation = Omit<RelationPayload, 'kind' | 'fromTaskId' | 'toTaskId'> & {
  kind: 'relation'; localId: string; relationKind: RelationPayload['kind']; fromTaskRef: VNextFactRef; toTaskRef: VNextFactRef;
};

export type VNextAddConstraintSource = Omit<ConstraintSourcePayload, 'kind' | 'resolutionStatus'> & {
  kind: 'constraint_source_request'; localId: string; sourceKind: ConstraintSourcePayload['kind'];
};

export type VNextAddFact =
  | VNextAddTask
  | VNextAddStudyContext
  | VNextAddComponent
  | VNextAddWorkload
  | VNextAddEffort
  | VNextAddTemporal
  | VNextAddPlanningWindow
  | VNextAddRecurrence
  | VNextAddTaskDateRule
  | VNextAddAvailability
  | VNextAddRelation
  | VNextAddConstraintSource;

type NullableChanges<T> = { [K in keyof T]-?: T[K] | null };
export type VNextStudyContextChanges = NullableChanges<Omit<VNextAddStudyContext, 'kind' | 'localId' | 'taskRef'>>;
export type VNextPlanningWindowChanges = NullableChanges<Omit<VNextAddPlanningWindow, 'kind' | 'localId'>>;
export type VNextRecurrenceChanges = NullableChanges<Omit<VNextAddRecurrence, 'kind' | 'localId' | 'taskRef' | 'targetRef'>>;
export type VNextTaskDateRuleChanges = NullableChanges<Omit<VNextAddTaskDateRule, 'kind' | 'localId' | 'taskRef' | 'targetRef'>>;
export type VNextAvailabilityChanges = NullableChanges<Omit<VNextAddAvailability, 'kind' | 'localId'>>;
export type VNextRelationChanges = NullableChanges<Pick<VNextAddRelation, 'relationKind'>>;
export type VNextConstraintSourceChanges = NullableChanges<Omit<VNextAddConstraintSource, 'kind' | 'localId'>>;

// In every `changes` object null means "unchanged". Identity fields (taskId,
// componentId, targetFactId, id) are not patchable: change them by remove + add.
export interface VNextWorkloadChanges {
  amount: number | null;
  unitCode: SemanticWorkloadUnitCodeV5 | null;
  unitLabel: string | null;
  quantityRole: SemanticQuantityRoleV5 | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean | null;
  periodExpression: string | null;
}

export interface VNextEffortChanges {
  minutes: number | null;
  effortKind: EffortEstimateFactV5['kind'] | null;
  unitCode: SemanticWorkloadUnitCodeV5 | null;
  unitLabel: string | null;
  precision: EffortEstimateFactV5['precision'] | null;
}

export interface VNextTemporalChanges {
  constraintKind: TemporalConstraintFactV5['kind'] | null;
  constraintLevel: SemanticConstraintLevelV5 | null;
  dateExpression: string | null;
  namedTimePeriod: SemanticNamedTimePeriodV5 | null;
  startTime: string | null;
  endTime: string | null;
  precision: TemporalConstraintFactV5['precision'] | null;
}

export interface VNextTaskChanges {
  category: SemanticTaskCategoryV5 | null;
  title: string | null;
}

export interface VNextComponentChanges {
  role: SemanticComponentRoleV5 | null;
  label: string | null;
}

// Every patch carries a localId so a validation error (and the formal-repair
// splice) can address it the same way as an added fact.
export type VNextPatch =
  | { kind: 'task'; localId: string; targetFactId: string; changes: VNextTaskChanges }
  | { kind: 'study_context'; localId: string; targetFactId: string; changes: VNextStudyContextChanges }
  | { kind: 'component'; localId: string; targetFactId: string; changes: VNextComponentChanges }
  | {
      kind: 'workload';
      localId: string;
      targetFactId: string;
      changes: VNextWorkloadChanges;
      /** Increment stated by the user; code adds it to the current amount. */
      amountDelta: number | null;
    }
  | { kind: 'effort_estimate'; localId: string; targetFactId: string; changes: VNextEffortChanges }
  | { kind: 'temporal_constraint'; localId: string; targetFactId: string; changes: VNextTemporalChanges }
  | { kind: 'planning_window'; localId: string; targetFactId: string; changes: VNextPlanningWindowChanges }
  | { kind: 'recurrence'; localId: string; targetFactId: string; changes: VNextRecurrenceChanges }
  | { kind: 'task_date_rule'; localId: string; targetFactId: string; changes: VNextTaskDateRuleChanges }
  | { kind: 'availability_declaration'; localId: string; targetFactId: string; changes: VNextAvailabilityChanges }
  | { kind: 'relation'; localId: string; targetFactId: string; changes: VNextRelationChanges }
  | { kind: 'constraint_source_request'; localId: string; targetFactId: string; changes: VNextConstraintSourceChanges };

export interface VNextRemove {
  targetFactId: string;
}

export interface VNextRelate {
  kind: VNextWorkRelationKind;
  a: VNextFactRef;
  b: VNextFactRef;
}

export interface VNextDefer {
  questionKey: string;
  allocation: VNextDeferralAllocation;
}

/** Bound only from a fresh presented proposal; the transaction is its sole writer. */
export interface VNextProposalDecision {
  proposalId: string;
  decision: 'accept' | 'reject';
  questionKey: string;
}

export interface VNextTurnDelta {
  /** Internal control produced by answer binding, not part of the provider's fact delta. */
  proposalDecision?: VNextProposalDecision;
  add: VNextAddFact[];
  patch: VNextPatch[];
  remove: VNextRemove[];
  relate: VNextRelate[];
  defer: VNextDefer[];
}

export interface VNextTurnContext {
  /** Accepted preview meaning: the transaction alone versions a newly approvable candidate set. */
  preview?: {
    shownPreviewBlockIds: readonly string[];
    /** Actual current-revision keys from the V5-authorized scheduler, never model-supplied ids. */
    authorizedCandidateKeys: readonly string[];
    eventRegistration?: import('./weeklyPlanningVNextEventRegistration').VNextEventRegistrationContext;
  };
  /** Read-only observations for this turn, never stored as stated effort or proposal policy. */
  observedMemoryPace?: Readonly<Record<string, number>>;
  /** Idempotency key; a key already in graph.appliedTurnKeys is a duplicate. */
  turnKey: string;
  /** Local date (YYYY-MM-DD) the turn is accepted on; relative dates in it are fixed against this (#918). */
  acceptedDate: string;
  weekStartsOn: WeeklyPlanningWeekStartsOn;
  /** The planning window in force when this turn was stated. */
  planningHorizon: { startDate: string; endDate: string };
  /** The selected week to use when this turn leaves no single active window. */
  defaultPlanningHorizon: { startDate: string; endDate: string };
  expectedRevision: number;
  conversationId: string;
  turnId: string;
  sourceText: string;
}

export type VNextTurnErrorCode =
  | 'stale_revision'
  | 'empty_delta'
  | 'duplicate_local_id'
  | 'unknown_ref'
  | 'target_not_active'
  | 'kind_mismatch'
  | 'empty_patch'
  | 'invalid_value'
  | 'work_unavailable'
  | 'active_dependents';

export interface VNextTurnError {
  code: VNextTurnErrorCode;
  /** JSON-path-like location in the delta, e.g. `patch[1].changes.amount`. */
  path: string;
  /** Local id of the added element the error belongs to, when applicable. */
  localId: string | null;
  factId: string | null;
}

export type VNextTurnResult =
  | { status: 'applied'; state: WeeklyPlanningVNextState; diff: WeeklyPlanningFactDiffV5;
      registrationActs?: import('./weeklyPlanningVNextV5Boundary').SemanticConversationActV5[] }
  | { status: 'duplicate'; state: WeeklyPlanningVNextState }
  /** Every operation restated current values: nothing changes, revision is kept. */
  | { status: 'noop'; state: WeeklyPlanningVNextState;
      registrationActs?: import('./weeklyPlanningVNextV5Boundary').SemanticConversationActV5[] }
  | { status: 'rejected'; state: WeeklyPlanningVNextState; errors: VNextTurnError[] };

// ---- projection: recomputed every turn, never stored --------------------------

export type VNextQuestionCode =
  | 'learning_strategy_proposal'
  | 'quantity_role_unresolved'
  | 'quantity_basis_invalid'
  | 'duplicate_quantity'
  | 'completed_exceeds_total'
  | 'remaining_inconsistent'
  | 'same_or_distinct_work'
  | 'missing_effort_estimate'
  | 'effort_inconsistent'
  /** A stated task with no work, no total time and no fixed time: how much is to be done. */
  | 'missing_schedulable_work';

export interface VNextQuestionOption {
  optionId: string;
  /** Machine value the option stands for (amount or minutes). */
  value: number;
  /** Applying the option is an ordinary typed delta. */
  delta: VNextTurnDelta;
}

export interface VNextQuestion {
  code: VNextQuestionCode;
  proposal?: WeeklyPlanningLearningStrategyProposalRecord;
  effortMeasurement?: 'total_duration' | 'session_duration';
  /** Deterministic from code, owner, subject lineages and work amount. */
  key: string;
  ownerKey: string;
  taskId: string;
  componentId: string | null;
  subjectLineageIds: string[];
  /** The work an estimate answer is bound to, by identity (`VNextWorkRef`). */
  forWork: {
    workLineageId: string;
    definingFactId: string;
    amount: number;
    /** The asked work's unit: a per-unit answer is stated in it. */
    unitCode: SemanticWorkloadUnitCodeV5;
    unitLabel: string;
  } | null;
  options: VNextQuestionOption[];
}

export type VNextEstimateBasis =
  | 'intrinsic_duration'
  | 'rate'
  | 'work_total'
  | 'observed_pace'
  | 'observed_memory_pace'
  | 'session_duration'
  | 'task_total'
  | 'provisional_timebox';

export interface VNextWorkItem {
  workLineageId: string;
  definingFactId: string;
  ownerKey: string;
  taskId: string;
  componentId: string | null;
  quantityRole: 'target' | 'remaining';
  /** True when the amount is total − completed (named by the total's lineage). */
  derivedFromTotal: boolean;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
  minutes: number | null;
  estimateBasis: VNextEstimateBasis | null;
  estimateFactIds: string[];
}

export interface VNextOwnerProjection {
  ownerKey: string;
  taskId: string;
  componentId: string | null;
  status: 'ready' | 'question' | 'nothing_to_schedule';
  work: VNextWorkItem[];
  question: VNextQuestion | null;
  /** Explicitly accepted measurement trial; V5's calibration compiler owns its work item. */
  calibration?: { workloadFactId: string; sessionMinutes: number };
}

export interface WeeklyPlanningVNextProjection {
  /** V5's scalar relevant-workload policy, derived here once for the scheduler. */
  learningStrategy?: {
    acceptedSpacedProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
    acceptedCalibrationProposal: WeeklyPlanningLearningStrategyProposalRecord | null;
  };
  graphRevision: number;
  owners: VNextOwnerProjection[];
  /** Open questions, excluding deferred ones. */
  questions: VNextQuestion[];
  deferredQuestions: VNextQuestion[];
  readiness: 'ready' | 'needs_resolution' | 'empty';
}
