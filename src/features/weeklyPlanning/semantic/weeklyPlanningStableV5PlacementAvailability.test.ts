import { describe, expect, it } from 'vitest';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import {
  buildHardAvailableWindowsByDate,
  buildPlacementWindowsByDate,
} from './weeklyPlanningStableV5PlacementAvailability';

function input(): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-1',
    horizon: {
      startDate: '2026-09-09',
      endDate: '2026-09-10',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [{
      id: 'available-wednesday',
      kind: 'available',
      start: { date: '2026-09-09', time: '21:00' },
      end: { date: '2026-09-09', time: '23:00' },
      timeZone: 'Asia/Tokyo',
      constraintLevel: 'hard',
      sourceKind: 'user_declaration',
      sourceRef: 'availability-wednesday',
      ownerId: 'owner-1',
      graphRevision: 1,
    }],
    sourceSelections: [],
    relations: [],
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: [],
  };
}

describe('Stable V5 explicit hard availability ownership', () => {
  it('uses an explicit 21:00-23:00 availability window even though the fallback day ends at 22:00', () => {
    const windows = buildPlacementWindowsByDate({
      input: input(),
      dates: ['2026-09-09', '2026-09-10'],
      dayStartTime: '09:00',
      dayEndTime: '22:00',
    });

    expect(windows.get('2026-09-09')).toEqual([{ start: 21 * 60, end: 23 * 60 }]);
    expect(windows.get('2026-09-10')).toEqual([{ start: 9 * 60, end: 22 * 60 }]);
  });

  it.each([
    {
      label: 'cross-midnight interval', endDate: '2026-09-10', endTime: '02:00',
      notBefore: undefined,
      first: [{ start: 1320, end: 1440 }], second: [{ start: 0, end: 120 }],
    },
    {
      label: 'cross-midnight interval clipped by request time', endDate: '2026-09-10', endTime: '02:00',
      notBefore: { date: '2026-09-10', time: '01:00' },
      first: [], second: [{ start: 60, end: 120 }],
    },
    {
      label: 'same-day 24:00 endpoint', endDate: '2026-09-09', endTime: '24:00',
      notBefore: undefined,
      first: [{ start: 1320, end: 1440 }], second: undefined,
    },
  ])('uses the same explicit boundary for base and preferred placement: $label', (sample) => {
    const schedulerInput = input();
    schedulerInput.availabilityWindows[0].start.time = '22:00';
    schedulerInput.availabilityWindows[0].end = { date: sample.endDate, time: sample.endTime };
    const params = {
      input: schedulerInput, dates: ['2026-09-09', '2026-09-10'], notBefore: sample.notBefore,
    };
    const hardWindows = buildHardAvailableWindowsByDate(params);
    const baseWindows = buildPlacementWindowsByDate({
      ...params, dayStartTime: '09:00', dayEndTime: '22:00',
    });
    expect(hardWindows.get('2026-09-09')).toEqual(sample.first);
    expect(baseWindows.get('2026-09-09')).toEqual(sample.first);
    expect(hardWindows.get('2026-09-10')).toEqual(sample.second);
    expect(baseWindows.get('2026-09-10')).toEqual(sample.second ?? [{ start: 540, end: 1320 }]);
  });

});
