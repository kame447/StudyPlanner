import { describe, expect, it } from 'vitest';
import type { Actual, Plan, PlanDraft, RecurrenceRule } from '../types/domain';
import {
  buildRecurringPlanDeleteMutation,
  buildRecurringPlanEditMutation,
} from './recurringPlanMutation';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    id: 'rule-1',
    kind: 'daily',
    startDate: '2026-09-01',
    until: '2026-09-05',
    dates: [],
    weekdays: [],
    dayType: null,
    startTime: '09:00',
    endTime: '10:00',
    isOverride: false,
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: 'Math',
    subject: 'Math',
    date: '2026-09-01',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [rule()],
    type: 'study',
    memo: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    userId: 'user-1',
    title: 'Updated Math',
    subject: 'Math',
    date: '2026-09-03',
    startTime: '10:00',
    endTime: '11:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [rule()],
    type: 'study',
    memo: '',
    ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: 'plan-1',
    occurrenceDate: '2026-09-01',
    actualStartTime: '09:00',
    actualEndTime: '10:00',
    title: 'Math',
    subject: 'Math',
    note: '',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('recurring plan mutation ownership', () => {
  it('derives a future split and Actual rebind from the same boundary', () => {
    const source = plan();
    const mutation = buildRecurringPlanEditMutation(
      [source],
      [
        actual({ id: 'past', occurrenceDate: '2026-09-02' }),
        actual({ id: 'boundary', occurrenceDate: '2026-09-03' }),
        actual({ id: 'future', occurrenceDate: '2026-09-05' }),
        actual({ id: 'wrong-user', userId: 'user-2', occurrenceDate: '2026-09-04' }),
      ],
      source,
      '2026-09-03',
      draft(),
      'future',
    );

    const created = mutation.planUpserts.find((item) => item.id !== source.id);
    expect(created).toBeDefined();
    expect(mutation.actualUpserts.map((item) => item.id)).toEqual(['boundary', 'future']);
    expect(mutation.actualUpserts.every((item) => item.planId === created?.id)).toBe(true);
  });

  it('moves first-occurrence Actuals while deleting the replaced source Plan', () => {
    const source = plan();
    const mutation = buildRecurringPlanEditMutation(
      [source],
      [actual({ id: 'first', occurrenceDate: '2026-09-01' })],
      source,
      '2026-09-01',
      draft({ date: '2026-09-01' }),
      'future',
    );

    expect(mutation.planDeletes.map((item) => item.id)).toEqual(['plan-1']);
    expect(mutation.actualUpserts).toHaveLength(1);
    expect(mutation.actualUpserts[0]?.planId).not.toBe('plan-1');
  });

  it('limits all-series edits to the source owner', () => {
    const source = plan();
    const sibling = plan({ id: 'plan-2' });
    const wrongOwner = plan({ id: 'wrong-owner', userId: 'user-2' });
    const unrelated = plan({ id: 'unrelated', seriesId: 'series-2' });
    const mutation = buildRecurringPlanEditMutation(
      [source, sibling, wrongOwner, unrelated],
      [],
      source,
      '2026-09-03',
      draft(),
      'all',
    );

    expect(mutation.planUpserts.map((item) => item.id).sort()).toEqual(['plan-1', 'plan-2']);
  });

  it('selects only the target occurrence Actual for a single delete', () => {
    const source = plan();
    const mutation = buildRecurringPlanDeleteMutation(
      [source],
      [
        actual({ id: 'target', occurrenceDate: '2026-09-03' }),
        actual({ id: 'other', occurrenceDate: '2026-09-04' }),
      ],
      source,
      '2026-09-03',
      'single',
    );

    expect(mutation.planUpserts).toHaveLength(1);
    expect(mutation.actualDeletes.map((item) => item.id)).toEqual(['target']);
  });

  it('uses the same boundary for future Plan truncation and Actual deletion', () => {
    const source = plan();
    const mutation = buildRecurringPlanDeleteMutation(
      [source],
      [
        actual({ id: 'past', occurrenceDate: '2026-09-02' }),
        actual({ id: 'boundary', occurrenceDate: '2026-09-03' }),
        actual({ id: 'future', occurrenceDate: '2026-09-05' }),
      ],
      source,
      '2026-09-03',
      'future',
    );

    expect(mutation.planUpserts).toHaveLength(1);
    expect(mutation.actualDeletes.map((item) => item.id)).toEqual(['boundary', 'future']);
  });

  it('selects only owned Plans for all-series deletion', () => {
    const source = plan();
    const sibling = plan({ id: 'plan-2' });
    const wrongOwner = plan({ id: 'wrong-owner-plan', userId: 'user-2' });
    const unrelated = plan({ id: 'unrelated', seriesId: 'series-2' });
    const mutation = buildRecurringPlanDeleteMutation(
      [source, sibling, wrongOwner, unrelated],
      [],
      source,
      '2026-09-03',
      'all',
    );

    expect(mutation.planDeletes.map((item) => item.id).sort()).toEqual(['plan-1', 'plan-2']);
  });
});
