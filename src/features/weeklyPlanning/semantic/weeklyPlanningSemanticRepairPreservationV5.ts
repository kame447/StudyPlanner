import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

const REPRESENTATION_ONLY_ERROR_PATTERNS = [
  /^document\.planningWindow:/,
  /^document\.planningWindow\.value:/,
  /^availabilityDeclarations\[[^\]]+\]: namedTimePeriod must be null/,
  /^availabilityDeclarations\[[^\]]+\]: explicit clock text must use startTime\/endTime/,
  /^temporalConstraints\[[^\]]+\]: namedTimePeriod must be null/,
  /^temporalConstraints\[[^\]]+\]: explicit clock text must use startTime\/endTime/,
  /^availabilityDeclarations\[[^\]]+\]\.days:canonical-weekday-required:/,
  /^recurrence\[[^\]]+\]\.days:canonical-weekday-required:/,
] as const;

interface MutableRecord {
  [key: string]: unknown;
}

function cloneDocument(document: WeeklyPlanningSemanticDocumentV5): MutableRecord {
  return structuredClone(document) as unknown as MutableRecord;
}

function referencedLocalIds(
  errors: readonly string[],
  prefix: 'availabilityDeclarations' | 'temporalConstraints' | 'recurrence',
): Set<string> {
  const ids = new Set<string>();
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([^\\]]+)\\]`);
  for (const error of errors) {
    const match = pattern.exec(error);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

function redactPlanningWindowRepresentation(document: MutableRecord): void {
  const value = document.planningWindow;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const window = value as MutableRecord;
  window.value = '__REPAIRABLE_WINDOW_VALUE__';
  window.start = '__REPAIRABLE_WINDOW_START__';
  window.end = '__REPAIRABLE_WINDOW_END__';
}

function redactAvailabilityRepresentation(
  document: MutableRecord,
  clockIds: ReadonlySet<string>,
  weekdayIds: ReadonlySet<string>,
): void {
  const declarations = document.availabilityDeclarations;
  if (!Array.isArray(declarations)) return;
  for (const declaration of declarations) {
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) continue;
    const record = declaration as MutableRecord;
    const localId = typeof record.localId === 'string' ? record.localId : null;
    if (!localId) continue;
    if (clockIds.has(localId)) {
      record.namedTimePeriod = '__REPAIRABLE_NAMED_TIME_PERIOD__';
      record.startTime = '__REPAIRABLE_START_TIME__';
      record.endTime = '__REPAIRABLE_END_TIME__';
    }
    if (weekdayIds.has(localId)) {
      record.days = ['__REPAIRABLE_WEEKDAY_TOKENS__'];
    }
  }
}

function redactTaskNestedRepresentation(
  document: MutableRecord,
  temporalIds: ReadonlySet<string>,
  recurrenceIds: ReadonlySet<string>,
): void {
  const tasks = document.tasks;
  if (!Array.isArray(tasks)) return;
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
    const taskRecord = task as MutableRecord;
    const temporalConstraints = taskRecord.temporalConstraints;
    if (Array.isArray(temporalConstraints)) {
      for (const constraint of temporalConstraints) {
        if (!constraint || typeof constraint !== 'object' || Array.isArray(constraint)) continue;
        const record = constraint as MutableRecord;
        const localId = typeof record.localId === 'string' ? record.localId : null;
        if (localId && temporalIds.has(localId)) {
          record.namedTimePeriod = '__REPAIRABLE_NAMED_TIME_PERIOD__';
          record.startTime = '__REPAIRABLE_START_TIME__';
          record.endTime = '__REPAIRABLE_END_TIME__';
        }
      }
    }
    const recurrences = taskRecord.recurrence;
    if (Array.isArray(recurrences)) {
      for (const recurrence of recurrences) {
        if (!recurrence || typeof recurrence !== 'object' || Array.isArray(recurrence)) continue;
        const record = recurrence as MutableRecord;
        const localId = typeof record.localId === 'string' ? record.localId : null;
        if (localId && recurrenceIds.has(localId)) {
          record.days = ['__REPAIRABLE_WEEKDAY_TOKENS__'];
        }
      }
    }
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function isRepresentationOnlySemanticRepairV5(
  errors: readonly string[],
): boolean {
  return errors.length > 0
    && errors.every((error) =>
      REPRESENTATION_ONLY_ERROR_PATTERNS.some((pattern) => pattern.test(error)));
}

export function validateWeeklyPlanningSemanticRepairPreservationV5(params: {
  initialDocument: WeeklyPlanningSemanticDocumentV5 | null;
  repairedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  initialErrors: readonly string[];
}): string[] {
  if (
    !params.initialDocument
    || !params.repairedDocument
    || !isRepresentationOnlySemanticRepairV5(params.initialErrors)
  ) {
    return [];
  }

  const initial = cloneDocument(params.initialDocument);
  const repaired = cloneDocument(params.repairedDocument);

  if (params.initialErrors.some((error) => error.startsWith('document.planningWindow'))) {
    redactPlanningWindowRepresentation(initial);
    redactPlanningWindowRepresentation(repaired);
  }

  const availabilityClockIds = referencedLocalIds(
    params.initialErrors,
    'availabilityDeclarations',
  );
  const availabilityWeekdayIds = new Set(
    [...availabilityClockIds].filter(() => false),
  );
  for (const error of params.initialErrors) {
    const match = /^availabilityDeclarations\[([^\]]+)\]\.days:canonical-weekday-required:/.exec(error);
    if (match?.[1]) availabilityWeekdayIds.add(match[1]);
  }
  redactAvailabilityRepresentation(
    initial,
    availabilityClockIds,
    availabilityWeekdayIds,
  );
  redactAvailabilityRepresentation(
    repaired,
    availabilityClockIds,
    availabilityWeekdayIds,
  );

  const temporalIds = referencedLocalIds(params.initialErrors, 'temporalConstraints');
  const recurrenceIds = referencedLocalIds(params.initialErrors, 'recurrence');
  redactTaskNestedRepresentation(initial, temporalIds, recurrenceIds);
  redactTaskNestedRepresentation(repaired, temporalIds, recurrenceIds);

  if (stableSerialize(initial) === stableSerialize(repaired)) return [];
  return [
    'semantic-repair-preservation:representation-only repair changed unrelated semantic facts',
  ];
}
