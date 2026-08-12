import { describe, expect, it } from 'vitest';
import type { GenericSchedulerTaskRelation } from './weeklyPlanningGenericSchedulerInput';
import {
  leavesTinyWindowFragmentV5,
  normalDailyLoadSoftCapMinutesV5,
  orderPlacementDatesV5,
  relationNotBeforeV5,
  taskOrdinalMapV5,
} from './weeklyPlanningStableV5PlacementPolicy';

const dates = [
  '2026-08-17',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-22',
  '2026-08-23',
];

function relation(
  kind: GenericSchedulerTaskRelation['kind'],
  fromTaskId: string,
  toTaskId: string,
): GenericSchedulerTaskRelation {
  return {
    factId: `${kind}:${fromTaskId}:${toTaskId}`,
    kind,
    fromTaskId,
    toTaskId,
  };
}

describe('Stable V5 placement policy adversarial audit', () => {
  it('assigns distinct canonical ordinals instead of resetting every singleton task to zero', () => {
    const ordinals = taskOrdinalMapV5(['task-a', 'task-a', 'task-b', 'task-c', 'task-b']);
    expect([...ordinals.entries()]).toEqual([
      ['task-a', 0],
      ['task-b', 1],
      ['task-c', 2],
    ]);
  });

  it('keeps day seven as reserve and ranks normal days by projected load after preferred date', () => {
    const loads = new Map(dates.map((date) => [date, 0]));
    loads.set('2026-08-18', 120);
    const ordered = orderPlacementDatesV5({
      allowedDates: dates,
      allDates: dates,
      preferredDate: '2026-08-17',
      dayLoads: loads,
      durationMinutes: 60,
      totalMovableMinutes: 360,
    });
    expect(ordered[0]).toBe('2026-08-17');
    expect(ordered[ordered.length - 1]).toBe('2026-08-23');
    expect(ordered.indexOf('2026-08-18')).toBeGreaterThan(ordered.indexOf('2026-08-19'));
    expect(normalDailyLoadSoftCapMinutesV5({
      totalMovableMinutes: 360,
      dates,
    })).toBe(90);
  });

  it.each([
    ['before', 'a', 'b'],
    ['sequence', 'a', 'b'],
    ['after', 'b', 'a'],
    ['depends_on', 'b', 'a'],
  ] as const)('derives a chronological lower bound for %s', (kind, from, to) => {
    const result = relationNotBeforeV5({
      taskId: 'b',
      relations: [relation(kind, from, to)],
      placedBlocks: [{
        taskId: 'a',
        date: '2026-08-21',
        startTime: '10:00',
        endTime: '11:30',
      }],
    });
    expect(result).toEqual({ date: '2026-08-21', time: '11:30' });
  });

  it('does not turn priority_over into a fake chronological dependency', () => {
    expect(relationNotBeforeV5({
      taskId: 'b',
      relations: [relation('priority_over', 'a', 'b')],
      placedBlocks: [{
        taskId: 'a',
        date: '2026-08-21',
        startTime: '10:00',
        endTime: '11:30',
      }],
    })).toBeUndefined();
  });

  it('uses fixed predecessor completion when the predecessor itself is not movable', () => {
    expect(relationNotBeforeV5({
      taskId: 'b',
      relations: [relation('depends_on', 'b', 'fixed-a')],
      placedBlocks: [],
      fixedTaskEnds: new Map([
        ['fixed-a', { date: '2026-08-20', time: '18:00' }],
      ]),
    })).toEqual({ date: '2026-08-20', time: '18:00' });
  });

  it('identifies a 10-minute unusable tail but permits a 30-minute remainder', () => {
    expect(leavesTinyWindowFragmentV5({
      windowStart: 9 * 60,
      windowEnd: 11 * 60 + 10,
      candidateStart: 9 * 60,
      durationMinutes: 120,
    })).toBe(true);
    expect(leavesTinyWindowFragmentV5({
      windowStart: 9 * 60,
      windowEnd: 11 * 60 + 30,
      candidateStart: 9 * 60,
      durationMinutes: 120,
    })).toBe(false);
  });
});
