import {
  addDays,
  formatDateLabel,
  formatMinutes,
  getWeekDates,
  minutesBetween,
  sortByDateTime,
} from '../lib/date';
import { getPlanTypeLabel } from '../lib/plans';
import type { Actual, Plan } from '../types/domain';

interface WeekViewProps {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  onChangeWeek: (date: string) => void;
  onOpenDay: (date: string) => void;
}

export function WeekView({
  selectedDate,
  plans,
  actuals,
  onChangeWeek,
  onOpenDay,
}: WeekViewProps) {
  const weekDates = getWeekDates(selectedDate);
  const weekRangeLabel = `${formatDateLabel(weekDates[0])} - ${formatDateLabel(weekDates[6])}`;
  const actualByPlanId = new Map(actuals.map((actual) => [actual.planId, actual]));

  return (
    <section className="panel">
      <div className="view-header-stack">
        <div>
          <div className="view-titlebar">
            <h2>週ビュー</h2>
            <div className="view-title-actions print-hide">
              <div className="nav-actions view-title-nav">
                <button
                  className="ghost-button"
                  onClick={() => onChangeWeek(addDays(selectedDate, -7))}
                  type="button"
                >
                  前の週
                </button>
                <span className="week-range-chip">{weekRangeLabel}</span>
                <button
                  className="ghost-button"
                  onClick={() => onChangeWeek(addDays(selectedDate, 7))}
                  type="button"
                >
                  次の週
                </button>
              </div>
              <button
                className="ghost-button view-print-button"
                onClick={() => window.print()}
                type="button"
              >
                印刷
              </button>
            </div>
          </div>
          <p className="print-hide">計画を土台にし、実績との差分を1週間で比較します。</p>
        </div>
      </div>

      <div className="week-grid week-view-grid">
        {weekDates.map((date) => {
          const dayPlans = sortByDateTime(plans.filter((plan) => plan.date === date));
          const dayPlanMinutes = dayPlans.reduce(
            (sum, plan) => sum + minutesBetween(plan.startTime, plan.endTime),
            0,
          );
          const dayActualMinutes = dayPlans.reduce((sum, plan) => {
            const actual = actualByPlanId.get(plan.id);
            return (
              sum +
              (actual
                ? minutesBetween(actual.actualStartTime, actual.actualEndTime)
                : 0)
            );
          }, 0);

          return (
            <article key={date} className="day-column week-day-column">
              <div className="day-column-head week-day-column-head">
                <div>
                  <button
                    className="week-day-link"
                    onClick={() => onOpenDay(date)}
                    type="button"
                  >
                    {formatDateLabel(date)}
                  </button>
                  <p>
                    計画 {formatMinutes(dayPlanMinutes)} / 実績{' '}
                    {formatMinutes(dayActualMinutes)}
                  </p>
                </div>
              </div>

              <div className="plan-stack week-plan-stack">
                {dayPlans.length > 0 ? (
                  dayPlans.map((plan) => {
                    const actual = actualByPlanId.get(plan.id);
                    const planMinutes = minutesBetween(plan.startTime, plan.endTime);
                    const actualMinutes = actual
                      ? minutesBetween(actual.actualStartTime, actual.actualEndTime)
                      : 0;
                    const widthPercent =
                      planMinutes === 0
                        ? 0
                        : Math.min((actualMinutes / planMinutes) * 100, 100);
                    const deltaMinutes = actualMinutes - planMinutes;

                    return (
                      <div key={plan.id} className="comparison-card week-comparison-card">
                        <div className="comparison-head week-comparison-head">
                          <strong>{plan.title}</strong>
                          <span className="type-badge">
                            {getPlanTypeLabel(plan.type)}
                          </span>
                        </div>

                        <p className="comparison-subtitle">
                          計画 {plan.startTime} - {plan.endTime}
                          {actual
                            ? ` / 実績 ${actual.actualStartTime} - ${actual.actualEndTime}`
                            : ' / 実績 未記録'}
                        </p>

                        <div className="comparison-track">
                          <div className="comparison-plan-bar" />
                          <div
                            className="comparison-actual-bar"
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>

                        <p className="comparison-metrics">
                          差分{' '}
                          {actual
                            ? `${deltaMinutes > 0 ? '+' : ''}${formatMinutes(
                                Math.abs(deltaMinutes),
                              )}`
                            : '未記録'}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <p className="empty-copy">この週の予定はまだありません。</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
