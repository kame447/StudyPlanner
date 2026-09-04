import { describe, expect, it } from 'vitest';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { buildPlacementWindowsByDate } from './weeklyPlanningStableV5PlacementAvailability';

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
});
