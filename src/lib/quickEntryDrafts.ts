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
  weekday: RecurrenceWeekday;
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
  const endMinutes = Math.min(startMinutes + estimatedMinutes, 23 * 60 + 59);

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
    !isSupportedQuickEntryRepeatKind(input.repeatKind)
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
              kind: input.repeatKind === 'weekly' ? 'weekday' : 'daily',
              startDate: input.date,
              until: null,
              dates: [],
              weekdays: input.repeatKind === 'weekly' ? [input.weekday] : [],
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
        ? input.repeatKind === 'weekly'
          ? 'weekly'
          : 'daily'
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
