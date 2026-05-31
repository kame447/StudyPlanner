import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../domain/planner';
import {
  doesPlanOccurOnDate,
  expandPlansForDate,
} from './planRecurrence';
import {
  buildQuickEntryPlanDraft,
  resolveQuickEntryEndTime,
} from './quickEntryDrafts';

const baseInput = {
  userId: 'user-1',
  title: '英語長文',
  subject: '英語',
  type: 'study' as const,
  memo: 'unit 4',
  date: '2026-04-20',
  startTime: '19:00',
  estimatedMinutes: 30,
  weekdays: ['wed'] as const,
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

  it('builds a weekly recurrence plan draft with the selected weekdays', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'repeat',
      repeatKind: 'weekly',
      weekdays: ['mon', 'wed'],
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
        weekdays: ['mon', 'wed'],
        startTime: '19:00',
        endTime: '19:30',
        isOverride: false,
      }),
    ]);

    const plan = createPlanFromDraft(draft!);

    expect([plan]).toHaveLength(1);
    expect(doesPlanOccurOnDate(plan, '2026-04-20')).toBe(true);
    expect(doesPlanOccurOnDate(plan, '2026-04-21')).toBe(false);
    expect(doesPlanOccurOnDate(plan, '2026-04-22')).toBe(true);
    expect(expandPlansForDate([plan], '2026-04-22')).toHaveLength(1);
  });

  it('builds a monthly recurrence plan draft using the start date day', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'repeat',
      repeatKind: 'monthly',
      date: '2026-04-15',
    });

    expect(draft).toMatchObject({
      repeat: 'monthly',
      repeatUntil: null,
      excludedDates: [],
      endTime: '19:30',
    });
    expect(draft?.recurrenceRules).toEqual([
      expect.objectContaining({
        kind: 'monthly',
        startDate: '2026-04-15',
        weekdays: [],
        startTime: '19:00',
        endTime: '19:30',
        isOverride: false,
      }),
    ]);

    const plan = createPlanFromDraft(draft!);

    expect([plan]).toHaveLength(1);
    expect(doesPlanOccurOnDate(plan, '2026-05-15')).toBe(true);
    expect(doesPlanOccurOnDate(plan, '2026-05-16')).toBe(false);
    expect(expandPlansForDate([plan], '2026-05-15')).toHaveLength(1);
  });

  it('does not build repeat drafts without duration or without weekly weekdays', () => {
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
        repeatKind: 'weekly',
        weekdays: [],
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

  it('uses the confirmed start time when building scheduled plan drafts', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'scheduled',
      repeatKind: 'daily',
      startTime: '10:00',
      estimatedMinutes: 240,
    });

    expect(draft).toMatchObject({
      startTime: '10:00',
      endTime: '14:00',
    });
  });

  it('keeps selected material fields on scheduled plan drafts', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'scheduled',
      repeatKind: 'daily',
      materialId: 'material-1',
      materialName: '黄色チャート',
    });

    expect(draft).toMatchObject({
      materialId: 'material-1',
      materialName: '黄色チャート',
    });
  });

  it('clamps quick-entry end times to the end of the same day', () => {
    expect(resolveQuickEntryEndTime('23:30', 60)).toBe('24:00');
    expect(resolveQuickEntryEndTime('23:55', 30)).toBe('24:00');
    expect(resolveQuickEntryEndTime('21:00', 60)).toBe('22:00');
    expect(resolveQuickEntryEndTime('00:00', 60)).toBe('01:00');
  });
});
