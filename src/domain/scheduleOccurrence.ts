import { addDays } from '../lib/date';
import {
  getMonthEventEndDate,
  getMonthEventOccurrenceStartDate,
} from '../lib/monthEvents';
import {
  expandPlansForDateRange,
  getRecurrenceWeekday,
} from '../lib/planRecurrence';
import { resolveTimetableTermForDate } from '../lib/timetableCalendar';
import { buildTimetableImportCandidates } from '../lib/timetableImport';
import type {
  MonthEvent,
  Plan,
  PlanSourceType,
  ScheduleTemplate,
  TimetableTerm,
} from '../types/domain';

export type ScheduleOccurrenceSourceKind = 'plan' | 'month-event' | 'timetable';
export type ScheduleOccurrenceBackingKind =
  | 'plan'
  | 'month-event'
  | 'timetable-template';
export type ScheduleOccurrenceCategory =
  | 'study'
  | 'class'
  | 'exam'
  | 'school'
  | 'cram-school'
  | 'deadline'
  | 'other';

export interface ScheduleOccurrencePoint {
  date: string;
  time: string;
}

export interface ScheduleOccurrenceSource {
  kind: ScheduleOccurrenceSourceKind;
  id: string;
  backingKind: ScheduleOccurrenceBackingKind;
  backingId: string;
}

export interface ScheduleOccurrence {
  id: string;
  ownerId: string;
  title: string;
  subject: string;
  category: ScheduleOccurrenceCategory;
  busy: boolean;
  start: ScheduleOccurrencePoint;
  end: ScheduleOccurrencePoint;
  source: ScheduleOccurrenceSource;
  planSourceType?: PlanSourceType;
}

export type ScheduleOccurrenceProjectionIssue =
  | {
      code: 'invalid_range';
      sourceKind: null;
      sourceId: null;
    }
  | {
      code: 'owner_mismatch';
      sourceKind: ScheduleOccurrenceSourceKind;
      sourceId: string;
    };

export interface ScheduleOccurrenceProjection {
  occurrences: ScheduleOccurrence[];
  issues: ScheduleOccurrenceProjectionIssue[];
}

export interface ScheduleOccurrenceProjectionInput {
  ownerId: string;
  startDate: string;
  endDate: string;
  plans: readonly Plan[];
  monthEvents?: readonly MonthEvent[];
  scheduleTemplates?: readonly ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: readonly TimetableTerm[];
}

function calendarDayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function calendarDayDistance(startDate: string, endDate: string): number {
  return Math.max(0, calendarDayNumber(endDate) - calendarDayNumber(startDate));
}

function pointKey(point: ScheduleOccurrencePoint): string {
  return `${point.date}T${point.time}`;
}

function normalizePlanEndPoint(
  date: string,
  startTime: string,
  endTime: string,
): ScheduleOccurrencePoint {
  if (endTime === '24:00') {
    return { date: addDays(date, 1), time: '00:00' };
  }
  if (endTime <= startTime) {
    return { date: addDays(date, 1), time: endTime };
  }
  return { date, time: endTime };
}

function normalizeMonthEventEndPoint(
  occurrenceStartDate: string,
  spanDays: number,
  endTime: string,
): ScheduleOccurrencePoint {
  const endDate = addDays(occurrenceStartDate, spanDays);
  return endTime === '24:00'
    ? { date: addDays(endDate, 1), time: '00:00' }
    : { date: endDate, time: endTime };
}

function overlapsProjectionRange(
  occurrence: Pick<ScheduleOccurrence, 'start' | 'end'>,
  startDate: string,
  endDate: string,
): boolean {
  const rangeStart = `${startDate}T00:00`;
  const rangeEnd = `${addDays(endDate, 1)}T00:00`;
  return pointKey(occurrence.end) > rangeStart && pointKey(occurrence.start) < rangeEnd;
}

function categoryForPlan(plan: Plan): ScheduleOccurrenceCategory {
  if (plan.sourceType === 'timetable') return 'class';
  if (plan.type === 'study') return 'study';
  if (plan.type === 'mock-exam') return 'exam';
  if (plan.type === 'school-event') return 'school';
  if (plan.type === 'cram-school') return 'cram-school';
  if (plan.type === 'deadline') return 'deadline';
  return 'other';
}

function sourceForPlan(plan: Plan): ScheduleOccurrenceSource {
  const timetableSourceId = plan.sourceId?.trim();
  if (plan.sourceType === 'timetable' && timetableSourceId) {
    return {
      kind: 'timetable',
      id: timetableSourceId,
      backingKind: 'plan',
      backingId: plan.id,
    };
  }
  return {
    kind: 'plan',
    id: plan.id,
    backingKind: 'plan',
    backingId: plan.id,
  };
}

function occurrenceId(
  source: Pick<ScheduleOccurrenceSource, 'kind' | 'id'>,
  start: ScheduleOccurrencePoint,
): string {
  // Identity is the logical source occurrence, not its mutable clock time. This lets
  // an imported timetable Plan replace its template occurrence after an edit.
  return `${source.kind}:${source.id}:${start.date}`;
}

function timetablePlanOriginDate(plan: Plan): string {
  return plan.sourceDate?.trim() || plan.date;
}

function occurrenceIdentityStartForPlan(
  plan: Plan,
  source: ScheduleOccurrenceSource,
  start: ScheduleOccurrencePoint,
): ScheduleOccurrencePoint {
  return source.kind === 'timetable'
    ? { ...start, date: timetablePlanOriginDate(plan) }
    : start;
}

function timetableOverrideOccurrenceIds(
  ownerId: string,
  plans: readonly Plan[],
): Set<string> {
  const ids = new Set<string>();

  for (const plan of plans) {
    if (
      plan.userId !== ownerId ||
      plan.sourceType !== 'timetable' ||
      !plan.sourceId?.trim()
    ) {
      continue;
    }

    const source = sourceForPlan(plan);
    ids.add(
      occurrenceId(source, {
        date: timetablePlanOriginDate(plan),
        time: plan.startTime,
      }),
    );
  }

  return ids;
}

function planOccurrences(params: {
  ownerId: string;
  plans: readonly Plan[];
  startDate: string;
  endDate: string;
  issues: ScheduleOccurrenceProjectionIssue[];
}): ScheduleOccurrence[] {
  const ownedPlans: Plan[] = [];
  for (const plan of params.plans) {
    const source = sourceForPlan(plan);
    if (plan.userId !== params.ownerId) {
      params.issues.push({
        code: 'owner_mismatch',
        sourceKind: source.kind,
        sourceId: source.id,
      });
      continue;
    }
    ownedPlans.push(plan);
  }

  return expandPlansForDateRange(
    ownedPlans,
    addDays(params.startDate, -1),
    params.endDate,
  )
    .map((plan): ScheduleOccurrence => {
      const source = sourceForPlan(plan);
      const start = { date: plan.date, time: plan.startTime };
      return {
        id: occurrenceId(
          source,
          occurrenceIdentityStartForPlan(plan, source, start),
        ),
        ownerId: params.ownerId,
        title: plan.title,
        subject: plan.subject,
        category: categoryForPlan(plan),
        // Legacy Plan omits busy and therefore remains occupied. Canonical
        // ScheduleEvent can explicitly project busy=false through this adapter.
        busy: plan.busy ?? true,
        start,
        end: normalizePlanEndPoint(plan.date, plan.startTime, plan.endTime),
        source,
        planSourceType: plan.sourceType,
      };
    })
    .filter((occurrence) =>
      overlapsProjectionRange(occurrence, params.startDate, params.endDate),
    );
}

function monthEventOccurrences(params: {
  ownerId: string;
  events: readonly MonthEvent[];
  startDate: string;
  endDate: string;
  issues: ScheduleOccurrenceProjectionIssue[];
}): ScheduleOccurrence[] {
  const occurrences: ScheduleOccurrence[] = [];

  for (const event of params.events) {
    if (event.userId !== params.ownerId) {
      params.issues.push({
        code: 'owner_mismatch',
        sourceKind: 'month-event',
        sourceId: event.id,
      });
      continue;
    }

    const spanDays = calendarDayDistance(event.date, getMonthEventEndDate(event));
    let candidateDate = addDays(params.startDate, -spanDays);
    while (candidateDate <= params.endDate) {
      if (getMonthEventOccurrenceStartDate(event, candidateDate) === candidateDate) {
        const source: ScheduleOccurrenceSource = {
          kind: 'month-event',
          id: event.id,
          backingKind: 'month-event',
          backingId: event.id,
        };
        const start = { date: candidateDate, time: event.startTime };
        const occurrence: ScheduleOccurrence = {
          id: occurrenceId(source, start),
          ownerId: params.ownerId,
          title: event.title,
          subject: '主要予定',
          category: 'other',
          // Legacy MonthEvent omits busy and therefore remains occupied. Canonical
          // ScheduleEvent can explicitly project busy=false through this adapter.
          busy: event.busy ?? true,
          start,
          end: normalizeMonthEventEndPoint(candidateDate, spanDays, event.endTime),
          source,
          planSourceType: 'manual',
        };
        if (overlapsProjectionRange(occurrence, params.startDate, params.endDate)) {
          occurrences.push(occurrence);
        }
      }
      candidateDate = addDays(candidateDate, 1);
    }
  }

  return occurrences;
}

function ownedTimetableTerms(params: {
  ownerId: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: readonly TimetableTerm[];
  issues: ScheduleOccurrenceProjectionIssue[];
}): TimetableTerm[] {
  const candidates = params.timetableTerms ??
    (params.timetableTerm ? [params.timetableTerm] : []);
  const owned: TimetableTerm[] = [];

  for (const term of candidates) {
    if (term.userId !== params.ownerId) {
      params.issues.push({
        code: 'owner_mismatch',
        sourceKind: 'timetable',
        sourceId: term.id,
      });
      continue;
    }
    owned.push(term);
  }

  return owned;
}

function timetableOccurrences(params: {
  ownerId: string;
  templates: readonly ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: readonly TimetableTerm[];
  startDate: string;
  endDate: string;
  issues: ScheduleOccurrenceProjectionIssue[];
}): ScheduleOccurrence[] {
  const templates: ScheduleTemplate[] = [];
  for (const template of params.templates) {
    if (template.userId !== params.ownerId) {
      params.issues.push({
        code: 'owner_mismatch',
        sourceKind: 'timetable',
        sourceId: template.id,
      });
      continue;
    }
    templates.push(template);
  }

  const terms = ownedTimetableTerms({
    ownerId: params.ownerId,
    timetableTerm: params.timetableTerm,
    timetableTerms: params.timetableTerms,
    issues: params.issues,
  });
  const occurrences: ScheduleOccurrence[] = [];
  let date = params.startDate;

  while (date <= params.endDate) {
    const term = terms.length > 0
      ? resolveTimetableTermForDate(date, terms, params.timetableTermId)
      : params.timetableTerm && params.timetableTerm.userId === params.ownerId
        ? params.timetableTerm
        : null;
    const termId = term?.id ??
      (terms.length === 0 && !params.timetableTerm
        ? params.timetableTermId ?? 'default'
        : null);

    if (termId) {
      const candidates = buildTimetableImportCandidates({
        templates: templates.filter(
          (template) => (template.termId || 'default') === termId,
        ),
        date,
        weekday: getRecurrenceWeekday(date),
        termId,
        term,
      });

      for (const candidate of candidates) {
        const source: ScheduleOccurrenceSource = {
          kind: 'timetable',
          id: candidate.sourceId,
          backingKind: 'timetable-template',
          backingId: candidate.sourceId,
        };
        const start = { date, time: candidate.startTime };
        occurrences.push({
          id: occurrenceId(source, start),
          ownerId: params.ownerId,
          title: candidate.title,
          subject: candidate.subject,
          category: 'class',
          busy: true,
          start,
          end: normalizePlanEndPoint(date, candidate.startTime, candidate.endTime),
          source,
          planSourceType: 'timetable',
        });
      }
    }

    date = addDays(date, 1);
  }

  return occurrences;
}

function backingPriority(kind: ScheduleOccurrenceBackingKind): number {
  if (kind === 'plan') return 3;
  if (kind === 'month-event') return 2;
  return 1;
}

function chooseDuplicate(
  current: ScheduleOccurrence,
  candidate: ScheduleOccurrence,
): ScheduleOccurrence {
  const priorityDelta =
    backingPriority(candidate.source.backingKind) -
    backingPriority(current.source.backingKind);
  if (priorityDelta !== 0) return priorityDelta > 0 ? candidate : current;
  return candidate.source.backingId.localeCompare(current.source.backingId) < 0
    ? candidate
    : current;
}

function sortOccurrences(
  left: ScheduleOccurrence,
  right: ScheduleOccurrence,
): number {
  return (
    pointKey(left.start).localeCompare(pointKey(right.start)) ||
    pointKey(left.end).localeCompare(pointKey(right.end)) ||
    left.id.localeCompare(right.id)
  );
}

export function createScheduleOccurrenceProjection(
  input: ScheduleOccurrenceProjectionInput,
): ScheduleOccurrenceProjection {
  if (input.startDate > input.endDate) {
    return {
      occurrences: [],
      issues: [{ code: 'invalid_range', sourceKind: null, sourceId: null }],
    };
  }

  const issues: ScheduleOccurrenceProjectionIssue[] = [];
  const timetableOverrideIds = timetableOverrideOccurrenceIds(
    input.ownerId,
    input.plans,
  );
  const projectedTimetableOccurrences = timetableOccurrences({
    ownerId: input.ownerId,
    templates: input.scheduleTemplates ?? [],
    timetableTermId: input.timetableTermId,
    timetableTerm: input.timetableTerm,
    timetableTerms: input.timetableTerms,
    startDate: input.startDate,
    endDate: input.endDate,
    issues,
  }).filter((occurrence) => !timetableOverrideIds.has(occurrence.id));
  const allOccurrences = [
    ...planOccurrences({
      ownerId: input.ownerId,
      plans: input.plans,
      startDate: input.startDate,
      endDate: input.endDate,
      issues,
    }),
    ...monthEventOccurrences({
      ownerId: input.ownerId,
      events: input.monthEvents ?? [],
      startDate: input.startDate,
      endDate: input.endDate,
      issues,
    }),
    ...projectedTimetableOccurrences,
  ];

  const byId = new Map<string, ScheduleOccurrence>();
  for (const occurrence of allOccurrences) {
    const current = byId.get(occurrence.id);
    byId.set(
      occurrence.id,
      current ? chooseDuplicate(current, occurrence) : occurrence,
    );
  }

  return {
    occurrences: [...byId.values()].sort(sortOccurrences),
    issues,
  };
}
