import type {
  SemanticAvailabilityDeclarationV5,
  SemanticTemporalConstraintV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

const CLOCKISH_CUSTOM_PERIOD = /^custom:.*(?:\b(?:[01]?\d|2[0-3]):[0-5]\d\b|(?:[01]?\d|2[0-3])\s*時)/u;

function validateClockFields(params: {
  localId: string;
  namedTimePeriod: string | null;
  startTime: string | null;
  endTime: string | null;
  path: string;
}): string[] {
  const errors: string[] = [];
  const hasNamed = params.namedTimePeriod !== null;
  const hasClock = params.startTime !== null || params.endTime !== null;

  if (hasNamed && hasClock) {
    errors.push(
      `${params.path}[${params.localId}]: namedTimePeriod must be null when startTime or endTime is supplied.`,
    );
  }

  if (
    params.namedTimePeriod?.startsWith('custom:')
    && CLOCKISH_CUSTOM_PERIOD.test(params.namedTimePeriod)
    && params.startTime === null
    && params.endTime === null
  ) {
    errors.push(
      `${params.path}[${params.localId}]: explicit clock text must use startTime/endTime with namedTimePeriod=null; do not encode clock times as a custom namedTimePeriod.`,
    );
  }

  return errors;
}

function availabilityErrors(
  declaration: SemanticAvailabilityDeclarationV5,
): string[] {
  return validateClockFields({
    localId: declaration.localId,
    namedTimePeriod: declaration.namedTimePeriod,
    startTime: declaration.startTime,
    endTime: declaration.endTime,
    path: 'availabilityDeclarations',
  });
}

function temporalConstraintErrors(
  constraint: SemanticTemporalConstraintV5,
): string[] {
  return validateClockFields({
    localId: constraint.localId,
    namedTimePeriod: constraint.namedTimePeriod,
    startTime: constraint.startTime,
    endTime: constraint.endTime,
    path: 'temporalConstraints',
  });
}

export function validateWeeklyPlanningTemporalClockEncodingV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  return [
    ...document.availabilityDeclarations.flatMap(availabilityErrors),
    ...document.tasks.flatMap((task) =>
      task.temporalConstraints.flatMap(temporalConstraintErrors)),
  ];
}
