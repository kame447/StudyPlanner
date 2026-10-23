import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../domain/planner';
import {
  applyRecurringPlanDeleteScope,
  applyRecurringPlanEditScope,
  supportsScopedRecurringPlanEdits,
} from '../domain/recurringPlan';
import { normalizePlanRecord } from '../repositories/repositoryUtils';
import type { Plan, PlanDraft } from '../types/domain';
import { buildQuickEntryPlanDraft } from './quickEntryDrafts';
import { doesPlanOccurOnDate, expandPlansForDate } from './planRecurrence';

function annualPlan(date = '2024-02-29', until = '2032-02-29'): Plan {
  const draft = buildQuickEntryPlanDraft({
    userId: 'annual-owner', mode: 'repeat', repeatKind: 'yearly', title: '年次の予定',
    subject: '英語', type: 'study', memo: '保存するメモ', date, startTime: '19:00',
    estimatedMinutes: 30, weekdays: [],
  })!;
  return createPlanFromDraft({ ...draft, repeatUntil: until,
    recurrenceRules: draft.recurrenceRules.map(rule => ({ ...rule, until })) });
}

function editedDraft(plan: Plan): PlanDraft {
  return { ...plan, title: '変更後の予定', startTime: '20:00', endTime: '21:00', memo: '変更後のメモ' };
}

function snapshot(plan: Plan) {
  return JSON.parse(JSON.stringify(plan));
}

function titles(plans: Plan[], date: string) {
  return expandPlansForDate(plans, date).map(plan => plan.title);
}

describe('yearly plan recurrence', () => {
  it('keeps yearly through draft creation and persisted-record normalization', () => {
    const plan = annualPlan('2026-10-15', '2028-10-15');
    const restored = normalizePlanRecord(snapshot(plan));
    expect(restored.repeat).toBe('yearly');
    expect(restored.recurrenceRules).toMatchObject([{ kind: 'yearly', startDate: '2026-10-15', until: '2028-10-15' }]);
    for (const date of ['2026-10-15', '2027-10-15', '2028-10-15']) {
      expect(doesPlanOccurOnDate(restored, date), date).toBe(true);
    }
    for (const date of ['2025-10-15', '2026-10-16', '2026-11-15', '2027-10-14', '2029-10-15']) {
      expect(doesPlanOccurOnDate(restored, date), date).toBe(false);
    }
  });

  it('preserves leap-day semantics and inclusive expiry without moving into adjacent dates', () => {
    const plan = annualPlan();
    for (const date of ['2024-02-29', '2028-02-29', '2032-02-29']) {
      expect(doesPlanOccurOnDate(plan, date), date).toBe(true);
    }
    for (const date of ['2025-02-28', '2025-03-01', '2026-02-28', '2028-02-28', '2028-03-01', '2036-02-29']) {
      expect(doesPlanOccurOnDate(plan, date), date).toBe(false);
    }
    const century = annualPlan('2096-02-29', '2104-02-29');
    expect(doesPlanOccurOnDate(century, '2100-02-28')).toBe(false);
    expect(doesPlanOccurOnDate(century, '2100-03-01')).toBe(false);
    expect(doesPlanOccurOnDate(century, '2104-02-29')).toBe(true);
  });

  it.each(['structured', 'legacy'] as const)('a %s single edit retains the past and subsequent yearly dates', format => {
    const source = annualPlan();
    if (format === 'legacy') source.recurrenceRules = [];
    const before = snapshot(source);
    expect(supportsScopedRecurringPlanEdits(source)).toBe(true);
    const result = applyRecurringPlanEditScope(source, '2028-02-29', editedDraft(source), 'single');
    const updated = normalizePlanRecord(snapshot(result.updatedPlan!));
    expect(updated.repeat).toBe('yearly');
    expect(result.createdPlan).toBeNull();
    expect(titles([updated], '2024-02-29')).toEqual(['年次の予定']);
    expect(titles([updated], '2028-02-29')).toEqual(['変更後の予定']);
    expect(titles([updated], '2032-02-29')).toEqual(['年次の予定']);
    expect(titles([updated], '2028-03-01')).toEqual([]);
    expect(titles([updated], '2036-02-29')).toEqual([]);
    expect(snapshot(source)).toEqual(before);
  });

  it('a future edit splits the series while preserving prior dates, expiry and later exclusions', () => {
    const source = annualPlan('2024-02-29', '2036-02-29');
    source.excludedDates = ['2032-02-29'];
    const before = snapshot(source);
    const result = applyRecurringPlanEditScope(source, '2028-02-29', editedDraft(source), 'future');
    const old = normalizePlanRecord(snapshot(result.updatedPlan!));
    const future = normalizePlanRecord(snapshot(result.createdPlan!));
    expect(old.id).toBe(source.id);
    expect(future.id).not.toBe(source.id);
    expect(future.seriesId).toBe(source.seriesId);
    expect(old.repeatUntil).toBe('2024-02-29');
    expect(future.repeatUntil).toBe('2036-02-29');
    expect(future.excludedDates).toEqual(['2032-02-29']);
    expect(titles([old, future], '2024-02-29')).toEqual(['年次の予定']);
    expect(titles([old, future], '2028-02-29')).toEqual(['変更後の予定']);
    expect(titles([old, future], '2032-02-29')).toEqual([]);
    expect(titles([old, future], '2036-02-29')).toEqual(['変更後の予定']);
    expect(titles([old, future], '2040-02-29')).toEqual([]);
    expect(snapshot(source)).toEqual(before);
  });

  it('single and future deletion preserve previous occurrences and never widen expiry', () => {
    const source = annualPlan();
    const before = snapshot(source);
    const single = normalizePlanRecord(snapshot(applyRecurringPlanDeleteScope(source, '2028-02-29', 'single')!));
    expect(single.excludedDates).toEqual(['2028-02-29']);
    expect(titles([single], '2024-02-29')).toEqual(['年次の予定']);
    expect(titles([single], '2028-02-29')).toEqual([]);
    expect(titles([single], '2032-02-29')).toEqual(['年次の予定']);
    expect(titles([single], '2036-02-29')).toEqual([]);
    const future = normalizePlanRecord(snapshot(applyRecurringPlanDeleteScope(source, '2028-02-29', 'future')!));
    expect(future.repeatUntil).toBe('2024-02-29');
    expect(titles([future], '2024-02-29')).toEqual(['年次の予定']);
    expect(titles([future], '2028-02-29')).toEqual([]);
    expect(titles([future], '2032-02-29')).toEqual([]);
    expect(applyRecurringPlanDeleteScope(source, '2024-02-29', 'future')).toBeNull();
    expect(snapshot(source)).toEqual(before);
  });
});
