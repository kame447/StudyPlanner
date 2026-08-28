import { describe, expect, it } from 'vitest';
import {
  calculateWeekPlanVelocityTilt,
  hasWeekPlanMoveChanged,
  resolveWeekPlanDragTarget,
} from './weekPlanDrag';

const WEEK_DATES = [
  '2026-08-23',
  '2026-08-24',
  '2026-08-25',
  '2026-08-26',
  '2026-08-27',
  '2026-08-28',
  '2026-08-29',
];

describe('resolveWeekPlanDragTarget', () => {
  it('moves a one-hour plan from 13:00 to 15:30 while preserving duration', () => {
    const target = resolveWeekPlanDragTarget({
      weekDates: WEEK_DATES,
      originalDate: '2026-08-24',
      originalStartTime: '13:00',
      originalEndTime: '14:00',
      deltaX: 0,
      deltaY: 150,
      dayWidth: 80,
      timelineHeight: 1440,
    });

    expect(target).toEqual({
      date: '2026-08-24',
      startTime: '15:30',
      endTime: '16:30',
    });
  });

  it('moves across weekday columns using the current column width', () => {
    const target = resolveWeekPlanDragTarget({
      weekDates: WEEK_DATES,
      originalDate: '2026-08-24',
      originalStartTime: '13:00',
      originalEndTime: '14:00',
      deltaX: 165,
      deltaY: 0,
      dayWidth: 80,
      timelineHeight: 1440,
    });

    expect(target.date).toBe('2026-08-26');
  });

  it('snaps vertical movement to five-minute increments', () => {
    const target = resolveWeekPlanDragTarget({
      weekDates: WEEK_DATES,
      originalDate: '2026-08-24',
      originalStartTime: '13:00',
      originalEndTime: '14:00',
      deltaX: 0,
      deltaY: 13,
      dayWidth: 80,
      timelineHeight: 1000,
    });

    expect(target.startTime).toBe('13:20');
    expect(target.endTime).toBe('14:20');
  });

  it('keeps the full plan inside the day at the lower boundary', () => {
    const target = resolveWeekPlanDragTarget({
      weekDates: WEEK_DATES,
      originalDate: '2026-08-24',
      originalStartTime: '22:30',
      originalEndTime: '23:30',
      deltaX: 0,
      deltaY: 1000,
      dayWidth: 80,
      timelineHeight: 1000,
    });

    expect(target.startTime).toBe('23:00');
    expect(target.endTime).toBe('24:00');
  });

  it('locks the date for recurring-plan drag operations', () => {
    const target = resolveWeekPlanDragTarget({
      weekDates: WEEK_DATES,
      originalDate: '2026-08-24',
      originalStartTime: '13:00',
      originalEndTime: '14:00',
      deltaX: 240,
      deltaY: 0,
      dayWidth: 80,
      timelineHeight: 1440,
      allowDateChange: false,
    });

    expect(target.date).toBe('2026-08-24');
  });
});

describe('week plan drag visual helpers', () => {
  it('caps velocity-driven tilt so the card stays readable', () => {
    expect(calculateWeekPlanVelocityTilt(1000)).toBe(5);
    expect(calculateWeekPlanVelocityTilt(-1000)).toBe(-5);
  });

  it('detects whether a drop actually changes the occurrence', () => {
    expect(
      hasWeekPlanMoveChanged('2026-08-24', '13:00', '14:00', {
        date: '2026-08-24',
        startTime: '13:00',
        endTime: '14:00',
      }),
    ).toBe(false);

    expect(
      hasWeekPlanMoveChanged('2026-08-24', '13:00', '14:00', {
        date: '2026-08-25',
        startTime: '13:00',
        endTime: '14:00',
      }),
    ).toBe(true);
  });
});
