import type {
  SemanticCorrection,
  SemanticDecision,
  SemanticTask,
  SemanticTemporalConstraint,
  WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';

export const PROBE_CONSTRAINT_LEVELS = ['hard', 'soft', 'unknown'] as const;
export type ProbeConstraintLevel = (typeof PROBE_CONSTRAINT_LEVELS)[number];

export const PROBE_NAMED_TIME_PERIODS = [
  'morning',
  'afternoon',
  'evening',
  'night',
  'before_sleep',
  'before_meal',
  'after_meal',
] as const;
export type ProbeNamedTimePeriod =
  | (typeof PROBE_NAMED_TIME_PERIODS)[number]
  | `custom:${string}`;

export interface ProbeTemporalConstraint
  extends Omit<SemanticTemporalConstraint, 'constraintLevel'> {
  constraintLevel: ProbeConstraintLevel;
  namedTimePeriod: ProbeNamedTimePeriod | null;
}

export interface ProbeTask extends Omit<SemanticTask, 'temporalConstraints'> {
  temporalConstraints: ProbeTemporalConstraint[];
}

export interface ProbeAvailabilityDeclaration {
  localId: string;
  kind: 'available' | 'unavailable' | 'preferred' | 'avoided';
  dateExpression: string | null;
  namedTimePeriod: ProbeNamedTimePeriod | null;
  startTime: string | null;
  endTime: string | null;
  recurrenceKind: 'daily' | 'weekly' | 'weekdays' | 'weekends' | 'custom' | null;
  days: string[];
  constraintLevel: ProbeConstraintLevel;
  sourceText: string;
}

export interface ProbeDocument
  extends Omit<
    WeeklyPlanningSemanticDocument,
    'schemaVersion' | 'tasks' | 'corrections' | 'decisions'
  > {
  schemaVersion: 'probe';
  tasks: ProbeTask[];
  availabilityDeclarations: ProbeAvailabilityDeclaration[];
  corrections: SemanticCorrection[];
  decisions: SemanticDecision[];
}
