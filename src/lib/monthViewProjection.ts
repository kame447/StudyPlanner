import {
  createScheduleOccurrenceProjection,
  type ScheduleOccurrence,
} from '../domain/scheduleOccurrence';
import { addDays, getMonthGrid, minutesBetween } from './date';
import { sortMonthEvents } from './monthEvents';
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

export interface MonthCalendarWeek {
  index: number;
  startDate: string;
  endDate: string;
  label: string;
  dates: string[];
}

export interface MonthCellProjection extends MonthGridCell {
  targetMinutes: number;
  actualMinutes: number;
  monthEvents: MonthEvent[];
}

export interface MonthPanelProjection {
  weeks: MonthCalendarWeek[];
  cells: MonthCellProjection[];
}

export function buildMonthGrid(monthDate: string): {
  weeks: MonthCalendarWeek[];
  cells: MonthGridCell[];
} {
  // The month calendar is a stable 6 x 7 ARIA grid. `getMonthWeeks` is
  // intentionally variable-width for reporting/week pickers, so the calendar
  // must derive its rows from the fixed 42-cell grid instead of reusing that
  // reporting-oriented helper.
  const cells = getMonthGrid(monthDate);
  const weeks = Array.from({ length: 6 }, (_, index): MonthCalendarWeek => {
    const dates = cells
      .slice(index * 7, index * 7 + 7)
      .map((cell) => cell.date);

    return {
      index,
      startDate: dates[0] ?? '',
      endDate: dates[6] ?? '',
      label: `第${index + 1}週`,
      dates,
    };
  });

  return { weeks, cells };
}

function occurrenceEndForMonthEvent(occurrence: ScheduleOccurrence): {
  endDate: string;
  endTime: string;
} {
  if (
    occurrence.end.time === '00:00' &&
    occurrence.end.date.localeCompare(occurrence.start.date) > 0
  ) {
    return {
      endDate: addDays(occurrence.end.date, -1),
      endTime: '24:00',
    };
  }

  return {
    endDate: occurrence.end.date,
    endTime: occurrence.end.time,
  };
}

function projectOccurrenceAsMonthEvent(params: {
  occurrence: ScheduleOccurrence;
  planById: Map<string, Plan>;
  monthEventById: Map<string, MonthEvent>;
}): MonthEvent | null {
  const { occurrence, planById, monthEventById } = params;
  if (occurrence.category === 'study') {
    return null;
  }

  const end = occurrenceEndForMonthEvent(occurrence);

  if (occurrence.source.backingKind === 'plan') {
    const plan = planById.get(occurrence.source.backingId);
    if (!plan) return null;

    return {
      id: occurrence.id,
      userId: occurrence.ownerId,
      date: occurrence.start.date,
      endDate: end.endDate,
      title: occurrence.title,
      startTime: occurrence.start.time,
      endTime: end.endTime,
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

  if (occurrence.source.backingKind === 'month-event') {
    const monthEvent = monthEventById.get(occurrence.source.backingId);
    if (!monthEvent) return null;

    return {
      ...monthEvent,
      id: occurrence.id,
      date: occurrence.start.date,
      endDate: end.endDate,
      startTime: occurrence.start.time,
      endTime: end.endTime,
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
    };
  }

  return null;
}

function inferSingleOwnerId(plans: readonly Plan[], monthEvents: readonly MonthEvent[]): string {
  const ownerIds = new Set([
    ...plans.map((plan) => plan.userId),
    ...monthEvents.map((event) => event.userId),
  ]);

  return ownerIds.size === 1 ? [...ownerIds][0] ?? '' : '';
}

export function buildMonthPanelProjection({
  monthDate,
  userId,
  plans,
  actuals,
  monthEvents,
}: {
  monthDate: string;
  userId?: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
}): MonthPanelProjection {
  const { weeks, cells } = buildMonthGrid(monthDate);
  const firstDate = cells[0]?.date;
  const lastDate = cells[cells.length - 1]?.date;
  const ownerId = userId ?? inferSingleOwnerId(plans, monthEvents);
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
  const studyPlanMinutesByDate = new Map<string, number>();

  scheduleProjection.occurrences.forEach((occurrence) => {
    if (
      occurrence.category !== 'study' ||
      occurrence.source.backingKind !== 'plan'
    ) {
      return;
    }

    studyPlanMinutesByDate.set(
      occurrence.start.date,
      (studyPlanMinutesByDate.get(occurrence.start.date) ?? 0) +
        minutesBetween(occurrence.start.time, occurrence.end.time),
    );
  });

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const monthEventById = new Map(monthEvents.map((monthEvent) => [monthEvent.id, monthEvent]));
  const projectedMonthEvents = scheduleProjection.occurrences.flatMap((occurrence) => {
    const projected = projectOccurrenceAsMonthEvent({
      occurrence,
      planById,
      monthEventById,
    });
    return projected ? [projected] : [];
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
      monthEvents: sortMonthEvents(
        projectedMonthEvents.filter((event) => {
          const endDate = event.endDate ?? event.date;
          return event.date <= cell.date && cell.date <= endDate;
        }),
      ),
    })),
  };
}
