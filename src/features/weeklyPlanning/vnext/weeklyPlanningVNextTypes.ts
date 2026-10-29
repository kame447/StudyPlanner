// Experimental VNext conversation core (Issue #926). Not wired to production;
// Stable V5 remains the only runtime until an explicit, atomic switch is approved.
import type {
  EffortEstimateFactV5,
  WeeklyPlanningFactDiffV5,
  WeeklyPlanningFactGraphV5,
  TemporalConstraintFactV5,
} from './weeklyPlanningVNextV5Boundary';
import type {
  SemanticComponentRoleV5,
  SemanticConstraintLevelV5,
  SemanticNamedTimePeriodV5,
  SemanticQuantityRoleV5,
  SemanticTaskCategoryV5,
  SemanticWorkloadUnitCodeV5,
} from '../semantic/weeklyPlanningSemanticTypesV5';

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

export interface WeeklyPlanningVNextGraph extends WeeklyPlanningFactGraphV5 {
  effortEstimates: VNextEffortEstimateFact[];
}

export type VNextWorkRelationKind = 'same' | 'distinct';

export interface VNextWorkRelation {
  kind: VNextWorkRelationKind;
  /** Two lineage ids, sorted ascending. */
  lineageIds: readonly [string, string];
  createdRevision: number;
}

export interface VNextQuestionDeferral {
  questionKey: string;
  createdRevision: number;
}

export interface WeeklyPlanningVNextState {
  version: typeof WEEKLY_PLANNING_VNEXT_STATE_VERSION;
  graph: WeeklyPlanningVNextGraph;
  workRelations: VNextWorkRelation[];
  deferrals: VNextQuestionDeferral[];
}

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

export type VNextAddFact =
  | VNextAddTask
  | VNextAddComponent
  | VNextAddWorkload
  | VNextAddEffort
  | VNextAddTemporal;

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
  | { kind: 'temporal_constraint'; localId: string; targetFactId: string; changes: VNextTemporalChanges };

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
}

export interface VNextTurnDelta {
  add: VNextAddFact[];
  patch: VNextPatch[];
  remove: VNextRemove[];
  relate: VNextRelate[];
  defer: VNextDefer[];
}

export interface VNextTurnContext {
  /** Idempotency key; a key already in graph.appliedTurnKeys is a duplicate. */
  turnKey: string;
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
  | { status: 'applied'; state: WeeklyPlanningVNextState; diff: WeeklyPlanningFactDiffV5 }
  | { status: 'duplicate'; state: WeeklyPlanningVNextState }
  /** Every operation restated current values: nothing changes, revision is kept. */
  | { status: 'noop'; state: WeeklyPlanningVNextState }
  | { status: 'rejected'; state: WeeklyPlanningVNextState; errors: VNextTurnError[] };

// ---- projection: recomputed every turn, never stored --------------------------

export type VNextQuestionCode =
  | 'quantity_role_unresolved'
  | 'quantity_basis_invalid'
  | 'duplicate_quantity'
  | 'completed_exceeds_total'
  | 'remaining_inconsistent'
  | 'same_or_distinct_work'
  | 'missing_effort_estimate'
  | 'effort_inconsistent';

export interface VNextQuestionOption {
  optionId: string;
  /** Machine value the option stands for (amount or minutes). */
  value: number;
  /** Applying the option is an ordinary typed delta. */
  delta: VNextTurnDelta;
}

export interface VNextQuestion {
  code: VNextQuestionCode;
  /** Deterministic from code, owner, subject lineages and work amount. */
  key: string;
  ownerKey: string;
  taskId: string;
  componentId: string | null;
  subjectLineageIds: string[];
  /** The work an estimate answer is bound to, by identity (`VNextWorkRef`). */
  forWork: { workLineageId: string; definingFactId: string; amount: number } | null;
  options: VNextQuestionOption[];
}

export type VNextEstimateBasis =
  | 'intrinsic_duration'
  | 'rate'
  | 'work_total'
  | 'observed_pace'
  | 'session_duration'
  | 'task_total';

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
}

export interface WeeklyPlanningVNextProjection {
  graphRevision: number;
  owners: VNextOwnerProjection[];
  /** Open questions, excluding deferred ones. */
  questions: VNextQuestion[];
  deferredQuestions: VNextQuestion[];
  readiness: 'ready' | 'needs_resolution' | 'empty';
}
