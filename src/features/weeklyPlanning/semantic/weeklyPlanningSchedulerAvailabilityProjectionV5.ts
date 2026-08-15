import type {
  AvailabilityDeclarationFact,
  ConstraintSourceRequestFact,
} from './weeklyPlanningFactGraphV2';
import type {
  AvailabilityDeclarationFactV5,
  ConstraintSourceRequestFactV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningAvailabilityGraphView,
} from './weeklyPlanningAvailabilityResolver';

export type SchedulerAvailabilityDeclarationFactV5 = AvailabilityDeclarationFactV5 & {
  kind: 'available' | 'unavailable' | 'preferred' | 'avoided';
};

export function isSchedulerAvailabilityDeclarationV5(
  declaration: AvailabilityDeclarationFactV5,
): declaration is SchedulerAvailabilityDeclarationFactV5 {
  if (declaration.kind === 'no_additional_constraint') return false;

  if (
    declaration.kind === 'available'
    && declaration.constraintLevel === 'hard'
    && declaration.namedTimePeriod === null
    && declaration.startTime === null
    && declaration.endTime === null
    && declaration.recurrenceKind === null
  ) return false;

  return true;
}

export function projectWeeklyPlanningSchedulerAvailabilityDeclarationsV5(
  declarations: ReadonlyArray<AvailabilityDeclarationFactV5>,
): SchedulerAvailabilityDeclarationFactV5[] {
  return declarations.filter(isSchedulerAvailabilityDeclarationV5);
}

function toAvailabilityDeclarationFact(
  declaration: SchedulerAvailabilityDeclarationFactV5,
): AvailabilityDeclarationFact {
  return {
    id: declaration.id,
    kind: declaration.kind,
    dateExpression: declaration.dateExpression,
    namedTimePeriod: declaration.namedTimePeriod,
    startTime: declaration.startTime,
    endTime: declaration.endTime,
    recurrenceKind: declaration.recurrenceKind,
    days: [...declaration.days],
    constraintLevel: declaration.constraintLevel,
    resolutionStatus: declaration.resolutionStatus,
    source: { ...declaration.source },
    createdRevision: declaration.createdRevision,
  };
}

function toConstraintSourceRequestFact(
  request: ConstraintSourceRequestFactV5,
): ConstraintSourceRequestFact {
  return {
    id: request.id,
    kind: request.kind,
    selector: request.selector,
    requestedAction: request.requestedAction,
    resolutionStatus: request.resolutionStatus,
    source: { ...request.source },
    createdRevision: request.createdRevision,
  };
}

export function createWeeklyPlanningAvailabilityResolverGraphV5(params: {
  revision: number;
  availabilityDeclarations: ReadonlyArray<AvailabilityDeclarationFactV5>;
  constraintSourceRequests: ReadonlyArray<ConstraintSourceRequestFactV5>;
}): WeeklyPlanningAvailabilityGraphView {
  return {
    revision: params.revision,
    availabilityDeclarations: projectWeeklyPlanningSchedulerAvailabilityDeclarationsV5(
      params.availabilityDeclarations,
    ).map(toAvailabilityDeclarationFact),
    constraintSourceRequests: params.constraintSourceRequests.map(toConstraintSourceRequestFact),
  };
}
