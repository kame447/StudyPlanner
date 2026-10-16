import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import type { HomeDashboardModel } from '../../lib/homeDashboard';
import { playGrowth, playSettle } from '../../lib/motionEffects';

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

function barHeight(minutes: number, maxMinutes: number): number {
  return Math.max(3, Math.round((minutes / maxMinutes) * 100));
}

function buildChartScale(maxMinutes: number): { maxMinutes: number; ticks: number[] } {
  const interval = Math.max(60, Math.ceil(maxMinutes / 3 / 30) * 30);
  const chartMax = interval * 3;
  return {
    maxMinutes: chartMax,
    ticks: [chartMax, interval * 2, interval, 0],
  };
}

/**
 * When the week's numbers change while Home is open (a record saved, a plan
 * added), each bar whose height changed grows from the height it is drawn at
 * toward its new one, and the ring's percentage settles. The first paint and
 * another week only show the values.
 *
 * The drawn heights are read while the update renders, when the previous
 * layout (and any growth still in flight) is still on screen, so a quick
 * second update continues from what the user sees instead of snapping back.
 */
function useProgressMotion(sectionRef: { current: HTMLElement | null }, week: string, signature: string) {
  const committed = useRef<{ week: string; signature: string } | null>(null);
  const drawnBefore = useRef<{ signature: string; heights: Map<string, number>; values: Map<string, string> } | null>(null);

  const before = committed.current;
  if (before && before.week === week && before.signature !== signature && drawnBefore.current?.signature !== signature) {
    drawnBefore.current = { signature, ...readProgress(sectionRef.current) };
  }

  useLayoutEffect(() => {
    const drawn = drawnBefore.current;
    const previous = committed.current;
    drawnBefore.current = null;
    committed.current = { week, signature };
    const section = sectionRef.current;
    if (!section || !previous || previous.week !== week || previous.signature === signature || drawn?.signature !== signature) return;
    for (const bar of Array.from(section.querySelectorAll<HTMLElement>('[data-bar-key]'))) {
      const from = drawn.heights.get(bar.dataset.barKey ?? '');
      const layoutHeight = bar.offsetHeight;
      if (from === undefined || !(layoutHeight > 0) || Math.abs(from - layoutHeight) < 0.5) continue;
      playGrowth(bar, from / layoutHeight);
    }
    for (const value of Array.from(section.querySelectorAll<HTMLElement>('[data-progress-value]'))) {
      const prior = drawn.values.get(value.dataset.progressValue ?? '');
      if (prior !== undefined && prior !== value.textContent) playSettle(value);
    }
  }, [sectionRef, week, signature]);
}

function readProgress(section: HTMLElement | null) {
  const heights = new Map<string, number>();
  const values = new Map<string, string>();
  if (!section || typeof section.querySelectorAll !== 'function') return { heights, values };
  for (const bar of Array.from(section.querySelectorAll<HTMLElement>('[data-bar-key]'))) {
    // The drawn height, including a growth still in flight.
    heights.set(bar.dataset.barKey ?? '', bar.getBoundingClientRect().height);
  }
  for (const value of Array.from(section.querySelectorAll<HTMLElement>('[data-progress-value]'))) {
    values.set(value.dataset.progressValue ?? '', value.textContent ?? '');
  }
  return { heights, values };
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
    '--weekly-progress': `${ringProgress * 3.6}deg`,
  } as CSSProperties;
  const difference = dashboard.weekDeltaMinutesByNow;
  const sectionRef = useRef<HTMLElement | null>(null);
  const progressSignature = [
    dashboard.weekProgressPercent,
    ...dashboard.weekDays.flatMap((item) => [
      barHeight(item.plannedMinutes, chartScale.maxMinutes),
      barHeight(item.actualMinutes, chartScale.maxMinutes),
    ]),
  ].join(',');
  useProgressMotion(sectionRef, dashboard.weekDays[0]?.date ?? '', progressSignature);

  return (
    <section ref={sectionRef} className="home-panel home-progress-panel" data-home-section="weekly-progress">
      <div className="home-section-heading">
        <h2>今週の進捗</h2>
        <button type="button" onClick={onOpenReport}>
          詳細を見る <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="weekly-progress-layout">
        <div
          className="weekly-progress-ring"
          style={ringStyle}
          aria-label={`週全体の予定に対する達成率 ${dashboard.weekProgressPercent}%`}
        >
          <div><strong data-progress-value="week">{dashboard.weekProgressPercent}<small>%</small></strong></div>
        </div>

        <div className="weekly-progress-summary" aria-label="現時点までの予定と実績">
          <span>ここまで <strong>{formatGraphDuration(dashboard.weekExpectedMinutesByNow)}</strong></span>
          <span>実績 <strong>{formatGraphDuration(dashboard.weekActualMinutesByNow)}</strong></span>
          <span className={difference >= 0 ? 'weekly-progress-positive' : 'weekly-progress-negative'}>
            予定比 {difference >= 0 ? '+' : '-'}{formatGraphDuration(Math.abs(difference))}
          </span>
        </div>

        <div className="weekly-progress-chart" aria-label="曜日別の週全体の予定と実績">
          <div className="weekly-progress-legend">
            <span className="weekly-progress-legend-actual">実績</span>
            <span className="weekly-progress-legend-planned">予定</span>
          </div>
          <div className="weekly-progress-plot">
            <div className="weekly-progress-axis" aria-hidden="true">
              {chartScale.ticks.map((tick) => (
                <span key={tick}>{formatAxisDuration(tick)}</span>
              ))}
            </div>
            <div className="weekly-progress-bars">
              {dashboard.weekDays.map((item) => {
                const plannedHeight = barHeight(item.plannedMinutes, chartScale.maxMinutes);
                const actualHeight = barHeight(item.actualMinutes, chartScale.maxMinutes);
                return (
                  <div
                    className="weekly-progress-day"
                    key={item.date}
                    title={`${item.label}: 予定 ${formatGraphDuration(item.plannedMinutes)} / 実績 ${formatGraphDuration(item.actualMinutes)}`}
                  >
                    <div className="weekly-progress-columns">
                      <span
                        className="weekly-progress-plan"
                        data-bar-key={`${item.date}:plan`}
                        data-bar-height={plannedHeight}
                        style={{ height: `${plannedHeight}%` }}
                      />
                      <span
                        className="weekly-progress-actual"
                        data-bar-key={`${item.date}:actual`}
                        data-bar-height={actualHeight}
                        style={{ height: `${actualHeight}%` }}
                      />
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
