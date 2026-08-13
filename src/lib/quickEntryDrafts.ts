import { formatMinutesToTime, parseTimeToMinutes } from './date';
import { normalizeRecurrenceRules } from './planRecurrence';
import type {
  PlanDraft,
  PlanType,
  RecurrenceWeekday,
} from '../types/domain';

export type QuickEntryRepeatKind = 'daily' | 'weekly' | 'monthly';

export const SUPPORTED_QUICK_ENTRY_REPEAT_KINDS = new Set<QuickEntryRepeatKind>([
  'daily',
  'weekly',
  'monthly',
]);

export interface QuickEntryPlanDraftInput {
  mode: 'scheduled' | 'repeat';
  userId: string;
  title: string;
  subject: string;
  type: PlanType;
  memo: string;
  date: string;
  startTime: string;
  estimatedMinutes: number | null;
  repeatKind: QuickEntryRepeatKind;
  weekdays: readonly RecurrenceWeekday[];
  materialId?: string | null;
  materialName?: string;
}

export function isSupportedQuickEntryRepeatKind(
  repeatKind: QuickEntryRepeatKind,
): boolean {
  return SUPPORTED_QUICK_ENTRY_REPEAT_KINDS.has(repeatKind);
}

export function isValidQuickEntryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function isValidQuickEntryStartTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidQuickEntryDuration(value: number | null): value is number {
  return Number.isInteger(value) && value !== null && value > 0 && value < 24 * 60;
}

export function resolveQuickEntryEndTime(
  startTime: string,
  estimatedMinutes: number,
): string {
  const startMinutes = parseTimeToMinutes(startTime, 'start');
  const endMinutes = isValidQuickEntryDuration(estimatedMinutes)
    ? (startMinutes + estimatedMinutes) % (24 * 60)
    : startMinutes;

  return formatMinutesToTime(endMinutes, 'start');
}

export function buildQuickEntryPlanDraft(
  input: QuickEntryPlanDraftInput,
): PlanDraft | null {
  const title = input.title.trim();

  if (
    !title ||
    !isValidQuickEntryDate(input.date) ||
    !isValidQuickEntryStartTime(input.startTime) ||
    !isValidQuickEntryDuration(input.estimatedMinutes)
  ) {
    return null;
  }

  if (
    input.mode === 'repeat' &&
    (!isSupportedQuickEntryRepeatKind(input.repeatKind) ||
      (input.repeatKind === 'weekly' && input.weekdays.length === 0))
  ) {
    return null;
  }

  const subject = input.subject.trim();
  const memo = input.memo.trim();
  const materialId = input.materialId?.trim() || null;
  const materialName = input.materialName?.trim() ?? '';
  const endTime = resolveQuickEntryEndTime(
    input.startTime,
    input.estimatedMinutes,
  );
  const recurrenceRules =
    input.mode === 'repeat'
      ? normalizeRecurrenceRules(
          [
            {
              id: 'recurrence-base',
              kind:
                input.repeatKind === 'weekly'
                  ? 'weekday'
                  : input.repeatKind,
              startDate: input.date,
              until: null,
              dates: [],
              weekdays: input.repeatKind === 'weekly' ? input.weekdays : [],
              dayType: null,
              startTime: input.startTime,
              endTime,
              title,
              subject,
              type: input.type,
              memo,
              isOverride: false,
            },
          ],
          {
            date: input.date,
            startTime: input.startTime,
            endTime,
            title,
            subject,
            type: input.type,
            memo,
            repeatUntil: null,
          },
        )
      : [];

  return {
    userId: input.userId,
    title,
    subject,
    date: input.date,
    startTime: input.startTime,
    endTime,
    repeat:
      input.mode === 'repeat'
        ? input.repeatKind
        : 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules,
    type: input.type,
    memo,
    sourceType: 'manual',
    sourceId: null,
    materialId,
    materialName,
  };
}
