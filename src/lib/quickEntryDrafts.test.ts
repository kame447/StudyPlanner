import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../domain/planner';
import {
  doesPlanOccurOnDate,
  expandPlansForDate,
} from './planRecurrence';
import { buildQuickEntryPlanDraft } from './quickEntryDrafts';

const baseInput = {
  userId: 'user-1',
  title: '英語長文',
  subject: '英語',
  type: 'study' as const,
  memo: 'unit 4',
  date: '2026-04-20',
  startTime: '19:00',
  estimatedMinutes: 30,
  weekday: 'wed' as const,
};

describe('buildQuickEntryPlanDraft', () => {
  it('builds a daily recurrence plan draft without generating future plans', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'repeat',
      repeatKind: 'daily',
    });

    expect(draft).toMatchObject({
      repeat: 'daily',
      repeatUntil: null,
      excludedDates: [],
      endTime: '19:30',
    });
    expect(draft?.recurrenceRules).toEqual([
      expect.objectContaining({
        id: 'recurrence-base',
        kind: 'daily',
        startDate: '2026-04-20',
        until: null,
        weekdays: [],
        startTime: '19:00',
        endTime: '19:30',
        title: '英語長文',
        subject: '英語',
        type: 'study',
        memo: 'unit 4',
        isOverride: false,
      }),
    ]);

    const plan = createPlanFromDraft(draft!);

    expect([plan]).toHaveLength(1);
    expect(doesPlanOccurOnDate(plan, '2026-04-20')).toBe(true);
    expect(doesPlanOccurOnDate(plan, '2026-04-21')).toBe(true);
    expect(expandPlansForDate([plan], '2026-04-21')).toHaveLength(1);
  });

  it('builds a weekly recurrence plan draft with the selected weekday', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'repeat',
      repeatKind: 'weekly',
      weekday: 'wed',
    });

    expect(draft).toMatchObject({
      repeat: 'weekly',
      repeatUntil: null,
      excludedDates: [],
      endTime: '19:30',
    });
    expect(draft?.recurrenceRules).toEqual([
      expect.objectContaining({
        kind: 'weekday',
        startDate: '2026-04-20',
        weekdays: ['wed'],
        startTime: '19:00',
        endTime: '19:30',
        isOverride: false,
      }),
    ]);

    const plan = createPlanFromDraft(draft!);

    expect([plan]).toHaveLength(1);
    expect(doesPlanOccurOnDate(plan, '2026-04-21')).toBe(false);
    expect(doesPlanOccurOnDate(plan, '2026-04-22')).toBe(true);
    expect(expandPlansForDate([plan], '2026-04-22')).toHaveLength(1);
  });

  it('does not build repeat drafts without duration or for unsupported monthly repeat', () => {
    expect(
      buildQuickEntryPlanDraft({
        ...baseInput,
        mode: 'repeat',
        repeatKind: 'daily',
        estimatedMinutes: null,
      }),
    ).toBeNull();

    expect(
      buildQuickEntryPlanDraft({
        ...baseInput,
        mode: 'repeat',
        repeatKind: 'monthly',
      }),
    ).toBeNull();
  });

  it('keeps scheduled plans non-recurring', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'scheduled',
      repeatKind: 'daily',
    });

    expect(draft).toMatchObject({
      repeat: 'none',
      recurrenceRules: [],
      endTime: '19:30',
    });
  });
});
