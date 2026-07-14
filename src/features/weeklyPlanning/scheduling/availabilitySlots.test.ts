import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildAvailabilitySlots,
  intersectInterval,
  mergeIntervals,
  subtractInterval,
  sumIntervals,
} from './availabilitySlots';
import type {
  TimeInterval,
  WeeklyPlanningDefaultConditions,
} from '../weeklyPlanningTypes';
import { plan } from '../testUtils/weeklyPlanningTestHelpers';

const PROPERTY_SEED = 20260714;
const PROPERTY_RUNS = 60;

const defaults: WeeklyPlanningDefaultConditions = {
  startDate: '2026-06-29',
  dayCount: 1,
  reserveDate: '2026-06-30',
  wakeTime: '08:00',
  sleepStartTime: '24:00',
  bufferMinutes: 30,
  minStudyBlockMinutes: 30,
  maxSessionMinutes: 120,
  breakMinutes: 10,
  deepNightAllowed: false,
  unavailableRanges: [],
  availableStudyRanges: [
    { startTime: '09:00', endTime: '14:00', reason: 'test available' },
  ],
  preferredStudyRanges: [
    { startTime: '09:00', endTime: '14:00', reason: 'test preferred' },
  ],
};

function expectSlots(
  slots: ReturnType<typeof buildAvailabilitySlots>,
  expected: Array<[number, number]>,
): void {
  expect(slots.map((slot) => [slot.startMinutes, slot.endMinutes])).toEqual(expected);
}

function timeFromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const intervalArbitrary: fc.Arbitrary<TimeInterval> = fc.record({
  startMinutes: fc.integer({ min: 0, max: 23 * 60 }),
  duration: fc.integer({ min: 1, max: 180 }),
}).map(({ startMinutes, duration }) => ({
  startMinutes,
  endMinutes: Math.min(24 * 60, startMinutes + duration),
}));

describe('weekly availability slot contract', () => {
  it('subtracts an existing plan and both sides of its buffer', () => {
    const slots = buildAvailabilitySlots({
      defaults,
      existingPlans: [
        plan({ date: '2026-06-29', startTime: '10:20', endTime: '11:50' }),
      ],
    });

    expectSlots(slots, [
      [9 * 60, 9 * 60 + 50],
      [12 * 60 + 20, 14 * 60],
    ]);
  });

  it('merges overlapping timetable buffers before creating slots', () => {
    const slots = buildAvailabilitySlots({
      defaults,
      existingPlans: [
        plan({
          id: 'class-1',
          date: '2026-06-29',
          startTime: '10:00',
          endTime: '11:00',
          sourceType: 'timetable',
        }),
        plan({
          id: 'class-2',
          date: '2026-06-29',
          startTime: '11:20',
          endTime: '12:00',
          sourceType: 'timetable',
        }),
      ],
    });

    expectSlots(slots, [
      [9 * 60, 9 * 60 + 30],
      [12 * 60 + 30, 14 * 60],
    ]);
  });
});

describe('weekly availability slot properties', () => {
  it('mergeIntervals is permutation independent, idempotent, and non-mutating', () => {
    fc.assert(fc.property(
      fc.array(intervalArbitrary, { minLength: 0, maxLength: 12 }),
      (intervals) => {
        const original = structuredClone(intervals);
        const merged = mergeIntervals(intervals);

        expect(mergeIntervals([...intervals].reverse())).toEqual(merged);
        expect(mergeIntervals(merged)).toEqual(merged);
        expect(intervals).toEqual(original);
        merged.slice(1).forEach((interval, index) => {
          expect(merged[index].endMinutes).toBeLessThan(interval.startMinutes);
        });
      },
    ), { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS });
  });

  it('subtractInterval removes the blocked range without increasing measure or mutating input', () => {
    fc.assert(fc.property(
      fc.array(intervalArbitrary, { minLength: 0, maxLength: 10 }),
      intervalArbitrary,
      (slots, blocked) => {
        const originalSlots = structuredClone(slots);
        const originalBlocked = structuredClone(blocked);
        const result = subtractInterval(slots, blocked);

        expect(sumIntervals(result)).toBeLessThanOrEqual(sumIntervals(slots));
        expect(result.some((slot) => intersectInterval(slot, blocked))).toBe(false);
        expect(slots).toEqual(originalSlots);
        expect(blocked).toEqual(originalBlocked);
      },
    ), { seed: PROPERTY_SEED + 1, numRuns: PROPERTY_RUNS });
  });

  it('buildAvailabilitySlots ignores unrelated dates and existing-plan order', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        startMinutes: fc.integer({ min: 9 * 60, max: 13 * 60 }),
        duration: fc.constantFrom(30, 45, 60),
      }), { minLength: 0, maxLength: 5 }),
      (generatedPlans) => {
        const existingPlans = generatedPlans.map(({ startMinutes, duration }, index) =>
          plan({
            id: `plan-${index}`,
            date: '2026-06-29',
            startTime: timeFromMinutes(startMinutes),
            endTime: timeFromMinutes(startMinutes + duration),
          }));
        const original = structuredClone(existingPlans);
        const expected = buildAvailabilitySlots({ defaults, existingPlans });
        const unrelated = plan({
          id: 'unrelated',
          date: '2026-07-06',
          startTime: '09:00',
          endTime: '14:00',
        });

        expect(buildAvailabilitySlots({
          defaults,
          existingPlans: [...existingPlans].reverse(),
        })).toEqual(expected);
        expect(buildAvailabilitySlots({
          defaults,
          existingPlans: [unrelated, ...existingPlans],
        })).toEqual(expected);
        expect(existingPlans).toEqual(original);
      },
    ), { seed: PROPERTY_SEED + 2, numRuns: PROPERTY_RUNS });
  });
});
