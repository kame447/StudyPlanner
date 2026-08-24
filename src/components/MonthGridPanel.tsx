import { useMemo, type CSSProperties } from 'react';
import {
  formatCompactMinutes,
  getCalendarDayTone,
  getJapaneseHolidayName,
  getWeekdayLabels,
} from '../lib/date';
import { formatMonthEventTimeRangeForDate } from '../lib/monthEvents';
import { buildMonthPanelProjection } from '../lib/monthViewProjection';
import type { Actual, MonthEvent, Plan } from '../types/domain';

const MAX_MONTH_EVENT_LANES = 3;

function getCalendarDayNumber(dateString: string): string {
  return Number.parseInt(dateString.slice(-2), 10).toString();
}

function getHolidayLabelLengthClass(holidayName: string): string {
  const holidayLength = [...holidayName].length;

  if (holidayLength >= 7) {
    return 'is-ultra-long';
  }

  if (holidayLength >= 6) {
    return 'is-very-long';
  }

  if (holidayLength >= 5) {
    return 'is-long';
  }

  if (holidayLength >= 4) {
    return 'is-medium';
  }

  return '';
}

function getMonthEventEndDate(monthEvent: MonthEvent): string {
  return monthEvent.endDate ?? monthEvent.date;
}

function isMultiDayMonthEvent(monthEvent: MonthEvent): boolean {
  return getMonthEventEndDate(monthEvent).localeCompare(monthEvent.date) > 0;
}

function getMonthEventToneIndex(monthEvent: MonthEvent): number {
  let hash = 0;

  for (const character of monthEvent.id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash % 5;
}

interface MonthRangeSegment {
  monthEvent: MonthEvent;
  startIndex: number;
  endIndex: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

function buildMonthRangeSegments(
  week: Array<{ date: string }>,
  monthEvents: MonthEvent[],
): MonthRangeSegment[] {
  const weekStart = week[0]?.date;
  const weekEnd = week[week.length - 1]?.date;

  if (!weekStart || !weekEnd) {
    return [];
  }

  const candidates = monthEvents
    .filter((monthEvent) => {
      if (!isMultiDayMonthEvent(monthEvent)) {
        return false;
      }

      const endDate = getMonthEventEndDate(monthEvent);
      return monthEvent.date.localeCompare(weekEnd) <= 0 && endDate.localeCompare(weekStart) >= 0;
    })
    .sort((left, right) => {
      const leftStart = left.date.localeCompare(weekStart) < 0 ? weekStart : left.date;
      const rightStart = right.date.localeCompare(weekStart) < 0 ? weekStart : right.date;
      const startOrder = leftStart.localeCompare(rightStart);

      if (startOrder !== 0) {
        return startOrder;
      }

      const endOrder = getMonthEventEndDate(right).localeCompare(getMonthEventEndDate(left));
      if (endOrder !== 0) {
        return endOrder;
      }

      return left.title.localeCompare(right.title, 'ja');
    });

  const laneEndIndexes = Array.from({ length: MAX_MONTH_EVENT_LANES }, () => -1);
  const segments: MonthRangeSegment[] = [];

  for (const monthEvent of candidates) {
    const endDate = getMonthEventEndDate(monthEvent);
    const clippedStart = monthEvent.date.localeCompare(weekStart) < 0 ? weekStart : monthEvent.date;
    const clippedEnd = endDate.localeCompare(weekEnd) > 0 ? weekEnd : endDate;
    const startIndex = week.findIndex((cell) => cell.date === clippedStart);
    const endIndex = week.findIndex((cell) => cell.date === clippedEnd);

    if (startIndex < 0 || endIndex < startIndex) {
      continue;
    }

    const lane = laneEndIndexes.findIndex((laneEndIndex) => laneEndIndex < startIndex);
    if (lane < 0) {
      continue;
    }

    laneEndIndexes[lane] = endIndex;
    segments.push({
      monthEvent,
      startIndex,
      endIndex,
      lane,
      continuesBefore: monthEvent.date.localeCompare(weekStart) < 0,
      continuesAfter: endDate.localeCompare(weekEnd) > 0,
    });
  }

  return segments;
}

function getRangeSegmentStyle(segment: MonthRangeSegment): CSSProperties {
  return {
    '--month-range-span-days': segment.endIndex - segment.startIndex + 1,
    '--month-range-lane': segment.lane,
  } as CSSProperties;
}

interface MonthGridPanelProps {
  monthDate: string;
  isCurrent: boolean;
  selectedDate: string;
  todayDate: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  registerCellRef: (date: string, node: HTMLButtonElement | null) => void;
  onCellClick: (date: string) => void;
  onMoveSelection: (date: string, offset: number) => void;
  onOpenMonthEventEditor: (date: string) => void;
}

export function MonthGridPanel({
  monthDate,
  isCurrent,
  selectedDate,
  todayDate,
  plans,
  actuals,
  monthEvents,
  registerCellRef,
  onCellClick,
  onMoveSelection,
  onOpenMonthEventEditor,
}: MonthGridPanelProps) {
  const projection = useMemo(
    () =>
      buildMonthPanelProjection({
        monthDate,
        plans,
        actuals,
        monthEvents,
      }),
    [actuals, monthDate, monthEvents, plans],
  );
  const weekRows = useMemo(
    () =>
      Array.from({ length: Math.ceil(projection.cells.length / 7) }, (_, weekIndex) =>
        projection.cells.slice(weekIndex * 7, weekIndex * 7 + 7),
      ),
    [projection.cells],
  );

  return (
    <article
      className={isCurrent ? 'month-pager-panel is-current' : 'month-pager-panel'}
      aria-hidden={!isCurrent}
    >
      <div className="month-grid" role="grid" aria-label="月間カレンダー">
        <div className="month-grid-row month-grid-header-row" role="row">
          {getWeekdayLabels().map((label, index) => (
            <div
              key={label}
              role="columnheader"
              className={[
                'month-weekday',
                index === 5 ? 'is-saturday' : '',
                index === 6 ? 'is-holiday' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {label}
            </div>
          ))}
        </div>

        {weekRows.map((week, weekIndex) => {
          const rangeSegments = buildMonthRangeSegments(week, monthEvents);

          return (
            <div
              className="month-grid-row"
              role="row"
              key={week[0]?.date ?? `week-${weekIndex}`}
            >
              {week.map((cell, cellIndex) => {
                const dayTone = getCalendarDayTone(cell.date);
                const holidayName = getJapaneseHolidayName(cell.date);
                const coveringRangeSegments = rangeSegments.filter(
                  (segment) => segment.startIndex <= cellIndex && segment.endIndex >= cellIndex,
                );
                const reservedRangeLanes = coveringRangeSegments.reduce(
                  (highestLane, segment) => Math.max(highestLane, segment.lane + 1),
                  0,
                );
                const regularMonthEvents = cell.monthEvents.filter(
                  (monthEvent) => !isMultiDayMonthEvent(monthEvent),
                );
                const visibleRegularSlots = Math.max(
                  0,
                  MAX_MONTH_EVENT_LANES - reservedRangeLanes,
                );
                const limitedMonthEvents = regularMonthEvents.slice(0, visibleRegularSlots);
                const hiddenEventCount = Math.max(
                  0,
                  cell.monthEvents.length - coveringRangeSegments.length - limitedMonthEvents.length,
                );
                const startingRangeSegments = rangeSegments.filter(
                  (segment) => segment.startIndex === cellIndex,
                );
                const cellClassName = [
                  'month-cell',
                  cell.inCurrentMonth ? '' : 'is-muted',
                  isCurrent && cell.date === selectedDate ? 'is-selected' : '',
                  cell.date === todayDate ? 'is-today' : '',
                  startingRangeSegments.length > 0 ? 'has-month-range-segment' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <button
                    key={cell.date}
                    role="gridcell"
                    className={cellClassName}
                    ref={isCurrent ? (node) => registerCellRef(cell.date, node) : undefined}
                    onClick={isCurrent ? () => onCellClick(cell.date) : undefined}
                    onKeyDown={
                      isCurrent
                        ? (event) => {
                            switch (event.key) {
                              case 'Enter':
                                event.preventDefault();
                                onOpenMonthEventEditor(cell.date);
                                break;
                              case 'ArrowLeft':
                                event.preventDefault();
                                onMoveSelection(cell.date, -1);
                                break;
                              case 'ArrowRight':
                                event.preventDefault();
                                onMoveSelection(cell.date, 1);
                                break;
                              case 'ArrowUp':
                                event.preventDefault();
                                onMoveSelection(cell.date, -7);
                                break;
                              case 'ArrowDown':
                                event.preventDefault();
                                onMoveSelection(cell.date, 7);
                                break;
                              default:
                                break;
                            }
                          }
                        : undefined
                    }
                    tabIndex={isCurrent && cell.date === selectedDate ? 0 : -1}
                    aria-selected={isCurrent && cell.date === selectedDate}
                    type="button"
                  >
                    {startingRangeSegments.map((segment) => {
                      const toneIndex = getMonthEventToneIndex(segment.monthEvent);
                      const timeLabel = formatMonthEventTimeRangeForDate(
                        segment.monthEvent,
                        cell.date,
                      );

                      return (
                        <span
                          key={`${segment.monthEvent.id}-${week[0]?.date ?? weekIndex}`}
                          className={[
                            'month-range-segment',
                            `tone-${toneIndex}`,
                            segment.continuesBefore ? 'continues-before' : '',
                            segment.continuesAfter ? 'continues-after' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={getRangeSegmentStyle(segment)}
                          title={`${timeLabel} ${segment.monthEvent.title}`}
                        >
                          <span>{segment.monthEvent.title}</span>
                        </span>
                      );
                    })}

                    <div className="month-cell-head">
                      <strong
                        className={[
                          'month-date-number',
                          dayTone === 'saturday' ? 'is-saturday' : '',
                          dayTone === 'holiday' ? 'is-holiday' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {getCalendarDayNumber(cell.date)}
                      </strong>
                      {holidayName ? (
                        <span
                          className={[
                            'month-holiday-label',
                            getHolidayLabelLengthClass(holidayName),
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={holidayName}
                        >
                          {holidayName}
                        </span>
                      ) : null}
                    </div>

                    <p className="month-study-summary">
                      <span>目標 {formatCompactMinutes(cell.targetMinutes)}</span>
                      <span>記録 {formatCompactMinutes(cell.actualMinutes)}</span>
                    </p>

                    <div
                      className="month-major-event-list"
                      style={{
                        marginTop:
                          reservedRangeLanes > 0 ? `calc(${reservedRangeLanes} * 19px)` : undefined,
                      }}
                    >
                      {limitedMonthEvents.map((monthEvent) => {
                        const timeLabel = formatMonthEventTimeRangeForDate(
                          monthEvent,
                          cell.date,
                        );

                        return (
                          <span
                            key={monthEvent.id}
                            className="event-pill month-major-event-pill"
                            title={`${timeLabel} ${monthEvent.title}`}
                          >
                            <span className="month-major-event-full">
                              {timeLabel} {monthEvent.title}
                            </span>
                            <span className="month-major-event-short">{monthEvent.title}</span>
                          </span>
                        );
                      })}

                      {hiddenEventCount > 0 ? (
                        <span className="month-event-more">+{hiddenEventCount}件</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </article>
  );
}
