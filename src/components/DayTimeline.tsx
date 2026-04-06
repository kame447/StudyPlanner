import type { CSSProperties } from 'react';
import { formatMinutes, minutesBetween, minutesFromTime } from '../lib/date';
import { getSubjectLabel, getSubjectTheme } from '../lib/subjectTheme';
import type { Actual, Plan } from '../types/domain';

interface DayTimelineProps {
  plans: Plan[];
  actuals: Actual[];
}

interface TimelineItem {
  plan: Plan;
  actual?: Actual;
  lane: number;
  laneCount: number;
}

const HOUR_HEIGHT = 54;
const DAY_HOURS = Array.from({ length: 25 }, (_, hour) => hour);

function groupOverlappingPlans(plans: Plan[]): Plan[][] {
  const groups: Plan[][] = [];
  let currentGroup: Plan[] = [];
  let currentGroupEnd = -1;

  plans.forEach((plan) => {
    const start = minutesFromTime(plan.startTime);
    const end = minutesFromTime(plan.endTime);

    if (currentGroup.length === 0) {
      currentGroup = [plan];
      currentGroupEnd = end;
      return;
    }

    if (start < currentGroupEnd) {
      currentGroup.push(plan);
      currentGroupEnd = Math.max(currentGroupEnd, end);
      return;
    }

    groups.push(currentGroup);
    currentGroup = [plan];
    currentGroupEnd = end;
  });

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function buildTimelineItems(plans: Plan[], actuals: Actual[]): TimelineItem[] {
  const sortedPlans = [...plans].sort((left, right) => {
    const startDelta =
      minutesFromTime(left.startTime) - minutesFromTime(right.startTime);

    if (startDelta !== 0) {
      return startDelta;
    }

    return minutesFromTime(left.endTime) - minutesFromTime(right.endTime);
  });
  const actualByPlanId = new Map(actuals.map((actual) => [actual.planId, actual]));

  return groupOverlappingPlans(sortedPlans).flatMap((group) => {
    const activeLanes: Array<{ lane: number; end: number }> = [];
    const laneByPlanId = new Map<string, number>();
    let laneCount = 0;

    group.forEach((plan) => {
      const start = minutesFromTime(plan.startTime);

      for (let index = activeLanes.length - 1; index >= 0; index -= 1) {
        if (activeLanes[index].end <= start) {
          activeLanes.splice(index, 1);
        }
      }

      const usedLanes = new Set(activeLanes.map((item) => item.lane));
      let lane = 0;

      while (usedLanes.has(lane)) {
        lane += 1;
      }

      laneCount = Math.max(laneCount, lane + 1);
      laneByPlanId.set(plan.id, lane);
      activeLanes.push({
        lane,
        end: minutesFromTime(plan.endTime),
      });
    });

    return group.map((plan) => ({
      plan,
      actual: actualByPlanId.get(plan.id),
      lane: laneByPlanId.get(plan.id) ?? 0,
      laneCount,
    }));
  });
}

function buildBlockStyle(
  topMinutes: number,
  durationMinutes: number,
  lane: number,
  laneCount: number,
  inset: number,
  rightInset: number,
): CSSProperties {
  const laneWidth = 100 / laneCount;

  return {
    top: `${(topMinutes / 60) * HOUR_HEIGHT}px`,
    height: `${Math.max((durationMinutes / 60) * HOUR_HEIGHT, 34)}px`,
    left: `calc(${lane * laneWidth}% + ${inset}px)`,
    width: `calc(${laneWidth}% - ${inset + rightInset}px)`,
  };
}

export function DayTimeline({ plans, actuals }: DayTimelineProps) {
  const timelineItems = buildTimelineItems(plans, actuals);
  const legendMap = new Map<string, string>();

  timelineItems.forEach((item) => {
    const label = getSubjectLabel(item.actual?.subject || item.plan.subject, item.plan.type);
    legendMap.set(label, getSubjectTheme(label, item.plan.type).fill);
  });

  return (
    <section className="panel section-stack">
      <div className="section-header">
        <div>
          <h2>24時間スケジュール</h2>
          <p>灰色の予定の上に、科目色の実績を重ねて比較します。</p>
        </div>
        <div className="timeline-legend">
          <span className="timeline-legend-item">
            <span className="timeline-legend-plan" />
            予定
          </span>
          <span className="timeline-legend-item">
            <span className="timeline-legend-actual" />
            実績
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

      {timelineItems.length === 0 ? (
        <p className="empty-copy">
          この日の予定はありません。追加すると時間軸に並びます。
        </p>
      ) : (
        <div className="timeline-shell">
          <div className="timeline-hours">
            {DAY_HOURS.map((hour) => (
              <div
                key={hour}
                className="timeline-hour-label"
                style={{ height: `${HOUR_HEIGHT}px` }}
              >
                {hour.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>

          <div
            className="timeline-canvas"
            style={{ height: `${24 * HOUR_HEIGHT}px` }}
          >
            {Array.from({ length: 24 }, (_, index) => (
              <div
                key={index}
                className="timeline-grid-line"
                style={{ top: `${index * HOUR_HEIGHT}px` }}
              />
            ))}

            {timelineItems.map((item) => {
              const planDuration = minutesBetween(
                item.plan.startTime,
                item.plan.endTime,
              );
              const actualDuration = item.actual
                ? minutesBetween(
                    item.actual.actualStartTime,
                    item.actual.actualEndTime,
                  )
                : 0;
              const theme = getSubjectTheme(
                item.actual?.subject || item.plan.subject,
                item.plan.type,
              );
              const planStyle = buildBlockStyle(
                minutesFromTime(item.plan.startTime),
                planDuration,
                item.lane,
                item.laneCount,
                6,
                10,
              );
              const actualStyle = item.actual
                ? buildBlockStyle(
                    minutesFromTime(item.actual.actualStartTime),
                    actualDuration,
                    item.lane,
                    item.laneCount,
                    16,
                    20,
                  )
                : undefined;

              return (
                <div key={item.plan.id}>
                  <article className="timeline-plan-block" style={planStyle}>
                    <span className="timeline-chip neutral">予定</span>
                    <strong>{item.plan.title}</strong>
                    <p>
                      {item.plan.startTime} - {item.plan.endTime}
                    </p>
                  </article>

                  {item.actual && actualStyle ? (
                    <article
                      className="timeline-actual-block"
                      style={{
                        ...actualStyle,
                        backgroundColor: theme.soft,
                        borderColor: theme.border,
                        color: theme.text,
                        boxShadow: `inset 5px 0 0 ${theme.fill}`,
                      }}
                    >
                      <span
                        className="timeline-chip"
                        style={{
                          backgroundColor: theme.fill,
                          color: '#fff',
                        }}
                      >
                        実績
                      </span>
                      <strong>{item.actual.subject || item.plan.subject || item.plan.title}</strong>
                      <p>
                        {item.actual.actualStartTime} - {item.actual.actualEndTime} /{' '}
                        {formatMinutes(actualDuration)}
                      </p>
                    </article>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
