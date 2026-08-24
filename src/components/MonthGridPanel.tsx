import { useMemo } from 'react';
import {
  formatCompactMinutes,
  getCalendarDayTone,
  getJapaneseHolidayName,
  getWeekdayLabels,
} from '../lib/date';
import { formatMonthEventTimeRangeForDate } from '../lib/monthEvents';
import { buildMonthPanelProjection } from '../lib/monthViewProjection';
import type { Actual, MonthEvent, Plan } from '../types/domain';

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

        {weekRows.map((week, weekIndex) => (
          <div
            className="month-grid-row"
            role="row"
            key={week[0]?.date ?? `week-${weekIndex}`}
          >
            {week.map((cell) => {
              const dayTone = getCalendarDayTone(cell.date);
              const holidayName = getJapaneseHolidayName(cell.date);
              const limitedMonthEvents = cell.monthEvents.slice(0, 3);
              const cellClassName = [
                'month-cell',
                cell.inCurrentMonth ? '' : 'is-muted',
                isCurrent && cell.date === selectedDate ? 'is-selected' : '',
                cell.date === todayDate ? 'is-today' : '',
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

                  <div className="month-major-event-list">
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

                    {cell.monthEvents.length > limitedMonthEvents.length ? (
                      <span className="month-event-more">
                        +{cell.monthEvents.length - limitedMonthEvents.length}件
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </article>
  );
}
