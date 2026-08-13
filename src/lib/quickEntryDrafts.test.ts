import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../domain/planner';
import { doesPlanOccurOnDate, expandPlansForDate } from './planRecurrence';
import { buildQuickEntryPlanDraft, resolveQuickEntryEndTime } from './quickEntryDrafts';

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
  it.each([
    ['daily', '2026-04-21'],
    ['monthly', '2026-05-20'],
  ] as const)('builds %s recurrence without materializing future plans', (repeatKind, occurrenceDate) => {
    const draft = buildQuickEntryPlanDraft({ ...baseInput, mode: 'repeat', repeatKind });
    expect(draft).toMatchObject({ repeat: repeatKind, repeatUntil: null, endTime: '19:30' });
    const plan = createPlanFromDraft(draft!);
    expect([plan]).toHaveLength(1);
    expect(doesPlanOccurOnDate(plan, occurrenceDate)).toBe(true);
    expect(expandPlansForDate([plan], occurrenceDate)).toHaveLength(1);
  });

  it('builds weekly recurrence with the selected weekdays', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'repeat',
      repeatKind: 'weekly',
      weekdays: ['mon', 'wed'],
    });
    expect(draft?.recurrenceRules[0]).toMatchObject({
      kind: 'weekday',
      weekdays: ['mon', 'wed'],
      startTime: '19:00',
      endTime: '19:30',
    });
    const plan = createPlanFromDraft(draft!);
    expect(doesPlanOccurOnDate(plan, '2026-04-21')).toBe(false);
    expect(doesPlanOccurOnDate(plan, '2026-04-22')).toBe(true);
  });

  it('keeps scheduled plans non-recurring and preserves material fields', () => {
    const draft = buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'scheduled',
      repeatKind: 'daily',
      materialId: 'material-1',
      materialName: '黄色チャート',
    });
    expect(draft).toMatchObject({
      repeat: 'none',
      recurrenceRules: [],
      endTime: '19:30',
      materialId: 'material-1',
      materialName: '黄色チャート',
    });
  });

  it('preserves every representable sub-day duration across midnight', () => {
    expect(resolveQuickEntryEndTime('23:30', 60)).toBe('00:30');
    expect(resolveQuickEntryEndTime('23:55', 30)).toBe('00:25');
    expect(resolveQuickEntryEndTime('00:00', 60)).toBe('01:00');
    expect(resolveQuickEntryEndTime('19:00', 1439)).toBe('18:59');
  });

  it.each([
    { date: '', startTime: '19:00', estimatedMinutes: 30 },
    { date: '2026-02-30', startTime: '19:00', estimatedMinutes: 30 },
    { date: '2026-04-20', startTime: '', estimatedMinutes: 30 },
    { date: '2026-04-20', startTime: '24:00', estimatedMinutes: 30 },
    { date: '2026-04-20', startTime: '19:00', estimatedMinutes: 0 },
    { date: '2026-04-20', startTime: '19:00', estimatedMinutes: 1440 },
    { date: '2026-04-20', startTime: '19:00', estimatedMinutes: null },
  ])('rejects invalid schedule boundary %#', (override) => {
    expect(buildQuickEntryPlanDraft({
      ...baseInput,
      ...override,
      mode: 'scheduled',
      repeatKind: 'daily',
    })).toBeNull();
  });

  it('rejects weekly recurrence without weekdays', () => {
    expect(buildQuickEntryPlanDraft({
      ...baseInput,
      mode: 'repeat',
      repeatKind: 'weekly',
      weekdays: [],
    })).toBeNull();
  });
});
