import { createMonthEventDraftFromEvent } from '../domain/planner';
import { minutesBetween } from './date';
import {
  getMonthEventOccurrenceStartDate,
  getPreviousMonthEventOccurrenceDate,
} from './monthEvents';
import type { MonthEvent, MonthEventDraft } from '../types/domain';

export type MonthEventDeleteScope = 'single' | 'future';

export type MonthEventDeleteMutation =
  | { type: 'delete'; monthEvent: MonthEvent }
  | { type: 'save'; draft: MonthEventDraft; targetMonthEventId: string };

export function sanitizeMonthEventDraft(draft: MonthEventDraft): MonthEventDraft {
  const checklist = draft.checklist
    .map((item) => ({
      ...item,
      text: item.text.trim(),
    }))
    .filter((item) => item.text.length > 0);
  const locationTags = draft.locationTags
    .map((tag) => tag.trim())
    .filter((tag, index, array) => tag.length > 0 && array.indexOf(tag) === index);
  const repeatUntil =
    draft.repeat === 'none' ||
    !draft.repeatUntil ||
    draft.repeatUntil.localeCompare(draft.date) < 0
      ? null
      : draft.repeatUntil;
  const excludedDates =
    draft.repeat === 'none'
      ? []
      : [...new Set(draft.excludedDates)]
          .filter((date) => date.localeCompare(draft.date) >= 0)
          .sort((left, right) => left.localeCompare(right));

  return {
    ...draft,
    endDate: draft.endDate?.trim() || draft.date,
    title: draft.title.trim(),
    repeatUntil,
    excludedDates,
    url: draft.url.trim(),
    memo: draft.memo.trim(),
    checklist,
    locationTags,
  };
}

export function validateMonthEventDraft(draft: MonthEventDraft): string | null {
  if (!draft.title) {
    return 'タイトルを入れてください。';
  }

  const endDate = draft.endDate ?? draft.date;

  if (endDate.localeCompare(draft.date) < 0) {
    return '終了日は開始日以降にしてください。';
  }

  if (
    endDate === draft.date &&
    minutesBetween(draft.startTime, draft.endTime) <= 0
  ) {
    return '終了時刻は開始時刻より後にしてください。';
  }

  return null;
}

export function resolveMonthEventDeleteMutation(
  monthEvent: MonthEvent,
  occurrenceDate: string,
  scope: MonthEventDeleteScope,
): MonthEventDeleteMutation {
  const baseDraft: MonthEventDraft = {
    ...createMonthEventDraftFromEvent(monthEvent),
    endDate: monthEvent.endDate ?? monthEvent.date,
  };
  const occurrenceStartDate =
    getMonthEventOccurrenceStartDate(monthEvent, occurrenceDate) ?? occurrenceDate;

  if (scope === 'single') {
    return {
      type: 'save',
      targetMonthEventId: monthEvent.id,
      draft: sanitizeMonthEventDraft({
        ...baseDraft,
        excludedDates: [...baseDraft.excludedDates, occurrenceStartDate],
      }),
    };
  }

  const previousOccurrenceDate = getPreviousMonthEventOccurrenceDate(
    monthEvent,
    occurrenceStartDate,
  );

  if (!previousOccurrenceDate) {
    return {
      type: 'delete',
      monthEvent,
    };
  }

  return {
    type: 'save',
    targetMonthEventId: monthEvent.id,
    draft: sanitizeMonthEventDraft({
      ...baseDraft,
      repeatUntil: previousOccurrenceDate,
      excludedDates: baseDraft.excludedDates.filter(
        (date) => date.localeCompare(previousOccurrenceDate) <= 0,
      ),
    }),
  };
}
