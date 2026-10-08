import type { Plan, ScheduleTemplate } from '../../../types/domain';
import { describe, expect, it } from 'vitest';
import type { GenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { buildPlacementWindowsByDate, buildPlacementBusyIntervals } from './weeklyPlanningStableV5PlacementAvailability';

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


it('canceled Plan and timetable occurrences do not remain busy through direct placement inputs', () => {
  const date = '2026-09-09', timestamp = `${date}T00:00:00Z`;
  const plan: Plan = { id: 'p', seriesId: 'p', userId: 'owner-1', title: 'Canceled', subject: '', date,
    startTime: '09:00', endTime: '10:00', type: 'study', repeat: 'none', repeatUntil: null, recurrenceRules: [],
    excludedDates: [date], memo: '', createdAt: timestamp, updatedAt: timestamp };
  const template: ScheduleTemplate = { id: 't', userId: 'owner-1', title: 'Canceled class', subject: '', type: 'school-event',
    weekday: 'wed', startTime: '12:00', endTime: '13:00', active: true, excludedDates: [date], memo: '', createdAt: timestamp, updatedAt: timestamp };
  const graph = input(); graph.availabilityWindows = [];
  const params = { input: graph, dates: [date], plans: [plan], scheduleTemplates: [template] };
  expect(buildPlacementBusyIntervals(params)).toEqual([]);
  expect(buildPlacementBusyIntervals({ ...params, plans: [{ ...plan, excludedDates: [] }] })).toHaveLength(1);
});

it('does not revive an imported timetable source after its saved Plan is canceled', () => {
  const date = '2026-09-09', timestamp = `${date}T00:00:00Z`;
  const template: ScheduleTemplate = { id: 't', userId: 'owner-1', title: 'Class', subject: '', type: 'school-event',
    weekday: 'wed', startTime: '12:00', endTime: '13:00', active: true, memo: '', createdAt: timestamp, updatedAt: timestamp };
  const plan: Plan = { id: 'p', seriesId: 'p', userId: 'owner-1', title: 'Imported', subject: '', date,
    startTime: '12:00', endTime: '13:00', type: 'school-event', repeat: 'none', repeatUntil: null, recurrenceRules: [],
    sourceType: 'timetable', sourceId: template.id, sourceDate: date, excludedDates: [date], memo: '', createdAt: timestamp, updatedAt: timestamp };
  const graph = input(); graph.availabilityWindows = [];
  expect(buildPlacementBusyIntervals({ input: graph, dates: [date], plans: [plan], scheduleTemplates: [template] })).toEqual([]);
  expect(buildPlacementBusyIntervals({ input: graph, dates: [date], plans: [], scheduleTemplates: [template] })).toHaveLength(1);
});
