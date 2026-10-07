import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  conversationArchitecturePolicy,
  type WeeklyPlanningConversationArchitecture,
} from '../weeklyPlanningConversationArchitecture';

const AVAILABILITY_DATE_REPRESENTATION_ERROR =
  /^document\.availabilityDeclarations\[(\d+)]\.dateExpression:canonical-expression$/;
const TEMPORAL_DATE_REPRESENTATION_ERROR =
  /^document\.tasks\[(\d+)]\.temporalConstraints\[(\d+)]\.dateExpression:canonical-expression(?:-required)?$/;

// legacy_v5 is the historical comparison and keeps its pre-#488 guard: date
// canonicalization repairs are not preservation-guarded there.
const LEGACY_REPRESENTATION_ONLY_ERROR_PATTERNS = [
  /^document\.planningWindow:/,
  /^document\.planningWindow\.value:/,
  /^document\.userContextFacts\[\d+]\.dateExpression:unsupported-expression$/,
  /^availabilityDeclarations\[[^\]]+\]: namedTimePeriod must be null/,
  /^availabilityDeclarations\[[^\]]+\]: explicit clock text must use startTime\/endTime/,
  /^temporalConstraints\[[^\]]+\]: namedTimePeriod must be null/,
  /^temporalConstraints\[[^\]]+\]: explicit clock text must use startTime\/endTime/,
  /^availabilityDeclarations\[[^\]]+\]\.days:canonical-weekday-required:/,
  /^recurrence\[[^\]]+\]\.days:canonical-weekday-required:/,
] as const;

const REPRESENTATION_ONLY_ERROR_PATTERNS = [
  ...LEGACY_REPRESENTATION_ONLY_ERROR_PATTERNS,
  AVAILABILITY_DATE_REPRESENTATION_ERROR,
  TEMPORAL_DATE_REPRESENTATION_ERROR,
] as const;

// Several facts of these kinds compose as a union (alternative preferred windows,
// allowed or excluded dates), so one fact over a recurring weekday set may be restated
// as one fact per weekday. Bounds, deadlines, fixed intervals and avoid windows never split.
const SPLITTABLE_TASK_DATE_KINDS: ReadonlySet<string> = new Set([
  'preferred_window',
  'allowed_date',
  'excluded_date',
]);
const REPAIRABLE_CANONICAL_DATE = '__REPAIRABLE_CANONICAL_DATE__';

interface MutableRecord {
  [key: string]: unknown;
}

const REQUIRED_ARRAY_KEYS = [
  'tasks',
  'relations',
  'availabilityDeclarations',
  'constraintSourceRequests',
  'userContextFacts',
  'uncertainties',
  'corrections',
  'decisions',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneDocument(document: WeeklyPlanningSemanticDocumentV5): MutableRecord {
  return structuredClone(document) as unknown as MutableRecord;
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

/** Only validator-addressed date scope may change; this never interprets its text. */
function redactAvailabilityDateRepresentations(
  document: MutableRecord,
  errors: readonly string[],
): void {
  if (!Array.isArray(document.availabilityDeclarations)) return;
  for (const error of errors) {
    const match = AVAILABILITY_DATE_REPRESENTATION_ERROR.exec(error);
    const fact = match ? document.availabilityDeclarations[Number(match[1])] : undefined;
    if (!isRecord(fact)) continue;
    // A weekday set belongs in recurrenceKind/days of the same declaration.
    fact.dateExpression = REPAIRABLE_CANONICAL_DATE;
    fact.recurrenceKind = '__REPAIRABLE_RECURRENCE_KIND__';
    fact.days = ['__REPAIRABLE_WEEKDAY_TOKENS__'];
  }
}

function withoutDateIdentity(fact: Record<string, unknown>): string {
  const { localId: _localId, dateExpression: _dateExpression, ...rest } = fact;
  return stableSerialize(rest);
}

function bySerialization(facts: readonly unknown[]): unknown[] {
  return facts
    .map((fact) => ({ fact, key: stableSerialize(fact) }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map(({ fact }) => fact);
}

/**
 * Only validator-addressed task date facts may change their date. A splittable fact may be
 * restated as several facts that differ from it only by localId and distinct dateExpression
 * (a recurring weekday set has no single dateExpression). Structure is compared; the date
 * text is never interpreted, and dropping the fact or changing any other field still fails.
 */
function normalizeTaskDateRepresentations(
  initial: MutableRecord,
  repaired: MutableRecord,
  errors: readonly string[],
): number[] {
  const flaggedByTask = new Map<number, Set<number>>();
  for (const error of errors) {
    const match = TEMPORAL_DATE_REPRESENTATION_ERROR.exec(error);
    if (!match) continue;
    const flagged = flaggedByTask.get(Number(match[1])) ?? new Set<number>();
    flagged.add(Number(match[2]));
    flaggedByTask.set(Number(match[1]), flagged);
  }
  for (const [taskIndex, flagged] of flaggedByTask) {
    const initialTask = Array.isArray(initial.tasks) ? initial.tasks[taskIndex] : undefined;
    if (!isRecord(initialTask) || !Array.isArray(initialTask.temporalConstraints)) continue;
    const repairedTask = Array.isArray(repaired.tasks) ? repaired.tasks[taskIndex] : undefined;
    const initialFacts: unknown[] = [...initialTask.temporalConstraints];
    const repairedFacts: unknown[] | null = isRecord(repairedTask)
      && Array.isArray(repairedTask.temporalConstraints)
      ? [...repairedTask.temporalConstraints]
      : null;
    const unflagged = new Set(initialFacts
      .filter((_, index) => !flagged.has(index))
      .map(stableSerialize));
    for (const index of [...flagged].sort((left, right) => left - right)) {
      const fact = initialFacts[index];
      if (!isRecord(fact)) continue;
      const placeholder = { ...fact, dateExpression: REPAIRABLE_CANONICAL_DATE };
      initialFacts[index] = placeholder;
      if (!repairedFacts) continue;
      const signature = withoutDateIdentity(fact);
      const restated = repairedFacts.filter((candidate): candidate is MutableRecord =>
        isRecord(candidate)
        && !unflagged.has(stableSerialize(candidate))
        && withoutDateIdentity(candidate) === signature);
      if (restated.length === 1) {
        const at = repairedFacts.indexOf(restated[0]);
        repairedFacts[at] = { ...restated[0], dateExpression: REPAIRABLE_CANONICAL_DATE };
      } else if (
        restated.length > 1
        && SPLITTABLE_TASK_DATE_KINDS.has(String(fact.kind))
        && new Set(restated.map((member) => member.dateExpression)).size === restated.length
      ) {
        repairedFacts.splice(repairedFacts.indexOf(restated[0]), 1, placeholder);
        for (const member of restated.slice(1)) {
          repairedFacts.splice(repairedFacts.indexOf(member), 1);
        }
      }
    }
    initialTask.temporalConstraints = initialFacts;
    if (repairedFacts && isRecord(repairedTask)) repairedTask.temporalConstraints = repairedFacts;
  }
  return [...flaggedByTask.keys()];
}

/** Task date facts are an unordered set; a split may place its members anywhere. */
function sortTaskDateFacts(document: MutableRecord, taskIndexes: readonly number[]): void {
  for (const taskIndex of taskIndexes) {
    const task = Array.isArray(document.tasks) ? document.tasks[taskIndex] : undefined;
    if (isRecord(task) && Array.isArray(task.temporalConstraints)) {
      task.temporalConstraints = bySerialization(task.temporalConstraints);
    }
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
  conversationArchitecture?: WeeklyPlanningConversationArchitecture,
): boolean {
  const patterns: readonly RegExp[] = conversationArchitecturePolicy(conversationArchitecture)
    .semanticConversationActs
    ? REPRESENTATION_ONLY_ERROR_PATTERNS
    : LEGACY_REPRESENTATION_ONLY_ERROR_PATTERNS;
  return errors.length > 0
    && errors.every((error) => patterns.some((pattern) => pattern.test(error)));
}

export function readWeeklyPlanningRepresentationRepairBaselineV5(params: {
  rawResponse: string;
  validationErrors: readonly string[];
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
}): WeeklyPlanningSemanticDocumentV5 | null {
  if (!isRepresentationOnlySemanticRepairV5(
    params.validationErrors,
    params.conversationArchitecture,
  )) return null;
  try {
    const value = JSON.parse(params.rawResponse) as unknown;
    if (!isRecord(value)) return null;
    if (value.schemaVersion !== WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5) return null;
    if (typeof value.planningIntent !== 'string') return null;
    if (value.planningWindow !== null && !isRecord(value.planningWindow)) return null;
    if (REQUIRED_ARRAY_KEYS.some((key) => !Array.isArray(value[key]))) return null;
    return structuredClone(value) as unknown as WeeklyPlanningSemanticDocumentV5;
  } catch {
    return null;
  }
}

export function validateWeeklyPlanningSemanticRepairPreservationV5(params: {
  initialDocument: WeeklyPlanningSemanticDocumentV5 | null;
  repairedDocument: WeeklyPlanningSemanticDocumentV5 | null;
  initialErrors: readonly string[];
  conversationArchitecture?: WeeklyPlanningConversationArchitecture;
}): string[] {
  if (
    !params.initialDocument
    || !params.repairedDocument
    || !isRepresentationOnlySemanticRepairV5(params.initialErrors, params.conversationArchitecture)
  ) {
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
  redactAvailabilityDateRepresentations(initial, params.initialErrors);
  redactAvailabilityDateRepresentations(repaired, params.initialErrors);
  const taskDateIndexes = normalizeTaskDateRepresentations(initial, repaired, params.initialErrors);

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
  sortTaskDateFacts(initial, taskDateIndexes);
  sortTaskDateFacts(repaired, taskDateIndexes);

  if (stableSerialize(initial) === stableSerialize(repaired)) return [];
  return [
    'semantic-repair-preservation:representation-only repair changed unrelated semantic facts',
  ];
}
