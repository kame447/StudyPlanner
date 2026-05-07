import { minutesFromTime, timeFromMinutes } from './date';
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
}

export function isSupportedQuickEntryRepeatKind(
  repeatKind: QuickEntryRepeatKind,
): boolean {
  return SUPPORTED_QUICK_ENTRY_REPEAT_KINDS.has(repeatKind);
}

export function resolveQuickEntryEndTime(
  startTime: string,
  estimatedMinutes: number,
): string {
  const startMinutes = minutesFromTime(startTime);
  const endMinutes =
    estimatedMinutes > 0 && estimatedMinutes < 24 * 60
      ? (startMinutes + estimatedMinutes) % (24 * 60)
      : startMinutes;

  return timeFromMinutes(endMinutes);
}

export function buildQuickEntryPlanDraft(
  input: QuickEntryPlanDraftInput,
): PlanDraft | null {
  const title = input.title.trim();

  if (!title || input.estimatedMinutes === null) {
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
  };
}
