import { addDays, minutesFromTime } from '../../../lib/date';
import type { Plan } from '../../../types/domain';
import type { AvailabilitySlot, TimeInterval, WeeklyPlanningDefaultConditions } from '../weeklyPlanningTypes';

const SIMPLE_DRAFT_DAY_END_MINUTES = 24 * 60;

export function intersectInterval(left: TimeInterval, right: TimeInterval): boolean {
  return left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes;
}

export function subtractInterval(slots: TimeInterval[], blocked: TimeInterval): TimeInterval[] {
  return slots.flatMap((slot) => {
    if (!intersectInterval(slot, blocked)) {
      return [slot];
    }

    const nextSlots: TimeInterval[] = [];

    if (slot.startMinutes < blocked.startMinutes) {
      nextSlots.push({
        startMinutes: slot.startMinutes,
        endMinutes: Math.max(slot.startMinutes, blocked.startMinutes),
      });
    }

    if (blocked.endMinutes < slot.endMinutes) {
      nextSlots.push({
        startMinutes: Math.min(slot.endMinutes, blocked.endMinutes),
        endMinutes: slot.endMinutes,
      });
    }

    return nextSlots.filter(
      (nextSlot) => nextSlot.endMinutes > nextSlot.startMinutes,
    );
  });
}

function buildBaseAvailableIntervals(
  defaults: WeeklyPlanningDefaultConditions,
): TimeInterval[] {
  let intervals: TimeInterval[] = defaults.availableStudyRanges.map((range) => ({
    startMinutes: minutesFromTime(
      defaults.deepNightAllowed ? '00:00' : range.startTime,
    ),
    endMinutes: minutesFromTime(range.endTime),
  }));

  defaults.unavailableRanges.forEach((range) => {
    intervals = subtractInterval(intervals, {
      startMinutes: minutesFromTime(range.startTime),
      endMinutes: minutesFromTime(range.endTime),
    });
  });

  return intervals.filter(
    (interval) =>
      interval.endMinutes - interval.startMinutes >= defaults.minStudyBlockMinutes,
  );
}

export function buildAvailabilitySlots(params: {
  defaults: WeeklyPlanningDefaultConditions;
  existingPlans: Plan[];
}): AvailabilitySlot[] {
  const baseIntervals = buildBaseAvailableIntervals(params.defaults);
  const planningDates = Array.from(
    { length: params.defaults.dayCount },
    (_, index) => addDays(params.defaults.startDate, index),
  );

  return planningDates.flatMap((date) => {
    let intervals = [...baseIntervals];

    params.existingPlans
      .filter((plan) => plan.date === date)
      .forEach((plan) => {
        intervals = subtractInterval(intervals, {
          startMinutes: Math.max(
            0,
            minutesFromTime(plan.startTime) - params.defaults.bufferMinutes,
          ),
          endMinutes: Math.min(
            SIMPLE_DRAFT_DAY_END_MINUTES,
            minutesFromTime(plan.endTime) + params.defaults.bufferMinutes,
          ),
        });
      });

    return intervals
      .filter(
        (interval) =>
          interval.endMinutes - interval.startMinutes >=
          params.defaults.minStudyBlockMinutes,
      )
      .map((interval) => ({
        date,
        ...interval,
      }));
  });
}

export function sumSlotMinutes(slots: AvailabilitySlot[]): number {
  return slots.reduce(
    (sum, slot) => sum + Math.max(0, slot.endMinutes - slot.startMinutes),
    0,
  );
}

export function sumIntervals(intervals: TimeInterval[]): number {
  return intervals.reduce(
    (sum, interval) => sum + Math.max(0, interval.endMinutes - interval.startMinutes),
    0,
  );
}

