import type {
  PlanningFactSource,
  TemporalConstraintFact,
  WeeklyPlanningFactDiffEntry,
  WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import type {
  SemanticAvailabilityKind,
  SemanticAvailabilityRecurrenceKind,
  SemanticConstraintLevel,
  SemanticConstraintSourceKind,
} from './weeklyPlanningSemanticDocumentV2';

export const WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2 =
  'weekly-planning-fact-graph-v2' as const;

export interface TemporalConstraintFactV2
  extends Omit<TemporalConstraintFact, 'constraintLevel'> {
  constraintLevel: SemanticConstraintLevel;
}

export interface AvailabilityDeclarationFact {
  id: string;
  kind: SemanticAvailabilityKind;
  dateExpression: string | null;
  startTime: string | null;
  endTime: string | null;
  recurrenceKind: SemanticAvailabilityRecurrenceKind | null;
  days: string[];
  constraintLevel: SemanticConstraintLevel;
  resolutionStatus: 'unresolved';
  source: PlanningFactSource;
  createdRevision: number;
}

export interface ConstraintSourceRequestFact {
  id: string;
  kind: SemanticConstraintSourceKind;
  selector: 'active';
  requestedAction: 'use' | 'stop_using';
  resolutionStatus: 'unresolved';
  source: PlanningFactSource;
  createdRevision: number;
}

export interface WeeklyPlanningFactGraphV2
  extends Omit<WeeklyPlanningFactGraph, 'version' | 'temporalConstraints'> {
  version: typeof WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2;
  temporalConstraints: TemporalConstraintFactV2[];
  availabilityDeclarations: AvailabilityDeclarationFact[];
  constraintSourceRequests: ConstraintSourceRequestFact[];
}

export type WeeklyPlanningFactKindV2 =
  | WeeklyPlanningFactDiffEntry['kind']
  | 'availability_declaration'
  | 'constraint_source_request';

export interface WeeklyPlanningFactDiffEntryV2 {
  kind: WeeklyPlanningFactKindV2;
  id: string;
}

export interface WeeklyPlanningFactDiffV2 {
  fromRevision: number;
  toRevision: number;
  added: WeeklyPlanningFactDiffEntryV2[];
  superseded: WeeklyPlanningFactDiffEntryV2[];
  removed: WeeklyPlanningFactDiffEntryV2[];
}

export function createEmptyWeeklyPlanningFactGraphV2(): WeeklyPlanningFactGraphV2 {
  return {
    version: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2,
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
    availabilityDeclarations: [],
    constraintSourceRequests: [],
  };
}
