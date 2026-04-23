import type { CSSProperties } from 'react';
import { minutesBetween, minutesFromTime } from '../lib/date';
import {
  buildPlanOccurrenceKey,
  getActualOccurrenceKey,
} from '../lib/planRecurrence';
import { getSubjectLabel, getSubjectTheme } from '../lib/subjectTheme';
import type { Actual, MonthEvent, Plan, PlanType } from '../types/domain';

interface DayTimelineProps {
  dateLabel: string;
  plans: Plan[];
  monthEvents: MonthEvent[];
  actuals: Actual[];
  selectedEntryId?: string;
  onSelectEntry: (entry: DayTimelineSelection) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onPrint: () => void;
}

export type DayTimelineSelection =
  | { kind: 'plan'; id: string }
  | { kind: 'month-event'; id: string };

interface TimelineEntry {
  id: string;
  targetId: string;
  selectionId: string;
  entryKind: DayTimelineSelection['kind'];
  title: string;
  subject: string;
  type: PlanType;
  startTime: string;
  endTime: string;
  lane: number;
  laneCount: number;
  alignedToPlan?: boolean;
}

const HOUR_HEIGHT = 54;
const MIN_BLOCK_HEIGHT = 34;
const DAY_HOURS = Array.from({ length: 25 }, (_, hour) => hour);

function getDisplayMetrics(startTime: string, endTime: string) {
  const topPx = (minutesFromTime(startTime) / 60) * HOUR_HEIGHT;
  const durationMinutes = minutesBetween(startTime, endTime);
  const heightPx = Math.max((durationMinutes / 60) * HOUR_HEIGHT, MIN_BLOCK_HEIGHT);

  return {
    topPx,
    heightPx,
    bottomPx: topPx + heightPx,
  };
}

function buildTimelineEntries<T extends Omit<TimelineEntry, 'lane' | 'laneCount'>>(
  items: T[],
): Array<TimelineEntry & T> {
  const sortedItems = [...items].sort((left, right) => {
    const startDelta =
      minutesFromTime(left.startTime) - minutesFromTime(right.startTime);

    if (startDelta !== 0) {
      return startDelta;
    }

    return minutesFromTime(left.endTime) - minutesFromTime(right.endTime);
  });

  const groups: T[][] = [];
  let currentGroup: T[] = [];
  let currentGroupDisplayEndPx = -1;

  sortedItems.forEach((item) => {
    const { topPx, bottomPx } = getDisplayMetrics(item.startTime, item.endTime);

    if (currentGroup.length === 0) {
      currentGroup = [item];
      currentGroupDisplayEndPx = bottomPx;
      return;
    }

    if (topPx < currentGroupDisplayEndPx) {
      currentGroup.push(item);
      currentGroupDisplayEndPx = Math.max(currentGroupDisplayEndPx, bottomPx);
      return;
    }

    groups.push(currentGroup);
    currentGroup = [item];
    currentGroupDisplayEndPx = bottomPx;
  });

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups.flatMap((group) => {
    const activeLanes: Array<{ lane: number; displayEndPx: number }> = [];
    const laneById = new Map<string, number>();
    let laneCount = 0;

    group.forEach((item) => {
      const { topPx, bottomPx } = getDisplayMetrics(item.startTime, item.endTime);

      for (let index = activeLanes.length - 1; index >= 0; index -= 1) {
        if (activeLanes[index].displayEndPx <= topPx) {
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
      activeLanes.push({
        lane,
        displayEndPx: bottomPx,
      });
    });

    return group.map((item) => ({
      ...item,
      lane: laneById.get(item.id) ?? 0,
      laneCount,
    }));
  });
}

function buildColumnBlockStyle(
  topMinutes: number,
  durationMinutes: number,
  lane: number,
  laneCount: number,
  column: 'plan' | 'actual',
): CSSProperties {
  const baseLeft = column === 'plan' ? 0 : 50;
  const columnWidth = 50;
  const laneWidth = columnWidth / Math.max(laneCount, 1);

  return {
    top: `calc(${topMinutes} * var(--timeline-hour-height) / 60)`,
    height: `max(calc(${durationMinutes} * var(--timeline-hour-height) / 60), var(--timeline-min-block-height))`,
    left: `calc(${baseLeft + lane * laneWidth}% + 8px)`,
    width: `calc(${laneWidth}% - 16px)`,
  };
}

function resolveActualTitle(actual: Actual, plan: Plan): string {
  const actualTitle = actual.title?.trim();
  return actualTitle || plan.title;
}

function resolveActualSubject(actual: Actual, plan: Plan): string {
  return actual.subject.trim() || plan.subject;
}

function resolveAlignedToPlan(actual: Actual, plan: Plan): boolean {
  if (typeof actual.isAlignedToPlan === 'boolean') {
    return actual.isAlignedToPlan;
  }

  return (
    resolveActualTitle(actual, plan) === plan.title &&
    resolveActualSubject(actual, plan) === plan.subject
  );
}

export function DayTimeline({
  dateLabel,
  plans,
  monthEvents,
  actuals,
  selectedEntryId,
  onSelectEntry,
  onPreviousDay,
  onNextDay,
  onPrint,
}: DayTimelineProps) {
  const actualByOccurrenceKey = new Map(
    actuals.map((actual) => [getActualOccurrenceKey(actual), actual]),
  );
  const planEntries = buildTimelineEntries(
    [
      ...plans.map((plan) => ({
        id: buildPlanOccurrenceKey(plan.id, plan.date),
        targetId: plan.id,
        selectionId: `plan:${plan.id}`,
        entryKind: 'plan' as const,
        title: plan.title,
        subject: plan.subject,
        type: plan.type,
        startTime: plan.startTime,
        endTime: plan.endTime,
      })),
      ...monthEvents.map((monthEvent) => ({
        id: monthEvent.id,
        targetId: monthEvent.id,
        selectionId: `month-event:${monthEvent.id}`,
        entryKind: 'month-event' as const,
        title: monthEvent.title,
        subject: '主要予定',
        type: 'other' as const,
        startTime: monthEvent.startTime,
        endTime: monthEvent.endTime,
      })),
    ],
  );
  const actualEntries = buildTimelineEntries(
    plans.flatMap((plan) => {
      const actual = actualByOccurrenceKey.get(buildPlanOccurrenceKey(plan.id, plan.date));

      if (!actual) {
        return [];
      }

      return [
        {
          id: actual.id,
          targetId: plan.id,
          selectionId: `plan:${plan.id}`,
          entryKind: 'plan' as const,
          title: resolveActualTitle(actual, plan),
          subject: resolveActualSubject(actual, plan),
          type: plan.type,
          startTime: actual.actualStartTime,
          endTime: actual.actualEndTime,
          alignedToPlan: resolveAlignedToPlan(actual, plan),
        },
      ];
    }),
  );
  const legendMap = new Map<string, string>();

  [...planEntries, ...actualEntries].forEach((entry) => {
    const label = getSubjectLabel(entry.subject, entry.type);
    legendMap.set(label, getSubjectTheme(label, entry.type).fill);
  });

  return (
    <section className="panel section-stack">
      <div className="section-header day-timeline-header">
        <div className="day-timeline-header-main">
          <div className="day-timeline-title-copy">
            <h2>Daily</h2>
            <p className="print-hide">左に予定、右に実績を並べて、同じ時間軸で比較します。</p>
          </div>
          <div className="view-title-actions day-timeline-title-actions print-hide">
            <div className="nav-actions view-title-nav">
              <button className="ghost-button" onClick={onPreviousDay} type="button">
                前日
              </button>
              <span className="week-range-chip">{dateLabel}</span>
              <button className="ghost-button" onClick={onNextDay} type="button">
                翌日
              </button>
            </div>
            <button
              className="ghost-button view-print-button"
              onClick={onPrint}
              type="button"
            >
              印刷
            </button>
          </div>
        </div>
        <div className="timeline-legend">
          <span className="timeline-legend-item">
            <span className="timeline-legend-plan" />
            予定
          </span>
          {Array.from(legendMap.entries()).map(([label, color]) => (
            <span key={label} className="timeline-legend-item">
              <span
                className="timeline-legend-subject"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      {planEntries.length === 0 ? (
        <p className="empty-copy">
          この日の予定はありません。追加すると時間軸に並びます。
        </p>
      ) : (
        <div className="timeline-shell split">
          <div className="timeline-hours">
            {DAY_HOURS.map((hour) => (
              <div
                key={hour}
                className="timeline-hour-label"
                style={{ height: 'var(--timeline-hour-height)' }}
              >
                {hour.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>

          <div className="timeline-main">
            <div className="timeline-columns-head">
              <div className="timeline-column-label">予定</div>
              <div className="timeline-column-label actual">実績</div>
            </div>

            <div
              className="timeline-canvas split"
              style={{ height: 'calc(24 * var(--timeline-hour-height))' }}
            >
              {Array.from({ length: 24 }, (_, index) => (
                <div
                  key={index}
                  className="timeline-grid-line"
                  style={{ top: `calc(${index} * var(--timeline-hour-height))` }}
                />
              ))}

              <div className="timeline-divider" />

              {planEntries.map((entry) => {
                const duration = minutesBetween(entry.startTime, entry.endTime);
                const theme = getSubjectTheme(entry.subject, entry.type);
                const subjectLabel = getSubjectLabel(entry.subject, entry.type);

                return (
                  <button
                    key={entry.id}
                    className={
                      selectedEntryId === entry.selectionId
                        ? 'timeline-plan-block split is-selected'
                        : 'timeline-plan-block split'
                    }
                    style={buildColumnBlockStyle(
                      minutesFromTime(entry.startTime),
                      duration,
                      entry.lane,
                      entry.laneCount,
                      'plan',
                    )}
                    onClick={() =>
                      onSelectEntry(
                        entry.entryKind === 'plan'
                          ? { kind: 'plan', id: entry.targetId }
                          : { kind: 'month-event', id: entry.targetId },
                      )
                    }
                    type="button"
                  >
                    <div className="timeline-entry-line">
                      <strong className="timeline-entry-title" title={entry.title}>
                        {entry.title}
                      </strong>
                      <span className="timeline-entry-time">
                        {entry.startTime}-{entry.endTime}
                      </span>
                      <span
                        className="timeline-entry-subject"
                        style={{ color: theme.text }}
                        title={subjectLabel}
                      >
                        {subjectLabel}
                      </span>
                    </div>
                  </button>
                );
              })}

              {actualEntries.map((entry) => {
                const duration = minutesBetween(entry.startTime, entry.endTime);
                const theme = getSubjectTheme(entry.subject, entry.type);
                const subjectLabel = getSubjectLabel(entry.subject, entry.type);

                return (
                  <button
                    key={entry.id}
                    className={
                      selectedEntryId === entry.selectionId
                        ? 'timeline-actual-block split is-selected'
                        : 'timeline-actual-block split'
                    }
                    style={{
                      ...buildColumnBlockStyle(
                        minutesFromTime(entry.startTime),
                        duration,
                        entry.lane,
                        entry.laneCount,
                        'actual',
                      ),
                      backgroundColor: theme.soft,
                      borderColor: theme.border,
                      color: theme.text,
                      boxShadow: `inset 5px 0 0 ${theme.fill}`,
                    }}
                    onClick={() => onSelectEntry({ kind: 'plan', id: entry.targetId })}
                    type="button"
                  >
                    <div className="timeline-entry-line">
                      <strong className="timeline-entry-title" title={entry.title}>
                        {entry.title}
                      </strong>
                      <span className="timeline-entry-time">
                        {entry.startTime}-{entry.endTime}
                      </span>
                      <span className="timeline-entry-subject" title={subjectLabel}>
                        {subjectLabel}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
