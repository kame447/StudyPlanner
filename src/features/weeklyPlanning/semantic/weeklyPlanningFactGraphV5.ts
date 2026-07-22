import type {
  SemanticAvailabilityKindV5,
  SemanticAvailabilityRecurrenceKindV5,
  SemanticComponentRoleV5,
  SemanticConstraintLevelV5,
  SemanticConstraintSourceKindV5,
  SemanticNamedTimePeriodV5,
  SemanticQuantityRoleV5,
  SemanticRecurrenceKindV5,
  SemanticStudyPurposeV5,
  SemanticTaskCategoryV5,
  SemanticWorkloadUnitCodeV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5 =
  'weekly-planning-fact-graph-v5' as const;

export interface PlanningFactSourceV5 {
  conversationId: string;
  turnId: string;
  semanticLocalId: string;
  sourceText: string;
  origin: 'user';
}

export interface PlanningTaskFactV5 {
  id: string;
  category: SemanticTaskCategoryV5;
  title: string;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface StudyContextFactV5 {
  id: string;
  taskId: string;
  purpose: SemanticStudyPurposeV5;
  contextLabel: string | null;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface StudyComponentFactV5 {
  id: string;
  taskId: string;
  parentComponentId: string | null;
  role: SemanticComponentRoleV5;
  label: string;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface WorkloadFactV5 {
  id: string;
  taskId: string;
  componentId: string | null;
  quantityRole: SemanticQuantityRoleV5;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface EffortEstimateFactV5 {
  id: string;
  taskId: string;
  targetFactId: string;
  kind: 'total_duration' | 'duration_per_unit' | 'session_duration';
  minutes: number;
  unitCode: SemanticWorkloadUnitCodeV5 | null;
  precision: 'exact' | 'approximate' | 'unspecified';
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface TemporalConstraintFactV5 {
  id: string;
  taskId: string;
  targetFactId: string;
  kind:
    | 'earliest_start'
    | 'latest_end'
    | 'fixed_interval'
    | 'deadline'
    | 'preferred_window'
    | 'avoid_window';
  constraintLevel: SemanticConstraintLevelV5;
  dateExpression: string | null;
  namedTimePeriod: SemanticNamedTimePeriodV5 | null;
  startTime: string | null;
  endTime: string | null;
  precision: 'exact' | 'approximate' | 'unspecified';
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface TaskDateRuleFactV5 {
  id: string;
  taskId: string;
  targetFactId: string;
  kind: 'allowed_date' | 'excluded_date';
  dateExpression: string;
  constraintLevel: SemanticConstraintLevelV5;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface RecurrenceFactV5 {
  id: string;
  taskId: string;
  targetFactId: string;
  kind: SemanticRecurrenceKindV5;
  count: number | null;
  days: string[];
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface TaskRelationFactV5 {
  id: string;
  kind: 'before' | 'after' | 'depends_on' | 'priority_over' | 'sequence';
  fromTaskId: string;
  toTaskId: string;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface PlanningWindowFactV5 {
  id: string;
  kind: 'absolute' | 'relative_day' | 'relative_week' | 'named_period';
  value: string;
  start: string | null;
  end: string | null;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface UncertaintyFactV5 {
  id: string;
  targetFactId: string | null;
  field: string;
  reason: string;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface CanonicalSemanticReferenceV5 {
  kind:
    | 'planning_window'
    | 'task'
    | 'component'
    | 'workload'
    | 'effort_estimate'
    | 'temporal_constraint'
    | 'recurrence'
    | 'relation'
    | 'proposal';
  publicId: string | null;
  factId: string | null;
  mention: string | null;
}

export interface CorrectionIntentFactV5 {
  id: string;
  target: CanonicalSemanticReferenceV5;
  operation: 'remove' | 'replace' | 'modify';
  replacementFactId: string | null;
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface DecisionIntentFactV5 {
  id: string;
  target: CanonicalSemanticReferenceV5;
  decision: 'accept' | 'reject' | 'modify';
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface AvailabilityDeclarationFactV5 {
  id: string;
  kind: SemanticAvailabilityKindV5;
  dateExpression: string | null;
  namedTimePeriod: SemanticNamedTimePeriodV5 | null;
  startTime: string | null;
  endTime: string | null;
  recurrenceKind: SemanticAvailabilityRecurrenceKindV5 | null;
  days: string[];
  constraintLevel: SemanticConstraintLevelV5;
  resolutionStatus: 'unresolved';
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export interface ConstraintSourceRequestFactV5 {
  id: string;
  kind: SemanticConstraintSourceKindV5;
  selector: 'active';
  requestedAction: 'use' | 'stop_using';
  resolutionStatus: 'unresolved';
  source: PlanningFactSourceV5;
  createdRevision: number;
}

export type PlanningFactLifecycleStatusV5 = 'active' | 'superseded' | 'removed';

export interface PlanningFactLifecycleEntryV5 {
  factId: string;
  status: PlanningFactLifecycleStatusV5;
  createdRevision: number;
  terminalRevision: number | null;
  supersededByFactId: string | null;
}

export interface WeeklyPlanningFactGraphV5 {
  version: typeof WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5;
  revision: number;
  appliedTurnKeys: string[];
  appliedLifecycleOperationKeys: string[];
  factLifecycles: PlanningFactLifecycleEntryV5[];
  planningWindows: PlanningWindowFactV5[];
  tasks: PlanningTaskFactV5[];
  studyContexts: StudyContextFactV5[];
  components: StudyComponentFactV5[];
  workloads: WorkloadFactV5[];
  effortEstimates: EffortEstimateFactV5[];
  temporalConstraints: TemporalConstraintFactV5[];
  taskDateRules: TaskDateRuleFactV5[];
  recurrences: RecurrenceFactV5[];
  relations: TaskRelationFactV5[];
  uncertainties: UncertaintyFactV5[];
  correctionIntents: CorrectionIntentFactV5[];
  decisionIntents: DecisionIntentFactV5[];
  availabilityDeclarations: AvailabilityDeclarationFactV5[];
  constraintSourceRequests: ConstraintSourceRequestFactV5[];
}

export type WeeklyPlanningFactKindV5 =
  | 'planning_window'
  | 'task'
  | 'study_context'
  | 'component'
  | 'workload'
  | 'effort_estimate'
  | 'temporal_constraint'
  | 'task_date_rule'
  | 'recurrence'
  | 'relation'
  | 'uncertainty'
  | 'correction_intent'
  | 'decision_intent'
  | 'availability_declaration'
  | 'constraint_source_request';

export interface WeeklyPlanningFactDiffEntryV5 {
  kind: WeeklyPlanningFactKindV5;
  id: string;
}

export interface WeeklyPlanningFactDiffV5 {
  fromRevision: number;
  toRevision: number;
  added: WeeklyPlanningFactDiffEntryV5[];
  superseded: WeeklyPlanningFactDiffEntryV5[];
  removed: WeeklyPlanningFactDiffEntryV5[];
}

export function createEmptyWeeklyPlanningFactGraphV5(): WeeklyPlanningFactGraphV5 {
  return {
    version: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
    revision: 0,
    appliedTurnKeys: [],
    appliedLifecycleOperationKeys: [],
    factLifecycles: [],
    planningWindows: [],
    tasks: [],
    studyContexts: [],
    components: [],
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    taskDateRules: [],
    recurrences: [],
    relations: [],
    uncertainties: [],
    correctionIntents: [],
    decisionIntents: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
  };
}
