import { describe, expect, it } from 'vitest';
import type { RecurringPlanMutation } from '../domain/recurringPlanMutation';
import type { Actual, Plan } from '../types/domain';
import { prepareRecurringPlanWrite, stripUndefinedDeep } from './plannerWritePreparation';

function plan(id: string): Plan {
  return {
    id, seriesId: id, userId: 'user-1', title: 'Math', subject: 'Math', date: '2026-09-01',
    startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function actual(id: string): Actual {
  return {
    id, userId: 'user-1', planId: 'plan-1', occurrenceDate: '2026-09-01',
    actualStartTime: '09:00', actualEndTime: '10:00', subject: 'Math', note: '',
    updatedAt: '2026-09-01T10:00:00.000Z',
  };
}

function mutation(overrides: Partial<RecurringPlanMutation> = {}): RecurringPlanMutation {
  return { planUpserts: [], planDeletes: [], actualUpserts: [], actualDeletes: [], ...overrides };
}

describe('planner undefined-value sanitization', () => {
  it('removes undefined object fields and array entries recursively without changing the input', () => {
    const nested = Object.freeze({ missing: undefined, kept: 'value' });
    const values = Object.freeze([undefined, nested, null, false, 0, '', [undefined, 1]]);
    const input = Object.freeze({ missing: undefined, nested, values });

    expect(stripUndefinedDeep(input)).toEqual({
      nested: { kept: 'value' },
      values: [{ kept: 'value' }, null, false, 0, '', [1]],
    });
    expect(input).toHaveProperty('missing', undefined);
    expect(nested).toHaveProperty('missing', undefined);
    expect(values).toHaveLength(7);
    expect(values[0]).toBeUndefined();
  });

  it('keeps empty containers after all undefined values have been removed', () => {
    expect(stripUndefinedDeep({ object: { missing: undefined }, array: [undefined] }))
      .toEqual({ object: {}, array: [] });
  });

  it.each([undefined, null, false, true, 0, 42, '', 'value'])(
    'leaves the primitive %s unchanged',
    (value) => expect(stripUndefinedDeep(value)).toBe(value),
  );
});

describe('recurring planner write preparation', () => {
  it('combines explicit, occurrence-duplicate, and linked deletions once per actual ID', () => {
    const explicit = actual('explicit');
    const duplicate = actual('duplicate');
    const linked = actual('linked');
    const updatedExplicit = { ...explicit, note: 'last source wins' };
    const input = mutation({ actualDeletes: [explicit, explicit] });

    const prepared = prepareRecurringPlanWrite(input, {
      duplicateOccurrenceActuals: [duplicate, explicit],
      linkedActuals: [linked, duplicate, updatedExplicit],
    });

    expect(prepared).toEqual({
      actualDeletes: [updatedExplicit, duplicate, linked],
      operationCount: 3,
    });
    expect(prepared.actualDeletes[0]).toBe(updatedExplicit);
    expect(input.actualDeletes).toEqual([explicit, explicit]);
  });

  it('preserves every rebound actual even when all deletion sources include it', () => {
    const rebound = actual('rebound');
    const removed = actual('removed');

    expect(prepareRecurringPlanWrite(mutation({
      actualUpserts: [{ ...rebound, planId: 'replacement' }],
      actualDeletes: [rebound, removed],
    }), {
      duplicateOccurrenceActuals: [rebound],
      linkedActuals: [rebound, removed],
    })).toEqual({ actualDeletes: [removed], operationCount: 2 });
  });

  it('reports no operations for an empty mutation', () => {
    expect(prepareRecurringPlanWrite(mutation(), {
      linkedActuals: [], duplicateOccurrenceActuals: [],
    })).toEqual({ actualDeletes: [], operationCount: 0 });
  });

  it.each([499, 500])('accepts %i operations after deduplication and rebound exclusion', (count) => {
    const removed = actual('removed');
    const rebound = actual('rebound');

    const prepared = prepareRecurringPlanWrite(mutation({
      planUpserts: Array.from({ length: count - 3 }, (_, index) => plan(`plan-${index}`)),
      planDeletes: [plan('deleted-plan')],
      actualUpserts: [rebound],
      actualDeletes: [removed, removed, rebound],
    }), {
      linkedActuals: [removed, rebound],
      duplicateOccurrenceActuals: [removed, rebound],
    });

    expect(prepared).toEqual({ actualDeletes: [removed], operationCount: count });
  });

  it.each(['planUpserts', 'planDeletes', 'actualUpserts', 'actualDeletes'] as const)(
    'rejects 501 operations when %s takes a full batch over the limit',
    (kind) => {
      const input = mutation({
        planUpserts: Array.from({ length: 500 }, (_, index) => plan(`plan-${index}`)),
      });
      if (kind === 'planUpserts' || kind === 'planDeletes') {
        input[kind].push(plan('extra'));
      } else {
        input[kind].push(actual('extra'));
      }

      expect(() => prepareRecurringPlanWrite(input, {
        linkedActuals: [], duplicateOccurrenceActuals: [],
      })).toThrow('Recurring plan mutation exceeds the Firestore batch limit.');
    },
  );

  it('counts fetched dependent actuals toward the batch limit', () => {
    expect(() => prepareRecurringPlanWrite(mutation({ planDeletes: [plan('plan-1')] }), {
      linkedActuals: Array.from({ length: 500 }, (_, index) => actual(`actual-${index}`)),
      duplicateOccurrenceActuals: [],
    })).toThrow('Recurring plan mutation exceeds the Firestore batch limit.');
  });
});
