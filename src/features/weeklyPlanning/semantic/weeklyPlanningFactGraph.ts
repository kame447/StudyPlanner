import type {
  SemanticComponentRole,
  SemanticQuantityRole,
  SemanticRecurrenceKind,
  SemanticStudyPurpose,
  SemanticTaskCategory,
  SemanticTemporalConstraintKind,
  SemanticWorkloadUnitCode,
} from './weeklyPlanningSemanticDocument';

export const WEEKLY_PLANNING_FACT_GRAPH_VERSION = 'weekly-planning-fact-graph-v1' as const;

export interface PlanningFactSource {
  conversationId: string;
  turnId: string;
  semanticLocalId: string;
  sourceText: string;
  origin: 'user';
}

export interface PlanningTaskFact {
  id: string;
  category: SemanticTaskCategory;
  title: string;
  source: PlanningFactSource;
  createdRevision: number;
}

export interface StudyContextFact {
  id: string;
  taskId: string;
  purpose: SemanticStudyPurpose;
  contextLabel: string | null;
  source: PlanningFactSource;
  createdRevision: number;
}

export interface StudyComponentFact {
  id: string;
  taskId: string;
  parentComponentId: string | null;
  role: SemanticComponentRole;
  label: string;
  source: PlanningFactSource;
  createdRevision: number;
}

export interface WorkloadFact {
  id: string;
  taskId: string;
  componentId: string | null;
  quantityRole: SemanticQuantityRole;
  amount: number;
  unitCode: SemanticWorkloadUnitCode;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
  source: PlanningFactSource;
  createdRevision: number;
}

export interface EffortEstimateFact {
  id: string;
  taskId: string;
  targetFactId: string;
  kind: 'total_duration' | 'duration_per_unit' | 'session_duration';
  minutes: number;
  unitCode: SemanticWorkloadUnitCode | null;
  precision: 'exact' | 'approximate' | 'unspecified';
  source: PlanningFactSource;
  createdRevision: number;
}

export interface TemporalConstraintFact {
  id: string;
  taskId: string;
  targetFactId: string;
  kind: SemanticTemporalConstraintKind;
  dateExpression: string | null;
  startTime: string | null;
  endTime: string | null;
  precision: 'exact' | 'approximate' | 'unspecified';
  source: PlanningFactSource;
  createdRevision: number;
}

export interface RecurrenceFact {
  id: string;
  taskId: string;
  targetFactId: string;
  kind: SemanticRecurrenceKind;
  count: number | null;
  days: string[];
  source: PlanningFactSource;
  createdRevision: number;
}

export interface TaskRelationFact {
  id: string;
  kind: 'before' | 'after' | 'depends_on' | 'priority_over' | 'sequence';
  fromTaskId: string;
  toTaskId: string;
  source: PlanningFactSource;
  createdRevision: number;
}

export interface PlanningWindowFact {
  id: string;
  kind: 'absolute' | 'relative_day' | 'relative_week' | 'named_period';
  value: string;
  start: string | null;
  end: string | null;
  source: PlanningFactSource;
  createdRevision: number;
}

export interface UncertaintyFact {
  id: string;
  targetFactId: string | null;
  field: string;
  reason: string;
  source: PlanningFactSource;
  createdRevision: number;
}

export interface CanonicalSemanticReference {
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

export interface CorrectionIntentFact {
  id: string;
  target: CanonicalSemanticReference;
  operation: 'remove' | 'replace' | 'modify';
  replacementFactId: string | null;
  source: PlanningFactSource;
  createdRevision: number;
}

export interface DecisionIntentFact {
  id: string;
  target: CanonicalSemanticReference;
  decision: 'accept' | 'reject' | 'modify';
  source: PlanningFactSource;
  createdRevision: number;
}

export interface WeeklyPlanningFactGraph {
  version: typeof WEEKLY_PLANNING_FACT_GRAPH_VERSION;
  revision: number;
  appliedTurnKeys: string[];
  planningWindows: PlanningWindowFact[];
  tasks: PlanningTaskFact[];
  studyContexts: StudyContextFact[];
  components: StudyComponentFact[];
  workloads: WorkloadFact[];
  effortEstimates: EffortEstimateFact[];
  temporalConstraints: TemporalConstraintFact[];
  recurrences: RecurrenceFact[];
  relations: TaskRelationFact[];
  uncertainties: UncertaintyFact[];
  correctionIntents: CorrectionIntentFact[];
  decisionIntents: DecisionIntentFact[];
}

export type WeeklyPlanningFactKind =
  | 'planning_window'
  | 'task'
  | 'study_context'
  | 'component'
  | 'workload'
  | 'effort_estimate'
  | 'temporal_constraint'
  | 'recurrence'
  | 'relation'
  | 'uncertainty'
  | 'correction_intent'
  | 'decision_intent';

export interface WeeklyPlanningFactDiffEntry {
  kind: WeeklyPlanningFactKind;
  id: string;
}

export interface WeeklyPlanningFactDiff {
  fromRevision: number;
  toRevision: number;
  added: WeeklyPlanningFactDiffEntry[];
  superseded: WeeklyPlanningFactDiffEntry[];
  removed: WeeklyPlanningFactDiffEntry[];
}

export function createEmptyWeeklyPlanningFactGraph(): WeeklyPlanningFactGraph {
  return {
    version: WEEKLY_PLANNING_FACT_GRAPH_VERSION,
    revision: 0,
    appliedTurnKeys: [],
    planningWindows: [],
    tasks: [],
    studyContexts: [],
    components: [],
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrences: [],
    relations: [],
    uncertainties: [],
    correctionIntents: [],
    decisionIntents: [],
  };
}
