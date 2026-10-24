import { describe, expect, it, vi } from 'vitest';
import type { Plan, RecurrenceRule } from '../types/domain';
import {
  doesPlanOccurOnDate,
  expandPlansForDate,
  expandPlansForDateRange,
  normalizeRecurrenceRule,
  resolvePlanOccurrence,
} from './planRecurrence';

function createPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1', seriesId: 'series-1', userId: 'owner-1', title: 'Original',
    subject: 'Math', type: 'study', memo: 'Original memo', date: '2026-10-01',
    startTime: '09:00', endTime: '10:00', repeat: 'daily', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], createdAt: '', updatedAt: '', ...overrides,
  };
}

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return normalizeRecurrenceRule({
    id: 'base', kind: 'daily', startDate: '2026-10-01', startTime: '09:00',
    endTime: '10:00', ...overrides,
  }, 0);
}

describe('Plan expansion recurrence evaluation', () => {
  it('evaluates applicability once per rule and eligible date when producing an occurrence', () => {
    const weekdays = rule({ kind: 'weekday', weekdays: ['wed', 'thu', 'fri'] });
    const includes = vi.spyOn(weekdays.weekdays, 'includes');
    const source = createPlan({ recurrenceRules: [weekdays], excludedDates: ['2026-10-16'] });

    expect(expandPlansForDateRange([source], '2026-10-14', '2026-10-17').map(plan => plan.date))
      .toEqual(['2026-10-14', '2026-10-15']);
    // Wed/Thu are admitted, Fri is excluded before evaluation, Sat is rejected.
    expect(includes.mock.calls).toEqual([['wed'], ['thu'], ['sat']]);
    includes.mockRestore();
  });

  it('preserves input order, rule priority, identity, overrides and untouched source fields', () => {
    const rules = [
      rule({ id: 'daily', title: 'Daily' }),
      rule({ id: 'weekday', kind: 'weekday', weekdays: ['thu'], title: 'Weekday' }),
      rule({ id: 'one-day', kind: 'date', dates: ['2026-10-15'], title: 'Override',
        subject: 'English', type: 'other', memo: 'New memo', startTime: '23:30', endTime: '00:30' }),
    ];
    const source = createPlan({ recurrenceRules: rules, sourceDate: '2026-09-01', busy: false });
    const legacy = createPlan({ id: 'legacy', date: '2026-10-15', repeat: 'none' });
    const before = structuredClone([source, legacy]);
    const expanded = expandPlansForDate([source, legacy], '2026-10-15');

    expect(expanded.map(plan => plan.id)).toEqual(['plan-1', 'legacy']);
    expect(expanded[0]).toMatchObject({ title: 'Override', subject: 'English', type: 'other',
      memo: 'New memo', startTime: '23:30', endTime: '00:30', sourceDate: '2026-09-01',
      date: '2026-10-15', occurrenceDate: '2026-10-15', occurrenceKey: 'plan-1::2026-10-15', busy: false });
    expect(expanded[0]).not.toBe(source);
    expect([source, legacy]).toEqual(before);
  });

  it.each(['none', 'daily', 'weekly', 'monthly', 'yearly'] as const)(
    'preserves %s legacy admission and occurrence fields across a leap-day range', repeat => {
      const source = createPlan({ date: '2024-02-29', repeat, repeatUntil: '2028-03-01', excludedDates: ['2028-03-01'] });
      for (const date of ['2024-02-28', '2024-02-29', '2025-02-28', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02']) {
        expect(expandPlansForDate([source], date), date).toEqual(
          doesPlanOccurOnDate(source, date) ? [resolvePlanOccurrence(source, date)] : [],
        );
      }
    },
  );

  it.each(['daily', 'monthly', 'yearly', 'day-type', 'weekday', 'date'] as const)(
    'keeps %s structured matching, exclusions and inclusive expiry equivalent to direct resolution', kind => {
      const source = createPlan({ recurrenceRules: [rule({
        kind, startDate: '2024-02-29', until: '2028-03-02', dates: ['2028-02-29', '2028-03-02'],
        weekdays: ['tue', 'thu'], dayType: 'weekday', title: 'Structured',
      })], excludedDates: ['2028-03-01'] });
      for (const date of ['2024-02-28', '2024-02-29', '2025-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03']) {
        expect(expandPlansForDate([source], date), date).toEqual(
          doesPlanOccurOnDate(source, date) ? [resolvePlanOccurrence(source, date)] : [],
        );
      }
    },
  );

  it('keeps rule tie order and uses the current source on each call without cached matches', () => {
    const first = rule({ id: 'same-id', title: 'First' });
    const second = rule({ id: 'same-id', title: 'Second' });
    const source = createPlan({ recurrenceRules: [first, second] });
    const initial = expandPlansForDate([source], '2026-10-15');
    expect(initial[0]?.title).toBe('First');
    first.title = 'Edited';
    expect(expandPlansForDate([source], '2026-10-15')[0]?.title).toBe('Edited');
    source.excludedDates.push('2026-10-15');
    expect(expandPlansForDate([source], '2026-10-15')).toEqual([]);
    expect(initial[0]?.title).toBe('First');
  });

  it('does not fall back to legacy dates when structured rules have no match', () => {
    const source = createPlan({ recurrenceRules: [rule({ startDate: '2026-11-01' })] });
    expect(expandPlansForDate([source], '2026-10-15')).toEqual([]);
    expect(expandPlansForDateRange([source], '2026-10-16', '2026-10-15')).toEqual([]);
    // Direct resolution remains available for already-recorded/excluded occurrences.
    expect(resolvePlanOccurrence(source, '2026-10-15')).toMatchObject({ title: 'Original', date: '2026-10-15' });
  });
});
