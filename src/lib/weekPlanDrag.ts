import { minutesBetween, minutesFromTime } from './date';

const MINUTES_PER_DAY = 24 * 60;

export const WEEK_PLAN_DRAG_SNAP_MINUTES = 5;

export interface WeekPlanMoveTarget {
  date: string;
  startTime: string;
  endTime: string;
}

export interface ResolveWeekPlanDragTargetInput {
  weekDates: string[];
  originalDate: string;
  originalStartTime: string;
  originalEndTime: string;
  deltaX: number;
  deltaY: number;
  dayWidth: number;
  timelineHeight: number;
  allowDateChange?: boolean;
  snapMinutes?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function snapMinutes(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatTime(totalMinutes: number): string {
  const normalized = clamp(Math.round(totalMinutes), 0, MINUTES_PER_DAY);
  if (normalized === MINUTES_PER_DAY) {
    return '24:00';
  }

  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function resolveWeekPlanDragTarget({
  weekDates,
  originalDate,
  originalStartTime,
  originalEndTime,
  deltaX,
  deltaY,
  dayWidth,
  timelineHeight,
  allowDateChange = true,
  snapMinutes: requestedSnapMinutes = WEEK_PLAN_DRAG_SNAP_MINUTES,
}: ResolveWeekPlanDragTargetInput): WeekPlanMoveTarget {
  const step = Math.max(1, Math.round(requestedSnapMinutes));
  const originalStartMinutes = clamp(minutesFromTime(originalStartTime), 0, MINUTES_PER_DAY);
  const originalDuration = Math.max(
    step,
    Math.min(minutesBetween(originalStartTime, originalEndTime), MINUTES_PER_DAY),
  );
  const usableHeight = Math.max(timelineHeight, 1);
  const rawMinuteDelta = (deltaY / usableHeight) * MINUTES_PER_DAY;
  const snappedStart = snapMinutes(originalStartMinutes + rawMinuteDelta, step);
  const targetStartMinutes = clamp(snappedStart, 0, MINUTES_PER_DAY - originalDuration);
  const targetEndMinutes = targetStartMinutes + originalDuration;

  const originalDayIndex = Math.max(weekDates.indexOf(originalDate), 0);
  const safeDayWidth = Math.max(dayWidth, 1);
  const dayDelta = allowDateChange ? Math.round(deltaX / safeDayWidth) : 0;
  const targetDayIndex = clamp(
    originalDayIndex + dayDelta,
    0,
    Math.max(weekDates.length - 1, 0),
  );

  return {
    date: weekDates[targetDayIndex] ?? originalDate,
    startTime: formatTime(targetStartMinutes),
    endTime: formatTime(targetEndMinutes),
  };
}

export function calculateWeekPlanVelocityTilt(
  velocityX: number,
  maximumTiltDegrees = 5,
): number {
  const maximumTilt = Math.max(0, maximumTiltDegrees);
  return clamp(velocityX * 0.012, -maximumTilt, maximumTilt);
}

export function hasWeekPlanMoveChanged(
  originalDate: string,
  originalStartTime: string,
  originalEndTime: string,
  target: WeekPlanMoveTarget,
): boolean {
  return (
    target.date !== originalDate ||
    target.startTime !== originalStartTime ||
    target.endTime !== originalEndTime
  );
}
