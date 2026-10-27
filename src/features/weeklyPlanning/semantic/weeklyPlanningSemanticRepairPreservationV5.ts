import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { sanitizeWeeklyPlanningConversationActsV5, type SemanticConversationActV5 } from './weeklyPlanningConversationActsV5';

const AVAILABILITY_DATE_REPRESENTATION_ERROR =
  /^document\.availabilityDeclarations\[(\d+)]\.dateExpression:canonical-expression$/;
const TEMPORAL_DATE_REPRESENTATION_ERROR =
  /^document\.tasks\[(\d+)]\.temporalConstraints\[(\d+)]\.dateExpression:canonical-expression(?:-required)?$/;
const FIXED_INTERVAL_LEVEL_ERROR =
  /^document\.tasks\[(\d+)]\.temporalConstraints\[(\d+)]\.constraintLevel:soft-fixed-interval-use-preferred-window$/;

const REPRESENTATION_ONLY_ERROR_PATTERNS = [
  /^document\.planningWindow:/,
  /^document\.planningWindow\.value:/,
  /^document\.userContextFacts\[\d+]\.dateExpression:unsupported-expression$/,
  /^availabilityDeclarations\[[^\]]+\]: namedTimePeriod must be null/,
  /^availabilityDeclarations\[[^\]]+\]: explicit clock text must use startTime\/endTime/,
  /^temporalConstraints\[[^\]]+\]: namedTimePeriod must be null/,
  /^temporalConstraints\[[^\]]+\]: explicit clock text must use startTime\/endTime/,
  /^availabilityDeclarations\[[^\]]+\]\.days:canonical-weekday-required:/,
  /^recurrence\[[^\]]+\]\.days:canonical-weekday-required:/,
  AVAILABILITY_DATE_REPRESENTATION_ERROR,
  TEMPORAL_DATE_REPRESENTATION_ERROR,
] as const;

interface MutableRecord {
  [key: string]: unknown;
}

const REQUIRED_ARRAY_KEYS = [
  'tasks',
  'relations',
  'availabilityDeclarations',
  'constraintSourceRequests',
  'uncertainties',
  'corrections',
  'decisions',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneDocument(document: WeeklyPlanningSemanticDocumentV5): MutableRecord {
  const clone = structuredClone(document) as unknown as MutableRecord;
  for (const key of ['userContextFacts', 'conversationActs']) {
    if (clone[key] === undefined) clone[key] = [];
  }
  return clone;
}

function idsMatching(
  errors: readonly string[],
  pattern: RegExp,
): Set<string> {
  const ids = new Set<string>();
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

function redactUserContextDateRepresentation(
  document: MutableRecord,
  factIndexes: ReadonlySet<string>,
): void {
  const facts = document.userContextFacts;
  if (!Array.isArray(facts)) return;
  for (const indexText of factIndexes) {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0 || index >= facts.length) continue;
    const fact = facts[index];
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) continue;
    (fact as MutableRecord).dateExpression = '__REPAIRABLE_USER_CONTEXT_DATE__';
  }
}

/** Only validator-addressed date fields may change; this never interprets their text. */
function redactCanonicalDateRepresentations(
  document: MutableRecord,
  errors: readonly string[],
): void {
  for (const error of errors) {
    const availability = AVAILABILITY_DATE_REPRESENTATION_ERROR.exec(error);
    const temporal = TEMPORAL_DATE_REPRESENTATION_ERROR.exec(error);
    let fact: unknown;
    if (availability && Array.isArray(document.availabilityDeclarations)) {
      fact = document.availabilityDeclarations[Number(availability[1])];
    } else if (temporal && Array.isArray(document.tasks)) {
      const task = document.tasks[Number(temporal[1])];
      if (isRecord(task) && Array.isArray(task.temporalConstraints)) {
        fact = task.temporalConstraints[Number(temporal[2])];
      }
    }
    if (isRecord(fact)) fact.dateExpression = '__REPAIRABLE_CANONICAL_DATE__';
  }
}

function redactFixedIntervalLevels(document: MutableRecord, errors: readonly string[]): void {
  for (const error of errors) {
    const match = FIXED_INTERVAL_LEVEL_ERROR.exec(error);
    if (!match || !Array.isArray(document.tasks)) continue;
    const task = document.tasks[Number(match[1])];
    if (!isRecord(task) || !Array.isArray(task.temporalConstraints)) continue;
    const constraint = task.temporalConstraints[Number(match[2])];
    if (isRecord(constraint)) constraint.constraintLevel = '__REPAIRABLE_CONSTRAINT_LEVEL__';
  }
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
  temporalClockIds: ReadonlySet<string>,
  recurrenceWeekdayIds: ReadonlySet<string>,
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
        if (localId && temporalClockIds.has(localId)) {
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
        if (localId && recurrenceWeekdayIds.has(localId)) {
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

function isPreservationGuardedRepair(errors: readonly string[]): boolean {
  return errors.length > 0 && errors.every(error => FIXED_INTERVAL_LEVEL_ERROR.test(error)
    || REPRESENTATION_ONLY_ERROR_PATTERNS.some(pattern => pattern.test(error)));
}

function changedAddressedFixedInterval(params: {
  initial: WeeklyPlanningSemanticDocumentV5;
  repaired: WeeklyPlanningSemanticDocumentV5;
  errors: readonly string[];
}): boolean {
  for (const error of params.errors) {
    const match = FIXED_INTERVAL_LEVEL_ERROR.exec(error);
    if (!match) continue;
    const task = params.initial.tasks[Number(match[1])];
    const constraint = task?.temporalConstraints?.[Number(match[2])];
    if (!constraint?.localId) return true;
    const candidates = params.repaired.tasks.flatMap(task =>
      Array.isArray(task?.temporalConstraints) ? task.temporalConstraints
        .filter(candidate => candidate?.localId === constraint.localId).map(candidate => ({ task, constraint: candidate })) : []);
    if (candidates.length !== 1 || candidates[0].task.localId !== task.localId) return true;
    const before: MutableRecord = { ...constraint };
    const after: MutableRecord = { ...candidates[0].constraint };
    delete before.constraintLevel;
    delete after.constraintLevel;
    if (params.errors.some(error => {
      const date = TEMPORAL_DATE_REPRESENTATION_ERROR.exec(error);
      return date?.[1] === match[1] && date?.[2] === match[2];
    })) {
      delete before.dateExpression;
      delete after.dateExpression;
    }
    if (after.kind !== 'fixed_interval' || stableSerialize(before) !== stableSerialize(after)) return true;
  }
  return false;
}

/** The provider's document as written (after pre-parse normalization), before validation. */
export function readWeeklyPlanningSemanticProviderDocumentV5(
  rawResponse: string,
): WeeklyPlanningSemanticDocumentV5 | null {
  try {
    const value = JSON.parse(rawResponse) as unknown;
    if (!isRecord(value)) return null;
    if (value.schemaVersion !== WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5) return null;
    if (typeof value.planningIntent !== 'string') return null;
    if (value.planningWindow !== null && !isRecord(value.planningWindow)) return null;
    if (REQUIRED_ARRAY_KEYS.some((key) => !Array.isArray(value[key]))) return null;
    if (value.userContextFacts !== undefined && !Array.isArray(value.userContextFacts)) return null;
    return structuredClone(value) as unknown as WeeklyPlanningSemanticDocumentV5;
  } catch {
    return null;
  }
}

export function readWeeklyPlanningRepresentationRepairBaselineV5(params: {
  rawResponse: string;
  validationErrors: readonly string[];
}): WeeklyPlanningSemanticDocumentV5 | null {
  if (!isPreservationGuardedRepair(params.validationErrors)) return null;
  return readWeeklyPlanningSemanticProviderDocumentV5(params.rawResponse);
}

export function validateWeeklyPlanningSemanticRepairPreservationV5(params: {
  initialDocument: WeeklyPlanningSemanticDocumentV5 | null;
  repairedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  initialErrors: readonly string[];
  initialConversationActs?: readonly SemanticConversationActV5[];
}): string[] {
  if (
    !params.initialDocument
    || !params.repairedDocument
  ) {
    return params.initialErrors.some(error => FIXED_INTERVAL_LEVEL_ERROR.test(error))
      || (params.initialConversationActs?.length ?? params.initialDocument?.conversationActs?.length ?? 0) > 0
      ? ['semantic-repair-preservation:comparison-document-unavailable'] : [];
  }

  if (changedAddressedFixedInterval({ initial: params.initialDocument, repaired: params.repairedDocument,
    errors: params.initialErrors })) {
    return ['semantic-repair-preservation:representation-only repair changed unrelated semantic facts'];
  }
  const guardedRepair = isPreservationGuardedRepair(params.initialErrors);
  if (!guardedRepair) {
    const acts = sanitizeWeeklyPlanningConversationActsV5(params.initialDocument.conversationActs);
    if (acts.diagnostics.length > 0
      || params.initialErrors.some(error => /^(?:document\.)?conversationActs(?:\[|:|\.)/.test(error))) return [];
    const remaining = sanitizeWeeklyPlanningConversationActsV5(params.repairedDocument.conversationActs).acts.map(stableSerialize);
    // Repair may recover supported omissions, but cannot erase valid existing acts.
    for (const act of acts.acts) {
      const index = remaining.indexOf(stableSerialize(act));
      if (index < 0) return ['semantic-repair-preservation:repair changed unrelated conversation acts'];
      remaining.splice(index, 1);
    }
    return [];
  }

  const initial = cloneDocument(params.initialDocument);
  const repaired = cloneDocument(params.repairedDocument);

  if (params.initialErrors.some((error) => error.startsWith('document.planningWindow'))) {
    redactPlanningWindowRepresentation(initial);
    redactPlanningWindowRepresentation(repaired);
  }

  const userContextDateIndexes = idsMatching(
    params.initialErrors,
    /^document\.userContextFacts\[(\d+)]\.dateExpression:unsupported-expression$/,
  );
  redactUserContextDateRepresentation(initial, userContextDateIndexes);
  redactUserContextDateRepresentation(repaired, userContextDateIndexes);
  redactCanonicalDateRepresentations(initial, params.initialErrors);
  redactCanonicalDateRepresentations(repaired, params.initialErrors);
  redactFixedIntervalLevels(initial, params.initialErrors);
  redactFixedIntervalLevels(repaired, params.initialErrors);

  const availabilityClockIds = idsMatching(
    params.initialErrors,
    /^availabilityDeclarations\[([^\]]+)\]: (?:namedTimePeriod must be null|explicit clock text must use startTime\/endTime)/,
  );
  const availabilityWeekdayIds = idsMatching(
    params.initialErrors,
    /^availabilityDeclarations\[([^\]]+)\]\.days:canonical-weekday-required:/,
  );
  redactAvailabilityRepresentation(initial, availabilityClockIds, availabilityWeekdayIds);
  redactAvailabilityRepresentation(repaired, availabilityClockIds, availabilityWeekdayIds);

  const temporalClockIds = idsMatching(
    params.initialErrors,
    /^temporalConstraints\[([^\]]+)\]: (?:namedTimePeriod must be null|explicit clock text must use startTime\/endTime)/,
  );
  const recurrenceWeekdayIds = idsMatching(
    params.initialErrors,
    /^recurrence\[([^\]]+)\]\.days:canonical-weekday-required:/,
  );
  redactTaskNestedRepresentation(initial, temporalClockIds, recurrenceWeekdayIds);
  redactTaskNestedRepresentation(repaired, temporalClockIds, recurrenceWeekdayIds);

  if (stableSerialize(initial) === stableSerialize(repaired)) return [];
  return [
    'semantic-repair-preservation:representation-only repair changed unrelated semantic facts',
  ];
}
