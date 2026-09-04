import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { addDays } from './date';

export interface WeekSpanningOccurrenceLayoutItem {
  occurrence: ScheduleOccurrence;
  startColumn: number;
  endColumn: number;
  lane: number;
}

export interface WeekSpanningOccurrenceLayout {
  items: WeekSpanningOccurrenceLayoutItem[];
  laneCount: number;
}

export function isScheduleOccurrenceOutsideHourlyGrid(
  occurrence: Pick<ScheduleOccurrence, 'start' | 'end'>,
): boolean {
  return occurrence.start.date !== occurrence.end.date;
}

function inclusiveDisplayEndDate(
  occurrence: Pick<ScheduleOccurrence, 'end'>,
): string {
  return occurrence.end.time === '00:00'
    ? addDays(occurrence.end.date, -1)
    : occurrence.end.date;
}

export function layoutWeekSpanningOccurrences(
  occurrences: readonly ScheduleOccurrence[],
  weekDates: readonly string[],
): WeekSpanningOccurrenceLayout {
  if (weekDates.length === 0) {
    return { items: [], laneCount: 0 };
  }

  const weekStart = weekDates[0];
  const weekEnd = weekDates[weekDates.length - 1];
  const candidates = occurrences
    .filter(isScheduleOccurrenceOutsideHourlyGrid)
    .flatMap((occurrence) => {
      const clippedStart = occurrence.start.date < weekStart
        ? weekStart
        : occurrence.start.date;
      const displayEnd = inclusiveDisplayEndDate(occurrence);
      const clippedEnd = displayEnd > weekEnd ? weekEnd : displayEnd;
      if (clippedEnd < weekStart || clippedStart > weekEnd || clippedEnd < clippedStart) {
        return [];
      }

      const startColumn = weekDates.indexOf(clippedStart);
      const endDateIndex = weekDates.indexOf(clippedEnd);
      if (startColumn < 0 || endDateIndex < 0) return [];

      return [{
        occurrence,
        startColumn,
        endColumn: endDateIndex + 1,
      }];
    })
    .sort((left, right) =>
      left.startColumn - right.startColumn ||
      right.endColumn - left.endColumn ||
      left.occurrence.id.localeCompare(right.occurrence.id),
    );

  const active: Array<{ lane: number; endColumn: number }> = [];
  const items: WeekSpanningOccurrenceLayoutItem[] = [];
  let laneCount = 0;

  for (const candidate of candidates) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].endColumn <= candidate.startColumn) active.splice(index, 1);
    }

    const usedLanes = new Set(active.map((entry) => entry.lane));
    let lane = 0;
    while (usedLanes.has(lane)) lane += 1;

    active.push({ lane, endColumn: candidate.endColumn });
    laneCount = Math.max(laneCount, lane + 1);
    items.push({ ...candidate, lane });
  }

  return { items, laneCount };
}
