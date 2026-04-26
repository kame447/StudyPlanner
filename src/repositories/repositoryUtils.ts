import type {
  Actual,
  MonthEventRepeat,
  Plan,
  PlanSourceType,
  PlanType,
  RecurrenceWeekday,
  ScheduleTemplate,
  TodoStatus,
  TodoTask,
} from '../types/domain';
import {
  normalizeRecurrenceRules,
  summarizeLegacyRepeatFromRecurrenceRules,
  summarizeLegacyRepeatUntilFromRecurrenceRules,
} from '../lib/planRecurrence';

export function replaceById<T extends { id: string }>(
  records: T[],
  nextRecord: T,
): T[] {
  return records.some((record) => record.id === nextRecord.id)
    ? records.map((record) => (record.id === nextRecord.id ? nextRecord : record))
    : [...records, nextRecord];
}

export function filterByUserId<T extends { userId: string }>(
  records: T[],
  userId: string,
): T[] {
  return records.filter((record) => record.userId === userId);
}

function normalizeRepeat(value: unknown): MonthEventRepeat {
  return value === 'daily' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'yearly'
    ? value
    : 'none';
}

function normalizePlanType(value: unknown): PlanType {
  return value === 'study' ||
    value === 'mock-exam' ||
    value === 'school-event' ||
    value === 'cram-school' ||
    value === 'deadline' ||
    value === 'other'
    ? value
    : 'study';
}

function normalizePlanSourceType(value: unknown): PlanSourceType | undefined {
  return value === 'manual' || value === 'todo' || value === 'timetable'
    ? value
    : undefined;
}

function normalizeTodoStatus(value: unknown): TodoStatus {
  return value === 'scheduled' || value === 'done' || value === 'archived'
    ? value
    : 'open';
}

function normalizeWeekday(value: unknown): RecurrenceWeekday {
  return value === 'sun' ||
    value === 'mon' ||
    value === 'tue' ||
    value === 'wed' ||
    value === 'thu' ||
    value === 'fri' ||
    value === 'sat'
    ? value
    : 'mon';
}

export function normalizePlanRecord(plan: Plan): Plan {
  const recurrenceRules = normalizeRecurrenceRules(plan.recurrenceRules, {
    date: plan.date,
    startTime: plan.startTime,
    endTime: plan.endTime,
    title: plan.title,
    subject: plan.subject,
    type: plan.type,
    memo: plan.memo,
    repeatUntil: plan.repeatUntil,
  });
  const repeat =
    summarizeLegacyRepeatFromRecurrenceRules(recurrenceRules) ??
    normalizeRepeat(plan.repeat);

  return {
    ...plan,
    seriesId:
      typeof plan.seriesId === 'string' && plan.seriesId.trim().length > 0
        ? plan.seriesId.trim()
        : plan.id,
    repeat,
    repeatUntil:
      recurrenceRules.length > 0
        ? summarizeLegacyRepeatUntilFromRecurrenceRules(
            recurrenceRules,
            plan.repeatUntil ?? null,
          )
        : plan.repeatUntil ?? null,
    excludedDates: Array.isArray(plan.excludedDates)
      ? plan.excludedDates.filter((date): date is string => typeof date === 'string' && date.length > 0)
      : [],
    recurrenceRules,
    sourceType: normalizePlanSourceType(plan.sourceType),
    sourceId: typeof plan.sourceId === 'string' && plan.sourceId.length > 0
      ? plan.sourceId
      : null,
  };
}

export function normalizeActualRecord(
  actual: Actual & {
    date?: string;
  },
): Actual {
  return {
    ...actual,
    occurrenceDate: actual.occurrenceDate ?? actual.date ?? '',
  };
}

export function normalizeTodoRecord(todo: TodoTask): TodoTask {
  const dueDate =
    typeof todo.dueDate === 'string' && todo.dueDate.length > 0
      ? todo.dueDate
      : null;

  return {
    ...todo,
    title: todo.title?.trim() ?? '',
    subject: todo.subject?.trim() ?? '',
    type: normalizePlanType(todo.type),
    estimatedMinutes:
      typeof todo.estimatedMinutes === 'number' && Number.isFinite(todo.estimatedMinutes)
        ? Math.max(0, Math.round(todo.estimatedMinutes))
        : null,
    dueDate,
    dueTime:
      dueDate && typeof todo.dueTime === 'string' && /^\d{2}:\d{2}$/.test(todo.dueTime)
        ? todo.dueTime
        : null,
    memo: todo.memo ?? '',
    status: normalizeTodoStatus(todo.status),
    scheduledPlanId:
      typeof todo.scheduledPlanId === 'string' && todo.scheduledPlanId.length > 0
        ? todo.scheduledPlanId
        : null,
    pinned: todo.pinned === true,
  };
}

export function normalizeScheduleTemplateRecord(
  template: ScheduleTemplate,
): ScheduleTemplate {
  return {
    ...template,
    title: template.title?.trim() ?? '',
    subject: template.subject?.trim() ?? '',
    type: normalizePlanType(template.type),
    weekday: normalizeWeekday(template.weekday),
    startTime: template.startTime || '09:00',
    endTime: template.endTime || '10:00',
    termId:
      typeof template.termId === 'string' && template.termId.trim().length > 0
        ? template.termId.trim()
        : 'default',
    periodNumber:
      typeof template.periodNumber === 'number' && Number.isFinite(template.periodNumber)
        ? Math.max(1, Math.round(template.periodNumber))
        : undefined,
    classroom: template.classroom?.trim() ?? '',
    memo: template.memo ?? '',
    active: template.active !== false,
  };
}
