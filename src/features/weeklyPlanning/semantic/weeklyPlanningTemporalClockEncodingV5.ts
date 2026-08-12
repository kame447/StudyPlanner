import type {
  SemanticAvailabilityDeclarationV5,
  SemanticTemporalConstraintV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

const CLOCKISH_CUSTOM_PERIOD = /^custom:.*(?:\b(?:[01]?\d|2[0-3]):[0-5]\d\b|(?:[01]?\d|2[0-3])\s*時)/u;

export interface TemporalClockEncodingNormalizationV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  repairs: string[];
}

export interface TemporalClockRawNormalizationV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeClockFields<T extends {
  localId: string;
  namedTimePeriod: string | null;
  startTime: string | null;
  endTime: string | null;
}>(
  value: T,
  owner: string,
): { value: T; repairs: string[] } {
  if (
    value.namedTimePeriod === null
    || (value.startTime === null && value.endTime === null)
  ) {
    return { value, repairs: [] };
  }

  return {
    value: { ...value, namedTimePeriod: null },
    repairs: [`named-time-period-cleared-for-explicit-clock:${owner}:${value.localId}`],
  };
}

function normalizeRawClockEntry(
  value: unknown,
  owner: string,
  fallbackId: string,
  repairs: string[],
): void {
  if (!isRecord(value)) return;
  if (
    typeof value.namedTimePeriod !== 'string'
    || (typeof value.startTime !== 'string' && typeof value.endTime !== 'string')
  ) {
    return;
  }

  value.namedTimePeriod = null;
  const localId = typeof value.localId === 'string' && value.localId
    ? value.localId
    : fallbackId;
  repairs.push(`named-time-period-cleared-for-explicit-clock:${owner}:${localId}`);
}

/**
 * Clears a redundant named period before strict semantic validation when the AI
 * has already supplied explicit clock fields. This changes representation only:
 * no clock is parsed or inferred from natural language here.
 */
export function normalizeWeeklyPlanningTemporalClockRawV5(
  rawResponse: string,
): TemporalClockRawNormalizationV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed)) return { rawResponse, repairs: [] };

  const repairs: string[] = [];
  if (Array.isArray(parsed.tasks)) {
    parsed.tasks.forEach((task, taskIndex) => {
      if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) return;
      task.temporalConstraints.forEach((constraint, constraintIndex) => {
        normalizeRawClockEntry(
          constraint,
          'temporal-constraint',
          `${taskIndex}:${constraintIndex}`,
          repairs,
        );
      });
    });
  }
  if (Array.isArray(parsed.availabilityDeclarations)) {
    parsed.availabilityDeclarations.forEach((declaration, index) => {
      normalizeRawClockEntry(
        declaration,
        'availability',
        String(index),
        repairs,
      );
    });
  }

  return repairs.length === 0
    ? { rawResponse, repairs: [] }
    : { rawResponse: JSON.stringify(parsed), repairs };
}

export function normalizeWeeklyPlanningTemporalClockEncodingV5(
  document: WeeklyPlanningSemanticDocumentV5,
): TemporalClockEncodingNormalizationV5 {
  const repairs: string[] = [];
  const tasks = document.tasks.map((task) => {
    const temporalConstraints = task.temporalConstraints.map((constraint) => {
      const normalized = normalizeClockFields(
        constraint,
        'temporal-constraint',
      );
      repairs.push(...normalized.repairs);
      return normalized.value;
    });
    return temporalConstraints.some((item, index) => item !== task.temporalConstraints[index])
      ? { ...task, temporalConstraints }
      : task;
  });
  const availabilityDeclarations = document.availabilityDeclarations.map((declaration) => {
    const normalized = normalizeClockFields(declaration, 'availability');
    repairs.push(...normalized.repairs);
    return normalized.value;
  });

  if (repairs.length === 0) return { document, repairs: [] };
  return {
    document: {
      ...document,
      tasks,
      availabilityDeclarations,
    },
    repairs,
  };
}

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
