import type {
  MonthEvent,
  MonthEventChecklistItem,
  MonthEventRepeat,
  Plan,
  PlanSourceType,
  PlanType,
  RecurrenceRule,
  WeeklyPlanningMemoryPaceObservationSourceV1,
} from '../types/domain';

export const SCHEDULE_EVENT_SCHEMA_VERSION = 1 as const;
export const SCHEDULE_EVENT_MIGRATION_VERSION = 1 as const;

export type ScheduleEventSchemaVersion = typeof SCHEDULE_EVENT_SCHEMA_VERSION;
export type ScheduleEventMigrationVersion = typeof SCHEDULE_EVENT_MIGRATION_VERSION;

export type ScheduleEventCategory =
  | 'study'
  | 'class'
  | 'exam'
  | 'school'
  | 'cram-school'
  | 'deadline'
  | 'other';

export type ScheduleEventLegacyKind = 'plan' | 'month-event';

export interface ScheduleEventLegacyIdentity {
  kind: ScheduleEventLegacyKind;
  id: string;
}

export interface ScheduleEventProvenance {
  legacy: ScheduleEventLegacyIdentity;
  sourceType: PlanSourceType | 'month-event' | null;
  sourceId: string | null;
}

export interface ScheduleEventRecurrence {
  repeat: MonthEventRepeat;
  repeatUntil: string | null;
  excludedDates: string[];
  rules: RecurrenceRule[];
}

export interface ScheduleEventPlanDetails {
  legacyPlanId: string;
  seriesId: string;
  subject: string;
  planType: PlanType;
  sourceDate?: string;
  occurrenceDate?: string;
  occurrenceKey?: string;
  materialId?: string | null;
  materialName?: string;
  weeklyPlanningObservationSource?: WeeklyPlanningMemoryPaceObservationSourceV1;
}

export interface ScheduleEventGeneralDetails {
  url: string;
  checklist: MonthEventChecklistItem[];
  locationTags: string[];
}

interface ScheduleEventBase {
  schemaVersion: ScheduleEventSchemaVersion;
  id: string;
  userId: string;
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  recurrence: ScheduleEventRecurrence;
  category: ScheduleEventCategory;
  busy: boolean;
  memo: string;
  provenance: ScheduleEventProvenance;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleEvent = ScheduleEventBase &
  (
    | {
        kind: 'study';
        plan: ScheduleEventPlanDetails;
        general: null;
      }
    | {
        kind: 'general';
        plan: ScheduleEventPlanDetails | null;
        general: ScheduleEventGeneralDetails | null;
      }
  );

export interface ScheduleEventMigrationState {
  schemaVersion: ScheduleEventSchemaVersion;
  migrationVersion: ScheduleEventMigrationVersion;
  userId: string;
  status: 'completed';
  sourcePlanCount: number;
  sourceMonthEventCount: number;
  eventCount: number;
  completedAt: string;
}

export interface ScheduleEventMigrationCandidate {
  schemaVersion?: unknown;
  migrationVersion?: unknown;
  status?: unknown;
}

export interface LegacyScheduleMigrationResult {
  events: ScheduleEvent[];
  sourcePlanCount: number;
  sourceMonthEventCount: number;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function copyRecurrenceRules(rules: readonly RecurrenceRule[]): RecurrenceRule[] {
  return rules.map((rule) => ({
    ...rule,
    dates: [...rule.dates],
    weekdays: [...rule.weekdays],
  }));
}

function categoryForPlan(plan: Plan): ScheduleEventCategory {
  if (plan.sourceType === 'timetable') return 'class';
  if (plan.type === 'study') return 'study';
  if (plan.type === 'mock-exam') return 'exam';
  if (plan.type === 'school-event') return 'school';
  if (plan.type === 'cram-school') return 'cram-school';
  if (plan.type === 'deadline') return 'deadline';
  return 'other';
}

function normalizedMonthEventEndDate(event: MonthEvent): string {
  const endDate = event.endDate?.trim();
  return endDate && endDate.localeCompare(event.date) >= 0 ? endDate : event.date;
}

function planDetails(plan: Plan): ScheduleEventPlanDetails {
  return {
    legacyPlanId: plan.id,
    seriesId: plan.seriesId,
    subject: plan.subject,
    planType: plan.type,
    sourceDate: plan.sourceDate,
    occurrenceDate: plan.occurrenceDate,
    occurrenceKey: plan.occurrenceKey,
    materialId: plan.materialId,
    materialName: plan.materialName,
    weeklyPlanningObservationSource: plan.weeklyPlanningObservationSource,
  };
}

export function scheduleEventIdForLegacy(
  legacy: ScheduleEventLegacyIdentity,
): string {
  return `${legacy.kind}:${legacy.id}`;
}

export function scheduleEventFromPlan(plan: Plan): ScheduleEvent {
  const legacy = { kind: 'plan' as const, id: plan.id };
  const details = planDetails(plan);
  const base: ScheduleEventBase = {
    schemaVersion: SCHEDULE_EVENT_SCHEMA_VERSION,
    id: scheduleEventIdForLegacy(legacy),
    userId: plan.userId,
    title: plan.title,
    date: plan.date,
    endDate: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    recurrence: {
      repeat: plan.repeat,
      repeatUntil: plan.repeatUntil,
      excludedDates: uniqueStrings(plan.excludedDates),
      rules: copyRecurrenceRules(plan.recurrenceRules),
    },
    category: categoryForPlan(plan),
    // Legacy Plan has no explicit busy/free field. Preserve its historical occupied
    // semantics during migration instead of inferring from category or title.
    busy: true,
    memo: plan.memo,
    provenance: {
      legacy,
      sourceType: plan.sourceType ?? null,
      sourceId: plan.sourceId?.trim() || null,
    },
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };

  return plan.type === 'study'
    ? { ...base, kind: 'study', plan: details, general: null }
    : { ...base, kind: 'general', plan: details, general: null };
}

export function scheduleEventFromMonthEvent(event: MonthEvent): ScheduleEvent {
  const legacy = { kind: 'month-event' as const, id: event.id };
  return {
    schemaVersion: SCHEDULE_EVENT_SCHEMA_VERSION,
    id: scheduleEventIdForLegacy(legacy),
    userId: event.userId,
    title: event.title,
    date: event.date,
    endDate: normalizedMonthEventEndDate(event),
    startTime: event.startTime,
    endTime: event.endTime,
    recurrence: {
      repeat: event.repeat,
      repeatUntil: event.repeatUntil,
      excludedDates: uniqueStrings(event.excludedDates),
      rules: [],
    },
    category: 'other',
    // Legacy MonthEvent likewise had no explicit busy/free field.
    busy: true,
    memo: event.memo,
    provenance: {
      legacy,
      sourceType: 'month-event',
      sourceId: null,
    },
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    kind: 'general',
    plan: null,
    general: {
      url: event.url,
      checklist: event.checklist.map((item) => ({ ...item })),
      locationTags: uniqueStrings(event.locationTags),
    },
  };
}

export function scheduleEventToPlan(event: ScheduleEvent): Plan | null {
  if (event.provenance.legacy.kind !== 'plan' || !event.plan) {
    return null;
  }

  return {
    id: event.provenance.legacy.id,
    seriesId: event.plan.seriesId,
    userId: event.userId,
    title: event.title,
    subject: event.plan.subject,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    repeat: event.recurrence.repeat,
    repeatUntil: event.recurrence.repeatUntil,
    excludedDates: [...event.recurrence.excludedDates],
    recurrenceRules: copyRecurrenceRules(event.recurrence.rules),
    type: event.plan.planType,
    memo: event.memo,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    sourceType:
      event.provenance.sourceType === null ||
      event.provenance.sourceType === 'month-event'
        ? undefined
        : event.provenance.sourceType,
    sourceId: event.provenance.sourceId,
    sourceDate: event.plan.sourceDate,
    occurrenceDate: event.plan.occurrenceDate,
    occurrenceKey: event.plan.occurrenceKey,
    materialId: event.plan.materialId,
    materialName: event.plan.materialName,
    weeklyPlanningObservationSource: event.plan.weeklyPlanningObservationSource,
  };
}

export function scheduleEventToMonthEvent(event: ScheduleEvent): MonthEvent | null {
  if (event.provenance.legacy.kind !== 'month-event' || !event.general) {
    return null;
  }

  return {
    id: event.provenance.legacy.id,
    userId: event.userId,
    date: event.date,
    endDate: event.endDate,
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
    repeat: event.recurrence.repeat,
    repeatUntil: event.recurrence.repeatUntil,
    excludedDates: [...event.recurrence.excludedDates],
    url: event.general.url,
    memo: event.memo,
    checklist: event.general.checklist.map((item) => ({ ...item })),
    locationTags: [...event.general.locationTags],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function migrateLegacyScheduleRecords(params: {
  plans: readonly Plan[];
  monthEvents: readonly MonthEvent[];
}): LegacyScheduleMigrationResult {
  const byId = new Map<string, ScheduleEvent>();

  for (const plan of params.plans) {
    const event = scheduleEventFromPlan(plan);
    byId.set(event.id, event);
  }
  for (const monthEvent of params.monthEvents) {
    const event = scheduleEventFromMonthEvent(monthEvent);
    byId.set(event.id, event);
  }

  return {
    events: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    sourcePlanCount: params.plans.length,
    sourceMonthEventCount: params.monthEvents.length,
  };
}

export function createScheduleEventMigrationState(params: {
  userId: string;
  sourcePlanCount: number;
  sourceMonthEventCount: number;
  eventCount: number;
  completedAt: string;
}): ScheduleEventMigrationState {
  return {
    schemaVersion: SCHEDULE_EVENT_SCHEMA_VERSION,
    migrationVersion: SCHEDULE_EVENT_MIGRATION_VERSION,
    userId: params.userId,
    status: 'completed',
    sourcePlanCount: params.sourcePlanCount,
    sourceMonthEventCount: params.sourceMonthEventCount,
    eventCount: params.eventCount,
    completedAt: params.completedAt,
  };
}

export function isCurrentScheduleEventMigration(
  state: ScheduleEventMigrationCandidate | null | undefined,
): state is ScheduleEventMigrationState {
  return (
    state?.status === 'completed' &&
    state.schemaVersion === SCHEDULE_EVENT_SCHEMA_VERSION &&
    state.migrationVersion === SCHEDULE_EVENT_MIGRATION_VERSION
  );
}
