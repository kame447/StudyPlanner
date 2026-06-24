import { describe, expect, it } from 'vitest';
import { buildAvailabilitySlots } from './availabilitySlots';
import type { WeeklyPlanningDefaultConditions } from '../weeklyPlanningTypes';
import { plan } from '../testUtils/weeklyPlanningTestHelpers';

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

function expectSlots(slots: ReturnType<typeof buildAvailabilitySlots>, expected: Array<[number, number]>): void {
  expect(slots.map((slot) => [slot.startMinutes, slot.endMinutes])).toEqual(expected);
}

describe('weekly availability slots', () => {
  it('excludes an existing plan and its 30 minute buffer as a hard constraint', () => {
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

  it('allows time before the buffer but not a slot that enters the pre-class buffer', () => {
    const slots = buildAvailabilitySlots({
      defaults,
      existingPlans: [
        plan({ date: '2026-06-29', startTime: '10:20', endTime: '11:50' }),
      ],
    });

    expect(slots.some((slot) => slot.startMinutes <= 9 * 60 && slot.endMinutes >= 9 * 60 + 50)).toBe(true);
    expect(slots.some((slot) => slot.startMinutes <= 9 * 60 + 30 && slot.endMinutes >= 10 * 60 + 20)).toBe(false);
  });

  it('allows time after the buffer but not the post-class buffer itself', () => {
    const slots = buildAvailabilitySlots({
      defaults,
      existingPlans: [
        plan({ date: '2026-06-29', startTime: '10:20', endTime: '11:50' }),
      ],
    });

    expect(slots.some((slot) => slot.startMinutes <= 12 * 60 + 20 && slot.endMinutes >= 14 * 60)).toBe(true);
    expect(slots.some((slot) => slot.startMinutes < 12 * 60 + 20 && slot.endMinutes > 11 * 60 + 50)).toBe(false);
  });

  it('merges busy intervals from multiple timetable plans before creating slots', () => {
    const slots = buildAvailabilitySlots({
      defaults,
      existingPlans: [
        plan({ id: 'class-1', date: '2026-06-29', startTime: '10:00', endTime: '11:00', sourceType: 'timetable' }),
        plan({ id: 'class-2', date: '2026-06-29', startTime: '11:20', endTime: '12:00', sourceType: 'timetable' }),
      ],
    });

    expectSlots(slots, [
      [9 * 60, 9 * 60 + 30],
      [12 * 60 + 30, 14 * 60],
    ]);
  });
});
