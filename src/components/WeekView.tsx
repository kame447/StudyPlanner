import { useState, type CSSProperties } from 'react';
import {
  addDays,
  formatDateLabel,
  formatMinutes,
  getWeekDates,
  minutesBetween,
  minutesFromTime,
  sortByDateTime,
} from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  getActualOccurrenceKey,
} from '../lib/planRecurrence';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { getSubjectLabel, getSubjectTheme } from '../lib/subjectTheme';
import type { Actual, Plan } from '../types/domain';

interface WeekViewProps {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  onChangeWeek: (date: string) => void;
  onOpenDay: (date: string) => void;
}

type WeekTimelineMode = 'plan' | 'actual' | 'compare';

interface WeekTimelineBaseBlock {
  id: string;
  title: string;
  subject: string;
  type: Plan['type'];
  startTime: string;
  endTime: string;
}

interface WeekTimelineBlock extends WeekTimelineBaseBlock {
  lane: number;
  laneCount: number;
}

const WEEK_TIMELINE_HOURS = Array.from({ length: 25 }, (_, hour) => hour);

function buildWeekTimelineLanes<T extends WeekTimelineBaseBlock>(
  items: T[],
): Array<T & WeekTimelineBlock> {
  const sortedItems = [...items].sort((left, right) => {
    const startDelta =
      minutesFromTime(left.startTime) - minutesFromTime(right.startTime);

    if (startDelta !== 0) {
      return startDelta;
    }

    return minutesFromTime(left.endTime) - minutesFromTime(right.endTime);
  });

  const activeLanes: Array<{ lane: number; endMinutes: number }> = [];
  const laneById = new Map<string, number>();
  let laneCount = 0;

  sortedItems.forEach((item) => {
    const startMinutes = minutesFromTime(item.startTime);
    const endMinutes = Math.max(
      startMinutes + minutesBetween(item.startTime, item.endTime),
      startMinutes + 1,
    );

    for (let index = activeLanes.length - 1; index >= 0; index -= 1) {
      if (activeLanes[index].endMinutes <= startMinutes) {
        activeLanes.splice(index, 1);
      }
    }

    const usedLanes = new Set(activeLanes.map((entry) => entry.lane));
    let lane = 0;

    while (usedLanes.has(lane)) {
      lane += 1;
    }

    laneCount = Math.max(laneCount, lane + 1);
    laneById.set(item.id, lane);
    activeLanes.push({ lane, endMinutes });
  });

  return sortedItems.map((item) => ({
    ...item,
    lane: laneById.get(item.id) ?? 0,
    laneCount,
  }));
}

function buildWeekTimelineBlockStyle(
  entry: WeekTimelineBlock,
  inset: 'normal' | 'actual-inset' = 'normal',
): CSSProperties {
  const laneWidth = 100 / Math.max(entry.laneCount, 1);
  const baseSidePadding = inset === 'actual-inset' ? 12 : 6;
  const sidePadding =
    entry.laneCount >= 3
      ? Math.max(3, Math.round(baseSidePadding * 0.5))
      : entry.laneCount >= 2
        ? Math.max(4, Math.round(baseSidePadding * 0.75))
        : baseSidePadding;
  const durationMinutes = minutesBetween(entry.startTime, entry.endTime);

  return {
    top: `calc(${minutesFromTime(entry.startTime)} * var(--week-timeline-hour-height) / 60)`,
    height: `max(calc(${durationMinutes} * var(--week-timeline-hour-height) / 60), var(--week-timeline-min-block-height))`,
    left: `calc(${entry.lane * laneWidth}% + ${sidePadding}px)`,
    width: `calc(${laneWidth}% - ${sidePadding * 2}px)`,
  };
}

function getWeekTimelineDensityClass(laneCount: number): string {
  if (laneCount >= 3) {
    return 'week-timeline-block--very-dense';
  }

  if (laneCount >= 2) {
    return 'week-timeline-block--dense';
  }

  return 'week-timeline-block--single';
}

function shouldShowWeekTimelineSubject(laneCount: number): boolean {
  return laneCount <= 1;
}

function resolveActualTitle(actual: Actual, plan?: Plan): string {
  return actual.title?.trim() || plan?.title || '実績';
}

function resolveActualSubject(actual: Actual, plan?: Plan): string {
  return actual.subject.trim() || plan?.subject || '実績';
}

export function WeekView({
  selectedDate,
  plans,
  actuals,
  onChangeWeek,
  onOpenDay,
}: WeekViewProps) {
  const [timelineMode, setTimelineMode] = useState<WeekTimelineMode>('plan');
  const weekDates = getWeekDates(selectedDate);
  const weekRangeLabel = `${formatDateLabel(weekDates[0])} - ${formatDateLabel(weekDates[6])}`;
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const actualByOccurrenceKey = new Map(
    actuals.map((actual) => [getActualOccurrenceKey(actual), actual]),
  );
  const swipeNavigation = useSwipeNavigation({
    onPrevious: () => onChangeWeek(addDays(selectedDate, -7)),
    onNext: () => onChangeWeek(addDays(selectedDate, 7)),
  });

  return (
    <section className="panel swipe-view" {...swipeNavigation}>
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
          <p className="print-hide">7日分を同じ24時間軸で並べ、予定・実績・差分を切り替えて確認します。</p>
        </div>
      </div>

      <div className="week-timeline-toolbar print-hide">
        <div className="segmented-control week-timeline-mode-control">
          {(
            [
              ['plan', '予定'],
              ['actual', '実績'],
              ['compare', '比較'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              className={timelineMode === mode ? 'segment active' : 'segment'}
              onClick={() => setTimelineMode(mode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="week-timeline-legend">
          <span className="week-timeline-legend-item">
            <span className="week-timeline-legend-plan" />
            予定
          </span>
          <span className="week-timeline-legend-item">
            <span className="week-timeline-legend-actual" />
            実績
          </span>
        </div>
      </div>

      <div className="week-timeline-shell">
        <div className="week-timeline-hours" aria-hidden="true">
          <div className="week-timeline-corner" />
          {WEEK_TIMELINE_HOURS.map((hour) => (
            <div
              key={hour}
              className="week-timeline-hour-label"
              style={{ height: 'var(--week-timeline-hour-height)' }}
            >
              {hour.toString().padStart(2, '0')}:00
            </div>
          ))}
        </div>

        <div className="week-timeline-days">
        {weekDates.map((date) => {
          const dayPlans = sortByDateTime(expandPlansForDate(plans, date));
          const dayPlanKeys = new Set(
            dayPlans.map((plan) => buildPlanOccurrenceKey(plan.id, plan.date)),
          );
          const linkedActuals = dayPlans.flatMap((plan) => {
            const actual = actualByOccurrenceKey.get(
              buildPlanOccurrenceKey(plan.id, plan.date),
            );

            return actual ? [{ actual, plan }] : [];
          });
          const standaloneActuals = actuals
            .filter(
              (actual) =>
                actual.occurrenceDate === date &&
                !dayPlanKeys.has(getActualOccurrenceKey(actual)),
            )
            .map((actual) => ({ actual, plan: planById.get(actual.planId) }));
          const dayActuals = [...linkedActuals, ...standaloneActuals].sort(
            (left, right) =>
              minutesFromTime(left.actual.actualStartTime) -
              minutesFromTime(right.actual.actualStartTime),
          );
          const dayPlanMinutes = dayPlans.reduce(
            (sum, plan) => sum + minutesBetween(plan.startTime, plan.endTime),
            0,
          );
          const dayActualMinutes = dayActuals.reduce(
            (sum, { actual }) =>
              sum + minutesBetween(actual.actualStartTime, actual.actualEndTime),
            0,
          );
          const planBlocks = buildWeekTimelineLanes(
            dayPlans.map((plan) => ({
              id: buildPlanOccurrenceKey(plan.id, plan.date),
              title: plan.title,
              subject: plan.subject,
              type: plan.type,
              startTime: plan.startTime,
              endTime: plan.endTime,
            })),
          );
          const actualBlocks = buildWeekTimelineLanes(
            dayActuals.map(({ actual, plan }) => ({
              id: actual.id,
              title: resolveActualTitle(actual, plan),
              subject: resolveActualSubject(actual, plan),
              type: plan?.type ?? 'other',
              startTime: actual.actualStartTime,
              endTime: actual.actualEndTime,
            })),
          );
          const hasVisibleBlocks =
            timelineMode === 'plan'
              ? planBlocks.length > 0
              : timelineMode === 'actual'
                ? actualBlocks.length > 0
                : planBlocks.length > 0 || actualBlocks.length > 0;

          return (
            <article key={date} className="week-timeline-day">
              <div className="week-timeline-day-head">
                  <button
                    className="week-day-link"
                    onClick={() => onOpenDay(date)}
                    type="button"
                  >
                    {formatDateLabel(date)}
                  </button>
                  <p className="week-day-summary">
                    <span className="week-day-summary-item">
                      <span className="week-day-summary-label-full">計画</span>
                      <span className="week-day-summary-label-short">計</span>{' '}
                      <strong>{formatMinutes(dayPlanMinutes)}</strong>
                    </span>
                    <span className="week-day-summary-separator">/</span>
                    <span className="week-day-summary-item">
                      <span className="week-day-summary-label-full">実績</span>
                      <span className="week-day-summary-label-short">実</span>{' '}
                      <strong>{formatMinutes(dayActualMinutes)}</strong>
                    </span>
                  </p>
              </div>

              <div
                className={`week-timeline-canvas mode-${timelineMode}`}
                style={{ height: 'calc(24 * var(--week-timeline-hour-height))' }}
                onDoubleClick={() => onOpenDay(date)}
              >
                {Array.from({ length: 24 }, (_, index) => (
                  <div
                    key={index}
                    className="week-timeline-grid-line"
                    style={{ top: `calc(${index} * var(--week-timeline-hour-height))` }}
                  />
                ))}

                {(timelineMode === 'plan' || timelineMode === 'compare') &&
                  planBlocks.map((entry) => {
                    const subjectLabel = getSubjectLabel(entry.subject, entry.type);

                    return (
                      <button
                        key={`plan-${entry.id}`}
                        className={`week-timeline-block week-timeline-plan-block ${getWeekTimelineDensityClass(entry.laneCount)}`}
                        style={buildWeekTimelineBlockStyle(entry)}
                        onClick={() => onOpenDay(date)}
                        title={`${entry.title} / ${entry.startTime} - ${entry.endTime}`}
                        type="button"
                      >
                        <span className="week-timeline-entry-line">
                          <strong className="week-timeline-block__title">
                            {entry.title}
                          </strong>
                          <span className="week-timeline-time">
                            {entry.startTime}-{entry.endTime}
                          </span>
                          {shouldShowWeekTimelineSubject(entry.laneCount) ? (
                            <span className="week-timeline-subject">{subjectLabel}</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}

                {(timelineMode === 'actual' || timelineMode === 'compare') &&
                  actualBlocks.map((entry) => {
                    const theme = getSubjectTheme(entry.subject, entry.type);
                    const subjectLabel = getSubjectLabel(entry.subject, entry.type);

                    return (
                      <button
                        key={`actual-${entry.id}`}
                        className={`week-timeline-block week-timeline-actual-block ${getWeekTimelineDensityClass(entry.laneCount)}`}
                        style={{
                          ...buildWeekTimelineBlockStyle(
                            entry,
                            timelineMode === 'compare' ? 'actual-inset' : 'normal',
                          ),
                          backgroundColor: theme.soft,
                          borderColor: theme.border,
                          color: theme.text,
                          boxShadow:
                            timelineMode === 'compare'
                              ? `inset 5px 0 0 ${theme.fill}, 0 10px 18px rgba(24, 42, 39, 0.1)`
                              : `inset 4px 0 0 ${theme.fill}`,
                        }}
                        onClick={() => onOpenDay(date)}
                        title={`${entry.title} / ${entry.startTime} - ${entry.endTime}`}
                        type="button"
                      >
                        <span className="week-timeline-entry-line">
                          <strong className="week-timeline-block__title">
                            {entry.title}
                          </strong>
                          <span className="week-timeline-time">
                            {entry.startTime}-{entry.endTime}
                          </span>
                          {shouldShowWeekTimelineSubject(entry.laneCount) ? (
                            <span className="week-timeline-subject">{subjectLabel}</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}

                {!hasVisibleBlocks ? (
                  <p className="week-timeline-empty">
                    {timelineMode === 'actual' ? '実績なし' : '予定なし'}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
        </div>
      </div>
    </section>
  );
}
