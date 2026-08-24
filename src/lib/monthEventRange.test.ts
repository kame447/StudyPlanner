import { describe, expect, it } from 'vitest';
import {
  doesMonthEventOccurOnDate,
  formatMonthEventDuration,
  formatMonthEventTimeRangeForDate,
  getMonthEventOccurrenceStartDate,
} from './monthEvents';
import { validateMonthEventDraft } from './monthEventEditor';
import type { MonthEvent, MonthEventDraft } from '../types/domain';

function createEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'event-1',
    userId: 'user-1',
    date: '2026-08-26',
    title: '合宿',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function createDraft(overrides: Partial<MonthEventDraft> = {}): MonthEventDraft {
  return {
    userId: 'user-1',
    date: '2026-08-26',
    endDate: '2026-08-26',
    title: '合宿',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    ...overrides,
  };
}

describe('month event date ranges', () => {
  it('keeps legacy events without endDate on one day', () => {
    const event = createEvent();

    expect(doesMonthEventOccurOnDate(event, '2026-08-26')).toBe(true);
    expect(doesMonthEventOccurOnDate(event, '2026-08-27')).toBe(false);
  });

  it('covers every date from the start through the end date', () => {
    const event = createEvent({ endDate: '2026-08-28' });

    expect(doesMonthEventOccurOnDate(event, '2026-08-25')).toBe(false);
    expect(doesMonthEventOccurOnDate(event, '2026-08-26')).toBe(true);
    expect(doesMonthEventOccurOnDate(event, '2026-08-27')).toBe(true);
    expect(doesMonthEventOccurOnDate(event, '2026-08-28')).toBe(true);
    expect(doesMonthEventOccurOnDate(event, '2026-08-29')).toBe(false);
    expect(formatMonthEventTimeRangeForDate(event, '2026-08-26')).toBe('09:00〜');
    expect(formatMonthEventTimeRangeForDate(event, '2026-08-27')).toBe('終日');
    expect(formatMonthEventTimeRangeForDate(event, '2026-08-28')).toBe('〜10:00');
  });

  it('allows an end clock time earlier than the start time on a later date', () => {
    const draft = createDraft({
      endDate: '2026-08-27',
      startTime: '23:00',
      endTime: '01:00',
    });
    const event = createEvent({
      endDate: '2026-08-27',
      startTime: '23:00',
      endTime: '01:00',
    });

    expect(validateMonthEventDraft(draft)).toBeNull();
    expect(formatMonthEventDuration(event)).toBe(120);
  });

  it('rejects an end date before the start date', () => {
    expect(validateMonthEventDraft(createDraft({ endDate: '2026-08-25' }))).toBe(
      '終了日は開始日以降にしてください。',
    );
  });

  it('repeats the complete span from each recurrence anchor', () => {
    const event = createEvent({
      date: '2026-08-24',
      endDate: '2026-08-26',
      repeat: 'weekly',
      repeatUntil: '2026-08-31',
    });

    expect(getMonthEventOccurrenceStartDate(event, '2026-08-25')).toBe('2026-08-24');
    expect(getMonthEventOccurrenceStartDate(event, '2026-09-01')).toBe('2026-08-31');
    expect(getMonthEventOccurrenceStartDate(event, '2026-09-02')).toBe('2026-08-31');
    expect(doesMonthEventOccurOnDate(event, '2026-09-03')).toBe(false);
  });
});
