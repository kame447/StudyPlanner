import {
  addMonths,
  formatCompactDate,
  formatMinutes,
  formatMonthLabel,
  getMonthGrid,
  getMonthWeeks,
  getWeekdayLabels,
  minutesBetween,
  startOfWeek,
} from '../lib/date';
import { isPrimaryEvent } from '../lib/plans';
import type { Plan } from '../types/domain';

interface MonthViewProps {
  monthDate: string;
  selectedDate: string;
  plans: Plan[];
  onSelectDate: (date: string) => void;
  onChangeMonth: (date: string) => void;
  onOpenWeek: (date: string) => void;
}

export function MonthView({
  monthDate,
  selectedDate,
  plans,
  onSelectDate,
  onChangeMonth,
  onOpenWeek,
}: MonthViewProps) {
  const grid = getMonthGrid(monthDate);
  const weeks = getMonthWeeks(monthDate);
  const selectedWeek = startOfWeek(selectedDate);

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <h2>月ビュー</h2>
          <p>目標勉強時間と主な予定を月全体で確認します。</p>
        </div>

        <div className="nav-actions">
          <button
            className="ghost-button"
            onClick={() => onChangeMonth(addMonths(monthDate, -1))}
            type="button"
          >
            前の月
          </button>
          <strong>{formatMonthLabel(monthDate)}</strong>
          <button
            className="ghost-button"
            onClick={() => onChangeMonth(addMonths(monthDate, 1))}
            type="button"
          >
            次の月
          </button>
        </div>
      </div>

      <div className="week-chip-row">
        {weeks.map((week) => (
          <button
            key={week.startDate}
            className={
              selectedWeek === week.startDate ? 'week-chip active' : 'week-chip'
            }
            onClick={() => {
              const focusDate =
                week.dates.find((date) => date.startsWith(monthDate.slice(0, 7))) ??
                week.startDate;
              onOpenWeek(focusDate);
            }}
            type="button"
          >
            {week.label}
          </button>
        ))}
      </div>

      <div className="month-grid">
        {getWeekdayLabels().map((label) => (
          <div key={label} className="month-weekday">
            {label}
          </div>
        ))}

        {grid.map((cell) => {
          const dayPlans = plans.filter((plan) => plan.date === cell.date);
          const targetMinutes = dayPlans.reduce(
            (sum, plan) => sum + minutesBetween(plan.startTime, plan.endTime),
            0,
          );
          const primaryPlans = dayPlans.filter((plan) => isPrimaryEvent(plan.type));
          const visiblePlans = (primaryPlans.length > 0 ? primaryPlans : dayPlans).slice(
            0,
            2,
          );
          const cellClassName = [
            'month-cell',
            cell.inCurrentMonth ? '' : 'is-muted',
            cell.date === selectedDate ? 'is-selected' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={cell.date}
              className={cellClassName}
              onClick={() => onSelectDate(cell.date)}
              type="button"
            >
              <div className="month-cell-head">
                <strong>{formatCompactDate(cell.date)}</strong>
                {cell.date === selectedDate ? <span className="today-dot" /> : null}
              </div>

              <p className="month-target">
                目標 {targetMinutes > 0 ? formatMinutes(targetMinutes) : '未設定'}
              </p>

              <div className="month-event-list">
                {visiblePlans.length > 0 ? (
                  visiblePlans.map((plan) => (
                    <span key={plan.id} className="event-pill">
                      {plan.title}
                    </span>
                  ))
                ) : (
                  <span className="event-empty">予定なし</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
