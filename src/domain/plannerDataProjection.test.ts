import { describe, expect, it } from 'vitest';
import type { Actual, Plan } from '../types/domain';
import type { RecurringPlanMutation } from './recurringPlanMutation';
import {
  applyRecurringActualProjection,
  applyRecurringPlanProjection,
  sortAndUpsertPlans,
  upsertActualByOccurrenceKey,
  upsertActualsById,
} from './plannerDataTransforms';

const timestamp = '2026-10-20T00:00:00.000Z';
function plan(id: string, overrides: Partial<Plan> = {}): Plan {
  return { id, seriesId: id, userId: 'owner', title: id, subject: '', date: '2026-10-20',
    startTime: '09:00', endTime: '10:00', type: 'study', memo: '', repeat: 'none',
    repeatUntil: null, excludedDates: [], recurrenceRules: [],
    createdAt: timestamp, updatedAt: timestamp, ...overrides };
}
function actual(id: string, overrides: Partial<Actual> = {}): Actual {
  return { id, userId: 'owner', planId: null, occurrenceDate: '2026-10-20',
    actualStartTime: '09:00', actualEndTime: '10:00', title: id, subject: '',
    isAlignedToPlan: false, note: '', updatedAt: timestamp, ...overrides };
}
function mutation(overrides: Partial<RecurringPlanMutation> = {}): RecurringPlanMutation {
  return { planUpserts: [], planDeletes: [], actualUpserts: [], actualDeletes: [], ...overrides };
}

// Freeze the input array and records without changing the production parameter
// types. These transitions must also be safe when React replays an updater.
function frozen<T extends object>(rows: T[]): T[] {
  rows.forEach(Object.freeze);
  return Object.freeze(rows) as T[];
}

describe('planner compatibility projection transitions', () => {
  it('keeps the last plan per ID, sorts chronologically and preserves equal-time order', () => {
    const untouched = plan('untouched');
    const current = frozen([plan('later', { date: '2026-10-21' }), plan('replace'), untouched]);
    const replacement = plan('replace', { title: 'last update' });
    const updates = frozen([plan('replace', { title: 'first update' }),
      plan('earlier', { startTime: '08:00' }), replacement]);
    const result = sortAndUpsertPlans(current, updates);
    expect(result.map(row => row.id)).toEqual(['earlier', 'untouched', 'replace', 'later']);
    expect(result[1]).toBe(untouched);
    expect(result[2]).toBe(replacement);
    expect(sortAndUpsertPlans(current, updates)).toEqual(result);
    expect(current.map(row => row.id)).toEqual(['later', 'replace', 'untouched']);
  });

  it('restores actuals by persisted ID rather than collapsing records by occurrence', () => {
    const first = actual('first', { planId: 'plan' });
    const replaced = actual('replace');
    const second = actual('second', { planId: 'plan' });
    const result = upsertActualsById(frozen([first, replaced]), frozen([
      actual('replace', { title: 'intermediate' }), second, actual('replace', { title: 'final' }),
    ]));
    expect(result.map(row => row.id)).toEqual(['first', 'second', 'replace']);
    expect(result[0]).toBe(first);
    expect(result[2].title).toBe('final');
  });

  it('replaces a linked occurrence, removes obsolete IDs and preserves other dates and standalone records', () => {
    const otherDate = actual('other-date', { planId: 'plan', occurrenceDate: '2026-10-21' });
    const standalone = actual('standalone');
    const input = frozen([actual('old', { planId: 'plan' }), otherDate, standalone, actual('temporary')]);
    const saved = actual('canonical', { planId: 'plan' });
    const result = upsertActualByOccurrenceKey(input, saved, ['temporary']);
    expect(result).toEqual([otherDate, standalone, saved]);
    expect(upsertActualByOccurrenceKey(result, saved, ['temporary'])).toEqual(result);
    expect(input).toHaveLength(4);
  });

  it('keys standalone records by ID rather than their shared date', () => {
    const retained = actual('retained');
    const saved = actual('edited', { title: 'updated' });
    expect(upsertActualByOccurrenceKey(frozen([actual('edited'), retained]), saved))
      .toEqual([retained, saved]);
  });

  it('applies recurring deletes before upserts and removes linked actuals only from deleted plans', () => {
    const deletedPlan = plan('deleted');
    const keptPlan = plan('kept');
    const recreatedPlan = plan('deleted', { title: 'replacement', startTime: '08:00' });
    const standalone = actual('standalone');
    const keptActual = actual('kept-actual', { planId: 'kept' });
    const restoredActual = actual('explicit-delete', { planId: 'deleted', title: 'restored' });
    const change = mutation({
      planDeletes: frozen([deletedPlan]), planUpserts: frozen([recreatedPlan]),
      actualDeletes: frozen([actual('explicit-delete')]), actualUpserts: frozen([restoredActual]),
    });
    Object.freeze(change);
    const plans = frozen([keptPlan, deletedPlan]);
    const actuals = frozen([actual('linked-delete', { planId: 'deleted' }), standalone,
      keptActual, actual('explicit-delete', { planId: 'kept' })]);
    expect(applyRecurringPlanProjection(plans, change)).toEqual([recreatedPlan, keptPlan]);
    expect(applyRecurringActualProjection(actuals, change)).toEqual([standalone, keptActual, restoredActual]);
    expect(actuals).toHaveLength(4);
    expect(plans).toEqual([keptPlan, deletedPlan]);
  });

  it('preserves recurring no-op rows and leaves persisted IDs unchanged', () => {
    const plans = frozen([plan('plan')]);
    const actuals = frozen([actual('actual', { planId: 'plan' })]);
    expect(applyRecurringPlanProjection(plans, mutation())).toEqual(plans);
    expect(applyRecurringActualProjection(actuals, mutation())).toEqual(actuals);
    expect(applyRecurringPlanProjection(plans, mutation())[0]).toBe(plans[0]);
    expect(applyRecurringActualProjection(actuals, mutation())[0]).toBe(actuals[0]);
  });
});
