import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../domain/planner';
import { buildRecurringPlanEditMutation } from '../domain/recurringPlanMutation';
import { createLocalPlannerRepository } from '../repositories/createLocalPlannerRepository';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import { buildQuickEntryPlanDraft } from './quickEntryDrafts';
import { expandPlansForDate } from './planRecurrence';

const CASES = [
  { repeatKind: 'daily', date: '2026-10-15', next: '2026-10-16', later: '2026-10-17', after: '2026-10-18' },
  { repeatKind: 'weekly', date: '2026-10-15', next: '2026-10-22', later: '2026-10-29', after: '2026-11-05' },
  { repeatKind: 'monthly', date: '2026-10-15', next: '2026-11-15', later: '2026-12-15', after: '2027-01-15' },
  { repeatKind: 'yearly', date: '2026-10-15', next: '2027-10-15', later: '2028-10-15', after: '2029-10-15' },
  { repeatKind: 'yearly', date: '2024-02-29', next: '2028-02-29', later: '2032-02-29', after: '2036-02-29' },
] as const;

describe('unbounded recurrence with a bounded single-occurrence override', () => {
  it.each(CASES)('preserves $repeatKind ($date) through single/future mutation persistence and reload', async ({ repeatKind, date, next, later, after }) => {
    const storage = new MemoryStorage();
    const repository = createLocalPlannerRepository(storage);
    const draft = buildQuickEntryPlanDraft({
      userId: 'expiry-owner', mode: 'repeat', repeatKind, date, title: '元の予定', subject: '',
      type: 'other', memo: '', startTime: '19:00', estimatedMinutes: 30, weekdays: ['thu'],
    })!;
    const source = createPlanFromDraft(draft);
    await repository.upsertPlan(source);
    await repository.applyRecurringPlanMutation(source.userId, buildRecurringPlanEditMutation(
      [source], [], source, next, { ...draft, title: 'この日だけ変更' }, 'single',
    ));
    const single = (await createLocalPlannerRepository(storage).getPlans(source.userId))[0];
    expect(single.repeatUntil).toBeNull();
    expect(single.recurrenceRules.find(rule => rule.kind !== 'date')?.until).toBeNull();
    const titles = (plans: typeof source[], occurrenceDate: string) => expandPlansForDate(plans, occurrenceDate).map(plan => plan.title);
    expect(titles([single], date)).toEqual(['元の予定']);
    expect(titles([single], next)).toEqual(['この日だけ変更']);
    expect(titles([single], later)).toEqual(['元の予定']);
    expect(titles([single], after)).toEqual(['元の予定']);
    await repository.applyRecurringPlanMutation(source.userId, buildRecurringPlanEditMutation(
      [single], [], single, later, { ...draft, title: '以降を変更' }, 'future',
    ));
    const split = await createLocalPlannerRepository(storage).getPlans(source.userId);
    expect(split).toHaveLength(2);
    expect(titles(split, date)).toEqual(['元の予定']);
    expect(titles(split, next)).toEqual(['この日だけ変更']);
    expect(titles(split, later)).toEqual(['以降を変更']);
    expect(titles(split, after)).toEqual(['以降を変更']);
    expect(split.find(plan => plan.id !== source.id)?.repeatUntil).toBeNull();
  });
});
