import { describe, expect, it } from 'vitest';
import {
  distributeDiscreteQuantityAcrossWeeklyBucketsV5,
  distributeMinutesAcrossWeeklyBucketsV5,
  partitionWeeklyPlanningDatesV5,
  preferredDistributedDateV5,
  resolveWeeklySpreadSessionCountV5,
} from './weeklyPlanningStableV5DistributionPolicy';

const WEEK = [
  '2026-08-17',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-22',
  '2026-08-23',
];

describe('Stable V5 distribution policy', () => {
  it('keeps the first six days as normal placement days and the seventh as reserve', () => {
    expect(partitionWeeklyPlanningDatesV5(WEEK)).toEqual({
      normalDates: WEEK.slice(0, 6),
      reserveDates: [WEEK[6]],
    });
  });

  it('assigns ordinary daily quotas to consecutive normal days', () => {
    expect([0, 1, 2].map((index) => preferredDistributedDateV5({
      index,
      count: 3,
      dates: WEEK,
    }))).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
    ]);
  });

  it('derives daily quota count and preserves both minutes and discrete quantity', () => {
    expect(resolveWeeklySpreadSessionCountV5({ totalMinutes: 180, dates: WEEK })).toBe(3);
    expect(resolveWeeklySpreadSessionCountV5({ totalMinutes: 330, dates: WEEK })).toBe(5);
    expect(resolveWeeklySpreadSessionCountV5({ totalMinutes: 720, dates: WEEK })).toBe(6);
    expect(distributeMinutesAcrossWeeklyBucketsV5(330, 5)).toEqual([70, 65, 65, 65, 65]);
    expect(distributeDiscreteQuantityAcrossWeeklyBucketsV5(40, 5)).toEqual([8, 8, 8, 8, 8]);
    expect(distributeDiscreteQuantityAcrossWeeklyBucketsV5(41, 5)).toEqual([9, 8, 8, 8, 8]);
  });
});
