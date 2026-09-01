import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import { getMonthWeeks, minutesBetween } from './date';
import { doesMonthEventOccurOnDate, sortMonthEvents } from './monthEvents';
import { expandPlansForDateRange } from './planRecurrence';
import {
  isStudyRecordForDisplay,
  normalizeStudyRecordsForDisplay,
  sumStudyRecordMinutes,
} from './studyRecords';
import type { Actual, MonthEvent, Plan } from '../types/domain';

export interface MonthGridCell {
  date: string;
  inCurrentMonth: boolean;
}

export interface MonthCellProjection extends MonthGridCell {
  targetMinutes: number;
  actualMinutes: number;
  monthEvents: MonthEvent[];
}

export interface MonthPanelProjection {
  weeks: ReturnType<typeof getMonthWeeks>;
  cells: MonthCellProjection[];
}

export function buildMonthGrid(monthDate: string): {
  weeks: ReturnType<typeof getMonthWeeks>;
  cells: MonthGridCell[];
} {
  const weeks = getMonthWeeks(monthDate);

  return {
    weeks,
    cells: weeks.flatMap((week) =>
      week.dates.map((date) => ({
        date,
        inCurrentMonth: date.startsWith(monthDate.slice(0, 7)),
      })),
    ),
  };
}

function projectNonStudyPlanAsMonthEvent(
  plan: Plan,
  occurrenceDate: string,
): MonthEvent {
  return {
    id: `plan-occurrence:${plan.id}:${occurrenceDate}`,
    userId: plan.userId,
    date: occurrenceDate,
    title: plan.title,
    startTime: plan.startTime,
    endTime: plan.endTime,
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: plan.memo,
    checklist: [],
    locationTags: [],
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function buildMonthPanelProjection({
  monthDate,
  plans,
  actuals,
  monthEvents,
}: {
  monthDate: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
}): MonthPanelProjection {
  const { weeks, cells } = buildMonthGrid(monthDate);
  const firstDate = cells[0]?.date;
  const lastDate = cells[cells.length - 1]?.date;
  const planOccurrences =
    firstDate && lastDate
      ? expandPlansForDateRange(plans, firstDate, lastDate)
      : [];
  const studyPlanMinutesByDate = new Map<string, number>();

  planOccurrences.forEach((plan) => {
    if (plan.type !== 'study') {
      return;
    }

    studyPlanMinutesByDate.set(
      plan.date,
      (studyPlanMinutesByDate.get(plan.date) ?? 0) +
        minutesBetween(plan.startTime, plan.endTime),
    );
  });

  const ownerId = plans[0]?.userId ?? monthEvents[0]?.userId ?? '';
  const scheduleProjection =
    firstDate && lastDate && ownerId
      ? createScheduleOccurrenceProjection({
          ownerId,
          startDate: firstDate,
          endDate: lastDate,
          plans,
          monthEvents,
        })
      : { occurrences: [], issues: [] };
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const projectedPlanEvents = scheduleProjection.occurrences.flatMap((occurrence) => {
    if (
      occurrence.category === 'study' ||
      occurrence.source.backingKind !== 'plan'
    ) {
      return [];
    }

    const plan = planById.get(occurrence.source.backingId);
    if (!plan) {
      return [];
    }

    return [projectNonStudyPlanAsMonthEvent(plan, occurrence.start.date)];
  });

  const actualStudyRecords =
    firstDate && lastDate
      ? normalizeStudyRecordsForDisplay({
          actuals,
          plans,
          startDate: firstDate,
          endDate: lastDate,
        }).filter(isStudyRecordForDisplay)
      : [];

  return {
    weeks,
    cells: cells.map((cell) => ({
      ...cell,
      targetMinutes: studyPlanMinutesByDate.get(cell.date) ?? 0,
      actualMinutes: sumStudyRecordMinutes(
        actualStudyRecords.filter((record) => record.date === cell.date),
      ),
      monthEvents: sortMonthEvents([
        ...monthEvents.filter((monthEvent) =>
          doesMonthEventOccurOnDate(monthEvent, cell.date),
        ),
        ...projectedPlanEvents.filter((event) => event.date === cell.date),
      ]),
    })),
  };
}
