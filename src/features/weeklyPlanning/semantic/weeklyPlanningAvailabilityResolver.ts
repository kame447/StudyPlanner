import type {
  AvailabilityDeclarationFact,
  ConstraintSourceRequestFact,
  WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import type {
  SemanticConstraintSourceKind,
  SemanticNamedTimePeriod,
} from './weeklyPlanningSemanticDocumentV2';

export interface LocalDateTimePoint {
  date: string;
  time: string;
}

export interface AvailabilityWindowFact {
  id: string;
  kind: 'occupied' | 'unavailable' | 'available' | 'preferred' | 'avoided';
  start: LocalDateTimePoint;
  end: LocalDateTimePoint;
  timeZone: string;
  constraintLevel: 'hard' | 'soft';
  sourceKind:
    | 'user_declaration'
    | 'timetable'
    | 'existing_plan'
    | 'calendar';
  sourceRef: string;
  ownerId: string;
  graphRevision: number;
}

export interface ConstraintSourceSelectionFact {
  id: string;
  requestFactId: string;
  kind: SemanticConstraintSourceKind;
  selector: 'active';
  status: 'selected' | 'deselected';
  sourceId: string | null;
  ownerId: string;
  graphRevision: number;
}

export interface ExternalConstraintEvent {
  eventId: string;
  ownerId: string;
  start: LocalDateTimePoint;
  end: LocalDateTimePoint;
  timeZone: string;
  constraintLevel: 'hard' | 'soft';
}

export interface ExternalConstraintSourceSnapshot {
  kind: SemanticConstraintSourceKind;
  ownerId: string;
  activeSourceId: string | null;
  status: 'complete' | 'partial' | 'unavailable';
  events: ExternalConstraintEvent[];
}

export interface AvailabilityResolutionContext {
  ownerId: string;
  currentDate: string;
  planningStartDate: string;
  planningEndDate: string;
  timeZone: string;
  namedTimePeriods?: Partial<
    Record<SemanticNamedTimePeriod, { startTime: string; endTime: string }>
  >;
}

export type AvailabilityResolutionIssueCode =
  | 'invalid_planning_date_range'
  | 'unsupported_date_expression'
  | 'availability_outside_planning_window'
  | 'missing_availability_date_scope'
  | 'missing_time_bounds'
  | 'named_time_period_unresolved'
  | 'unknown_constraint_level'
  | 'invalid_weekday'
  | 'invalid_time_interval'
  | 'constraint_source_unavailable'
  | 'constraint_source_partial'
  | 'active_constraint_source_missing'
  | 'constraint_source_owner_mismatch'
  | 'constraint_event_owner_mismatch'
  | 'invalid_constraint_event';

export interface AvailabilityResolutionIssue {
  code: AvailabilityResolutionIssueCode;
  sourceFactId: string;
  blocking: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface AvailabilityResolutionResult {
  windows: AvailabilityWindowFact[];
  sourceSelections: ConstraintSourceSelectionFact[];
  issues: AvailabilityResolutionIssue[];
  readiness: 'ready' | 'needs_resolution' | 'empty';
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const RESOLVED_CLOCK_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createId(prefix: string, input: string): string {
  return `${prefix}_${stableHash(`${prefix}|${input}`)}`;
}

function parseDate(value: string): Date | null {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number): string | null {
  const date = parseDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDate(date);
}

function compareDate(left: string, right: string): number {
  return left.localeCompare(right);
}

function dateRange(start: string, end: string): string[] | null {
  if (!parseDate(start) || !parseDate(end) || compareDate(start, end) > 0) return null;
  const values: string[] = [];
  let current = start;
  while (compareDate(current, end) <= 0) {
    values.push(current);
    const next = addDays(current, 1);
    if (!next) return null;
    current = next;
  }
  return values;
}

function dayOfWeek(value: string): number | null {
  const date = parseDate(value);
  return date ? date.getUTCDay() : null;
}

function mondayOfWeek(value: string): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(value, offset);
}

function resolveDateExpression(
  expression: string,
  currentDate: string,
): { start: string; end: string } | null {
  if (ISO_DATE_PATTERN.test(expression)) return { start: expression, end: expression };
  if (expression === 'today') return { start: currentDate, end: currentDate };
  if (expression === 'tomorrow') {
    const date = addDays(currentDate, 1);
    return date ? { start: date, end: date } : null;
  }
  if (expression === 'day_after_tomorrow') {
    const date = addDays(currentDate, 2);
    return date ? { start: date, end: date } : null;
  }
  const monday = mondayOfWeek(currentDate);
  if (!monday) return null;
  if (expression === 'this_week') {
    const sunday = addDays(monday, 6);
    return sunday ? { start: monday, end: sunday } : null;
  }
  if (expression === 'next_week') {
    const start = addDays(monday, 7);
    const end = addDays(monday, 13);
    return start && end ? { start, end } : null;
  }
  return null;
}

function intersectDates(
  dates: string[],
  planningStart: string,
  planningEnd: string,
): string[] {
  return dates.filter((date) =>
    compareDate(date, planningStart) >= 0 && compareDate(date, planningEnd) <= 0);
}

function recurrenceDates(params: {
  declaration: AvailabilityDeclarationFact;
  planningDates: string[];
  issues: AvailabilityResolutionIssue[];
}): string[] | null {
  const recurrence = params.declaration.recurrenceKind;
  if (!recurrence) return null;
  if (recurrence === 'daily') return [...params.planningDates];
  if (recurrence === 'weekdays') {
    return params.planningDates.filter((date) => {
      const day = dayOfWeek(date);
      return day !== null && day >= 1 && day <= 5;
    });
  }
  if (recurrence === 'weekends') {
    return params.planningDates.filter((date) => {
      const day = dayOfWeek(date);
      return day === 0 || day === 6;
    });
  }

  const dayIndexes = new Set<number>();
  for (const day of params.declaration.days) {
    const index = WEEKDAY_INDEX[day];
    if (index === undefined) {
      params.issues.push({
        code: 'invalid_weekday',
        sourceFactId: params.declaration.id,
        blocking: true,
        details: { day },
      });
    } else {
      dayIndexes.add(index);
    }
  }
  if (dayIndexes.size === 0) return null;
  return params.planningDates.filter((date) => {
    const day = dayOfWeek(date);
    return day !== null && dayIndexes.has(day);
  });
}

function resolveDeclarationDates(params: {
  declaration: AvailabilityDeclarationFact;
  context: AvailabilityResolutionContext;
  planningDates: string[];
  issues: AvailabilityResolutionIssue[];
}): string[] {
  let dates: string[] | null = recurrenceDates({
    declaration: params.declaration,
    planningDates: params.planningDates,
    issues: params.issues,
  });

  if (params.declaration.dateExpression) {
    if (params.declaration.dateExpression.startsWith('custom:')) {
      params.issues.push({
        code: 'unsupported_date_expression',
        sourceFactId: params.declaration.id,
        blocking: true,
        details: { expression: params.declaration.dateExpression },
      });
      return [];
    }
    const range = resolveDateExpression(
      params.declaration.dateExpression,
      params.context.currentDate,
    );
    if (!range) {
      params.issues.push({
        code: 'unsupported_date_expression',
        sourceFactId: params.declaration.id,
        blocking: true,
        details: { expression: params.declaration.dateExpression },
      });
      return [];
    }
    const expressionDates = dateRange(range.start, range.end) ?? [];
    dates = dates
      ? dates.filter((date) => expressionDates.includes(date))
      : expressionDates;
  }

  if (!dates) {
    dates = params.planningDates.length === 1 ? [...params.planningDates] : [];
    if (dates.length === 0) {
      params.issues.push({
        code: 'missing_availability_date_scope',
        sourceFactId: params.declaration.id,
        blocking: true,
      });
    }
  }

  const inWindow = intersectDates(
    dates,
    params.context.planningStartDate,
    params.context.planningEndDate,
  );
  if (dates.length > 0 && inWindow.length === 0) {
    params.issues.push({
      code: 'availability_outside_planning_window',
      sourceFactId: params.declaration.id,
      blocking: false,
    });
  }
  return inWindow;
}

function resolveTimeBounds(params: {
  declaration: AvailabilityDeclarationFact;
  context: AvailabilityResolutionContext;
  issues: AvailabilityResolutionIssue[];
}): { startTime: string; endTime: string } | null {
  let startTime = params.declaration.startTime;
  let endTime = params.declaration.endTime;

  if (!startTime && !endTime && params.declaration.namedTimePeriod) {
    const bounds = params.context.namedTimePeriods?.[params.declaration.namedTimePeriod];
    if (!bounds) {
      params.issues.push({
        code: 'named_time_period_unresolved',
        sourceFactId: params.declaration.id,
        blocking: true,
        details: { namedTimePeriod: params.declaration.namedTimePeriod },
      });
      return null;
    }
    startTime = bounds.startTime;
    endTime = bounds.endTime;
  }

  if (!startTime && !endTime) {
    params.issues.push({
      code: 'missing_time_bounds',
      sourceFactId: params.declaration.id,
      blocking: true,
    });
    return null;
  }
  startTime = startTime ?? '00:00';
  endTime = endTime ?? '24:00';
  if (!RESOLVED_CLOCK_PATTERN.test(startTime)
    || !RESOLVED_CLOCK_PATTERN.test(endTime)
    || startTime === '24:00'
    || startTime === endTime) {
    params.issues.push({
      code: 'invalid_time_interval',
      sourceFactId: params.declaration.id,
      blocking: true,
      details: { startTime, endTime },
    });
    return null;
  }
  return { startTime, endTime };
}

function endPoint(date: string, startTime: string, endTime: string): LocalDateTimePoint | null {
  if (endTime === '24:00') {
    const nextDate = addDays(date, 1);
    return nextDate ? { date: nextDate, time: '00:00' } : null;
  }
  if (endTime < startTime) {
    const nextDate = addDays(date, 1);
    return nextDate ? { date: nextDate, time: endTime } : null;
  }
  return { date, time: endTime };
}

function sourceKindForExternal(kind: SemanticConstraintSourceKind): AvailabilityWindowFact['sourceKind'] {
  if (kind === 'timetable') return 'timetable';
  if (kind === 'existing_plans') return 'existing_plan';
  return 'calendar';
}

function validateExternalEvent(event: ExternalConstraintEvent): boolean {
  return Boolean(
    isValidLocalPoint(event.start)
    && isValidLocalPoint(event.end)
    && compareLocalPoint(event.start, event.end) < 0
    && event.timeZone.trim(),
  );
}

function isValidLocalPoint(point: LocalDateTimePoint): boolean {
  return Boolean(parseDate(point.date) && CLOCK_PATTERN.test(point.time));
}

function compareLocalPoint(left: LocalDateTimePoint, right: LocalDateTimePoint): number {
  return `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`);
}

function resolveUserDeclarations(params: {
  graph: WeeklyPlanningFactGraphV2;
  context: AvailabilityResolutionContext;
  planningDates: string[];
  issues: AvailabilityResolutionIssue[];
}): AvailabilityWindowFact[] {
  const windows: AvailabilityWindowFact[] = [];
  for (const declaration of params.graph.availabilityDeclarations) {
    if (declaration.constraintLevel === 'unknown') {
      params.issues.push({
        code: 'unknown_constraint_level',
        sourceFactId: declaration.id,
        blocking: true,
      });
      continue;
    }
    const dates = resolveDeclarationDates({
      declaration,
      context: params.context,
      planningDates: params.planningDates,
      issues: params.issues,
    });
    const bounds = resolveTimeBounds({
      declaration,
      context: params.context,
      issues: params.issues,
    });
    if (!bounds) continue;

    for (const date of dates) {
      const end = endPoint(date, bounds.startTime, bounds.endTime);
      if (!end) {
        params.issues.push({
          code: 'invalid_time_interval',
          sourceFactId: declaration.id,
          blocking: true,
        });
        continue;
      }
      windows.push({
        id: createId(
          'wpaw',
          [declaration.id, date, bounds.startTime, end.date, end.time].join('|'),
        ),
        kind: declaration.kind,
        start: { date, time: bounds.startTime },
        end,
        timeZone: params.context.timeZone,
        constraintLevel: declaration.constraintLevel,
        sourceKind: 'user_declaration',
        sourceRef: declaration.id,
        ownerId: params.context.ownerId,
        graphRevision: params.graph.revision,
      });
    }
  }
  return windows;
}

function resolveExternalSources(params: {
  graph: WeeklyPlanningFactGraphV2;
  context: AvailabilityResolutionContext;
  sources: ExternalConstraintSourceSnapshot[];
  issues: AvailabilityResolutionIssue[];
}): {
  windows: AvailabilityWindowFact[];
  selections: ConstraintSourceSelectionFact[];
} {
  const windows: AvailabilityWindowFact[] = [];
  const selections: ConstraintSourceSelectionFact[] = [];
  const sourceByKind = new Map(params.sources.map((source) => [source.kind, source]));

  for (const request of params.graph.constraintSourceRequests) {
    if (request.requestedAction === 'stop_using') {
      selections.push({
        id: createId('wpcs', `${request.id}|deselected`),
        requestFactId: request.id,
        kind: request.kind,
        selector: request.selector,
        status: 'deselected',
        sourceId: null,
        ownerId: params.context.ownerId,
        graphRevision: params.graph.revision,
      });
      continue;
    }

    const source = sourceByKind.get(request.kind);
    if (!source || source.status === 'unavailable') {
      params.issues.push({
        code: 'constraint_source_unavailable',
        sourceFactId: request.id,
        blocking: true,
        details: { kind: request.kind },
      });
      continue;
    }
    if (source.ownerId !== params.context.ownerId) {
      params.issues.push({
        code: 'constraint_source_owner_mismatch',
        sourceFactId: request.id,
        blocking: true,
        details: { kind: request.kind },
      });
      continue;
    }
    if (source.status === 'partial') {
      params.issues.push({
        code: 'constraint_source_partial',
        sourceFactId: request.id,
        blocking: true,
        details: { kind: request.kind },
      });
      continue;
    }
    if (!source.activeSourceId) {
      params.issues.push({
        code: 'active_constraint_source_missing',
        sourceFactId: request.id,
        blocking: true,
        details: { kind: request.kind },
      });
      continue;
    }

    const imported: AvailabilityWindowFact[] = [];
    let rejectedSource = false;
    for (const event of source.events) {
      if (event.ownerId !== params.context.ownerId) {
        params.issues.push({
          code: 'constraint_event_owner_mismatch',
          sourceFactId: request.id,
          blocking: true,
          details: { eventId: event.eventId },
        });
        rejectedSource = true;
        break;
      }
      if (!validateExternalEvent(event)) {
        params.issues.push({
          code: 'invalid_constraint_event',
          sourceFactId: request.id,
          blocking: true,
          details: { eventId: event.eventId },
        });
        rejectedSource = true;
        break;
      }
      imported.push({
        id: createId('wpaw', `${request.kind}|${source.activeSourceId}|${event.eventId}`),
        kind: 'occupied',
        start: event.start,
        end: event.end,
        timeZone: event.timeZone,
        constraintLevel: event.constraintLevel,
        sourceKind: sourceKindForExternal(request.kind),
        sourceRef: event.eventId,
        ownerId: params.context.ownerId,
        graphRevision: params.graph.revision,
      });
    }
    if (rejectedSource) continue;

    selections.push({
      id: createId('wpcs', `${request.id}|${source.activeSourceId}|selected`),
      requestFactId: request.id,
      kind: request.kind,
      selector: request.selector,
      status: 'selected',
      sourceId: source.activeSourceId,
      ownerId: params.context.ownerId,
      graphRevision: params.graph.revision,
    });
    windows.push(...imported);
  }

  return { windows, selections };
}

function dedupeWindows(windows: AvailabilityWindowFact[]): AvailabilityWindowFact[] {
  const seen = new Set<string>();
  return windows.filter((window) => {
    const key = [
      window.sourceKind,
      window.sourceRef,
      window.start.date,
      window.start.time,
      window.end.date,
      window.end.time,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveWeeklyPlanningAvailability(params: {
  graph: WeeklyPlanningFactGraphV2;
  context: AvailabilityResolutionContext;
  externalSources?: ExternalConstraintSourceSnapshot[];
}): AvailabilityResolutionResult {
  const planningDates = dateRange(
    params.context.planningStartDate,
    params.context.planningEndDate,
  );
  if (!planningDates || !parseDate(params.context.currentDate)) {
    return {
      windows: [],
      sourceSelections: [],
      issues: [{
        code: 'invalid_planning_date_range',
        sourceFactId: 'planning-context',
        blocking: true,
      }],
      readiness: 'needs_resolution',
    };
  }

  const issues: AvailabilityResolutionIssue[] = [];
  const userWindows = resolveUserDeclarations({
    graph: params.graph,
    context: params.context,
    planningDates,
    issues,
  });
  const external = resolveExternalSources({
    graph: params.graph,
    context: params.context,
    sources: params.externalSources ?? [],
    issues,
  });
  const windows = dedupeWindows([...userWindows, ...external.windows]);
  const blocking = issues.some((issue) => issue.blocking);

  return {
    windows,
    sourceSelections: external.selections,
    issues,
    readiness: windows.length === 0 && external.selections.length === 0
      ? blocking
        ? 'needs_resolution'
        : 'empty'
      : blocking
        ? 'needs_resolution'
        : 'ready',
  };
}
