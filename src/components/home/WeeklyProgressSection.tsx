import type { CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import type { HomeDashboardModel } from '../../lib/homeDashboard';

function formatGraphDuration(minutes: number): string {
  const normalized = Math.max(0, Math.round(minutes));
  if (normalized === 0) return '0m';
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${rest}m`;
}

function formatAxisDuration(minutes: number): string {
  const normalized = Math.max(0, Math.round(minutes));
  if (normalized === 0) return '0';
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${rest}m`;
}

function buildChartScale(maxMinutes: number): { maxMinutes: number; ticks: number[] } {
  const interval = Math.max(60, Math.ceil(maxMinutes / 3 / 30) * 30);
  const chartMax = interval * 3;
  return {
    maxMinutes: chartMax,
    ticks: [chartMax, interval * 2, interval, 0],
  };
}

export function WeeklyProgressSection({
  dashboard,
  onOpenReport,
}: {
  dashboard: HomeDashboardModel;
  onOpenReport: () => void;
}) {
  const maxDayMinutes = Math.max(
    60,
    ...dashboard.weekDays.flatMap((item) => [item.plannedMinutes, item.actualMinutes]),
  );
  const chartScale = buildChartScale(maxDayMinutes);
  const ringProgress = Math.max(0, Math.min(100, dashboard.weekProgressPercent));
  const ringStyle = {
    '--home-progress': `${ringProgress * 3.6}deg`,
  } as CSSProperties;
  const difference = dashboard.weekDeltaMinutesByNow;

  return (
    <section className="home-panel home-progress-panel" data-home-section="weekly-progress">
      <div className="home-section-heading">
        <h2>今週の進捗</h2>
        <button type="button" onClick={onOpenReport}>
          詳細を見る <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="home-progress-fixed-layout">
        <div
          className="home-progress-ring"
          style={ringStyle}
          aria-label={`週全体の予定に対する達成率 ${dashboard.weekProgressPercent}%`}
        >
          <div><strong>{dashboard.weekProgressPercent}%</strong></div>
        </div>

        <div className="home-progress-copy" aria-label="現時点までの予定と実績">
          <span>ここまで <strong>{formatGraphDuration(dashboard.weekExpectedMinutesByNow)}</strong></span>
          <span>実績 <strong>{formatGraphDuration(dashboard.weekActualMinutesByNow)}</strong></span>
          <span className={difference >= 0 ? 'positive' : 'negative'}>
            予定比 {difference >= 0 ? '+' : '-'}{formatGraphDuration(Math.abs(difference))}
          </span>
        </div>

        <div className="home-week-chart" aria-label="曜日別の週全体の予定と実績">
          <div className="home-chart-legend">
            <span className="actual">実績</span>
            <span className="planned">予定</span>
          </div>
          <div className="home-chart-plot">
            <div className="home-chart-axis" aria-hidden="true">
              {chartScale.ticks.map((tick) => (
                <span key={tick}>{formatAxisDuration(tick)}</span>
              ))}
            </div>
            <div className="home-chart-bars">
              {dashboard.weekDays.map((item) => {
                const plannedHeight = Math.max(
                  3,
                  Math.round((item.plannedMinutes / chartScale.maxMinutes) * 100),
                );
                const actualHeight = Math.max(
                  3,
                  Math.round((item.actualMinutes / chartScale.maxMinutes) * 100),
                );
                return (
                  <div
                    className="home-chart-day"
                    key={item.date}
                    title={`${item.label}: 予定 ${formatGraphDuration(item.plannedMinutes)} / 実績 ${formatGraphDuration(item.actualMinutes)}`}
                  >
                    <div className="home-chart-columns">
                      <span className="home-chart-plan" style={{ height: `${plannedHeight}%` }} />
                      <span className="home-chart-actual" style={{ height: `${actualHeight}%` }} />
                    </div>
                    <small>{item.label}</small>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
