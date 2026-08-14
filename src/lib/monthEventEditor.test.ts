import { describe, expect, it } from 'vitest';
import {
  resolveMonthEventDeleteMutation,
  sanitizeMonthEventDraft,
  validateMonthEventDraft,
} from './monthEventEditor';
import type { MonthEvent, MonthEventDraft } from '../types/domain';

function createDraft(overrides: Partial<MonthEventDraft> = {}): MonthEventDraft {
  return {
    userId: 'user-1',
    date: '2026-08-10',
    title: '  模試  ',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'weekly',
    repeatUntil: '2026-09-30',
    excludedDates: ['2026-08-24', '2026-08-17', '2026-08-17', '2026-08-01'],
    url: '  https://example.com  ',
    memo: '  持ち物  ',
    checklist: [
      { id: 'keep', text: '  受験票  ', checked: false },
      { id: 'drop', text: '   ', checked: true },
    ],
    locationTags: [' 学校 ', '学校', '', ' 体育館 '],
    ...overrides,
  };
}

function createEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'event-1',
    ...createDraft(),
    title: '模試',
    url: 'https://example.com',
    memo: '持ち物',
    checklist: [{ id: 'keep', text: '受験票', checked: false }],
    locationTags: ['学校'],
    excludedDates: ['2026-08-17', '2026-08-31'],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('month event editor policy', () => {
  it('normalizes user-editable fields without mutating the source draft', () => {
    const draft = createDraft();

    const result = sanitizeMonthEventDraft(draft);

    expect(result).toMatchObject({
      title: '模試',
      repeatUntil: '2026-09-30',
      excludedDates: ['2026-08-17', '2026-08-24'],
      url: 'https://example.com',
      memo: '持ち物',
      checklist: [{ id: 'keep', text: '受験票', checked: false }],
      locationTags: ['学校', '体育館'],
    });
    expect(draft.title).toBe('  模試  ');
    expect(draft.checklist[0]?.text).toBe('  受験票  ');
  });

  it('clears recurrence-only fields for a non-repeating draft', () => {
    const result = sanitizeMonthEventDraft(
      createDraft({ repeat: 'none', repeatUntil: '2026-09-30' }),
    );

    expect(result.repeatUntil).toBeNull();
    expect(result.excludedDates).toEqual([]);
  });

  it('validates the normalized title and positive time range', () => {
    expect(validateMonthEventDraft(createDraft({ title: '' }))).toBe(
      'タイトルを入れてください。',
    );
    expect(validateMonthEventDraft(createDraft({ startTime: '10:00', endTime: '10:00' }))).toBe(
      '終了時刻は開始時刻より後にしてください。',
    );
    expect(validateMonthEventDraft(createDraft())).toBeNull();
  });

  it('excludes only the selected occurrence for single-scope deletion', () => {
    const result = resolveMonthEventDeleteMutation(
      createEvent(),
      '2026-08-24',
      'single',
    );

    expect(result).toMatchObject({
      type: 'save',
      targetMonthEventId: 'event-1',
      draft: {
        excludedDates: ['2026-08-17', '2026-08-24', '2026-08-31'],
      },
    });
  });

  it('ends a recurring series at the previous occurrence and removes later exclusions', () => {
    const result = resolveMonthEventDeleteMutation(
      createEvent(),
      '2026-09-07',
      'future',
    );

    expect(result).toMatchObject({
      type: 'save',
      targetMonthEventId: 'event-1',
      draft: {
        repeatUntil: '2026-08-24',
        excludedDates: ['2026-08-17'],
      },
    });
  });

  it('deletes the series when there is no occurrence before the cutoff', () => {
    const event = createEvent({ date: '2026-08-24', excludedDates: [] });

    expect(resolveMonthEventDeleteMutation(event, '2026-08-24', 'future')).toEqual({
      type: 'delete',
      monthEvent: event,
    });
  });
});
