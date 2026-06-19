import type { CSSProperties } from "react";
import { minutesBetween, minutesFromTime } from "../lib/date";
import {
  buildPlanOccurrenceKey,
  getActualOccurrenceKey,
} from "../lib/planRecurrence";
import { getSubjectLabel, getSubjectTheme } from "../lib/subjectTheme";
import type { WeeklyPlanDraftBlock } from "../features/weeklyPlanning/types";
import type {
  Actual,
  MonthEvent,
  Plan,
  PlanSourceType,
  PlanType,
} from "../types/domain";

interface DayTimelineProps {
  dateLabel: string;
  plans: Plan[];
  monthEvents: MonthEvent[];
  actuals: Actual[];
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  selectedEntryId?: string;
  onSelectEntry: (entry: DayTimelineSelection) => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onPrint: () => void;
  onImportTimetable?: () => void;
  timetableImportCount?: number;
}

export type DayTimelineSelection =
  | { kind: "plan"; id: string }
  | { kind: "month-event"; id: string }
  | { kind: "standalone-actual"; id: string };

interface TimelineEntry {
  id: string;
  targetId: string;
  selectionId: string;
  entryKind: DayTimelineSelection["kind"];
  title: string;
  subject: string;
  type: PlanType;
  sourceType?: PlanSourceType;
  startTime: string;
  endTime: string;
  lane: number;
  laneCount: number;
  alignedToPlan?: boolean;
  standalone?: boolean;
}

const HOUR_HEIGHT = 54;
const MIN_BLOCK_HEIGHT = 34;
const DAY_HOURS = Array.from({ length: 25 }, (_, hour) => hour);

function getDisplayMetrics(startTime: string, endTime: string) {
  const topPx = (minutesFromTime(startTime) / 60) * HOUR_HEIGHT;
  const durationMinutes = minutesBetween(startTime, endTime);
  const heightPx = Math.max(
    (durationMinutes / 60) * HOUR_HEIGHT,
    MIN_BLOCK_HEIGHT
  );

  return {
    topPx,
    heightPx,
    bottomPx: topPx + heightPx,
  };
}

function buildTimelineEntries<
  T extends Omit<TimelineEntry, "lane" | "laneCount">
>(items: T[]): Array<TimelineEntry & T> {
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
      const { topPx, bottomPx } = getDisplayMetrics(
        item.startTime,
        item.endTime
      );

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
  column: "plan" | "actual"
): CSSProperties {
  const baseLeft = column === "plan" ? 0 : 50;
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
  if (typeof actual.isAlignedToPlan === "boolean") {
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
  weeklyDraftBlocks = [],
  onRemoveWeeklyDraftBlock,
  selectedEntryId,
  onSelectEntry,
  onPreviousDay,
  onNextDay,
  onPrint,
  onImportTimetable,
  timetableImportCount = 0,
}: DayTimelineProps) {
  const actualByOccurrenceKey = new Map(
    actuals.map((actual) => [getActualOccurrenceKey(actual), actual])
  );
  const planEntries = buildTimelineEntries([
    ...plans.map((plan) => ({
      id: buildPlanOccurrenceKey(plan.id, plan.date),
      targetId: plan.id,
      selectionId: `plan:${plan.id}`,
      entryKind: "plan" as const,
      title: plan.title,
      subject: plan.subject,
      type: plan.type,
      sourceType: plan.sourceType,
      startTime: plan.startTime,
      endTime: plan.endTime,
    })),
    ...monthEvents.map((monthEvent) => ({
      id: monthEvent.id,
      targetId: monthEvent.id,
      selectionId: `month-event:${monthEvent.id}`,
      entryKind: "month-event" as const,
      title: monthEvent.title,
      subject: "主要予定",
      type: "other" as const,
      sourceType: "manual" as const,
      startTime: monthEvent.startTime,
      endTime: monthEvent.endTime,
    })),
  ]);
  const draftEntries = buildTimelineEntries(
    weeklyDraftBlocks.map((block) => ({
      id: block.id,
      targetId: block.id,
      selectionId: `weekly-draft:${block.id}`,
      entryKind: "plan" as const,
      title: block.title,
      subject: block.subject || block.label,
      type: block.type,
      sourceType: undefined,
      startTime: block.startTime,
      endTime: block.endTime,
    }))
  );
  const actualEntries = buildTimelineEntries(
    [
      ...plans.flatMap((plan) => {
        const actual = actualByOccurrenceKey.get(
          buildPlanOccurrenceKey(plan.id, plan.date)
        );

        if (!actual) {
          return [];
        }

        return [
          {
            id: actual.id,
            targetId: plan.id,
            selectionId: `plan:${plan.id}`,
            entryKind: "plan" as const,
            title: resolveActualTitle(actual, plan),
            subject: resolveActualSubject(actual, plan),
            type: plan.type,
            sourceType: plan.sourceType,
            startTime: actual.actualStartTime,
            endTime: actual.actualEndTime,
            alignedToPlan: resolveAlignedToPlan(actual, plan),
          },
        ];
      }),
      ...monthEvents.flatMap((monthEvent) => {
        const actual = actuals.find((candidate) => candidate.planId === monthEvent.id);

        if (!actual) {
          return [];
        }

        return [
          {
            id: actual.id,
            targetId: monthEvent.id,
            selectionId: `month-event:${monthEvent.id}`,
            entryKind: "month-event" as const,
            title: actual.title?.trim() || monthEvent.title,
            subject: actual.subject.trim() || "主要予定",
            type: "other" as const,
            sourceType: "manual" as const,
            startTime: actual.actualStartTime,
            endTime: actual.actualEndTime,
            alignedToPlan: false,
          },
        ];
      }),
      ...actuals
        .filter((actual) => !actual.planId)
        .map((actual) => ({
          id: actual.id,
          targetId: actual.id,
          selectionId: `standalone-actual:${actual.id}`,
          entryKind: "standalone-actual" as const,
          title: actual.title?.trim() || "記録",
          subject: actual.subject.trim() || "記録",
          type: "study" as const,
          sourceType: "manual" as const,
          startTime: actual.actualStartTime,
          endTime: actual.actualEndTime,
          alignedToPlan: false,
          standalone: true,
        })),
    ]
  );
  const legendMap = new Map<string, string>();

  [...planEntries, ...draftEntries, ...actualEntries].forEach((entry) => {
    const label = getSubjectLabel(entry.subject, entry.type, entry.sourceType);
    legendMap.set(label, getSubjectTheme(label, entry.type, entry.sourceType).fill);
  });
  const timelineLegend = (
    <div className="timeline-legend">
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
  );

  return (
    <section className="panel section-stack">
      <header className="section-header day-timeline-header">
        <div className="day-timeline-header-main">
          <div className="day-timeline-title-copy">
            <h2>Daily</h2>
          </div>
          <div className="view-title-actions day-timeline-title-actions print-hide">
            <div className="nav-actions view-title-nav">
              <button
                className="ghost-button nav-icon-button"
                onClick={onPreviousDay}
                type="button"
                aria-label="前日"
              >
                <span aria-hidden="true">＜</span>
              </button>
              <span className="week-range-chip">{dateLabel}</span>
              <button
                className="ghost-button nav-icon-button"
                onClick={onNextDay}
                type="button"
                aria-label="翌日"
              >
                <span aria-hidden="true">＞</span>
              </button>
            </div>
          </div>
          {onImportTimetable ? (
            <button
              className="ghost-button view-print-button day-timetable-import-button print-hide"
              onClick={onImportTimetable}
              type="button"
              title="今日の時間割を反映"
            >
              時間割反映
              {timetableImportCount > 0 ? `（${timetableImportCount}）` : ''}
            </button>
          ) : null}
          <button
            className="ghost-button view-print-button day-timeline-print-button print-hide"
            onClick={onPrint}
            type="button"
          >
            印刷
          </button>
        </div>
      </header>

      {planEntries.length === 0 &&
      draftEntries.length === 0 &&
      actualEntries.length === 0 ? (
        <>
          <p className="empty-copy">
            この日の予定はありません。追加すると時間軸に並びます。
          </p>
          {timelineLegend}
        </>
      ) : (
        <>
          <div className="timeline-shell split">
            <div className="timeline-hours">
              {DAY_HOURS.map((hour) => (
                <div
                  key={hour}
                  className="timeline-hour-label"
                  style={{ height: "var(--timeline-hour-height)" }}
                >
                  {hour.toString().padStart(2, "0")}:00
                </div>
              ))}
            </div>

            <div className="timeline-main">
              <div className="timeline-columns-head">
                <div className="timeline-column-label">予定</div>
                <div className="timeline-column-label actual">記録</div>
              </div>

              <div
                className="timeline-canvas split"
                style={{ height: "calc(24 * var(--timeline-hour-height))" }}
              >
                {Array.from({ length: 24 }, (_, index) => (
                  <div
                    key={index}
                    className="timeline-grid-line"
                    style={{
                      top: `calc(${index} * var(--timeline-hour-height))`,
                    }}
                  />
                ))}

                <div className="timeline-divider" />

                {planEntries.map((entry) => {
                  const duration = minutesBetween(entry.startTime, entry.endTime);
                  const theme = getSubjectTheme(
                    entry.subject,
                    entry.type,
                    entry.sourceType
                  );
                  const subjectLabel = getSubjectLabel(
                    entry.subject,
                    entry.type,
                    entry.sourceType
                  );

                  return (
                    <button
                      key={entry.id}
                      className={
                        selectedEntryId === entry.selectionId
                          ? "timeline-plan-block split is-selected"
                          : "timeline-plan-block split"
                      }
                      style={buildColumnBlockStyle(
                        minutesFromTime(entry.startTime),
                        duration,
                        entry.lane,
                        entry.laneCount,
                        "plan"
                      )}
                      onClick={() =>
                        onSelectEntry(
                          entry.entryKind === "plan"
                            ? { kind: "plan", id: entry.targetId }
                            : { kind: "month-event", id: entry.targetId }
                        )
                      }
                      type="button"
                    >
                      <div className="timeline-entry-line">
                        <strong
                          className="timeline-entry-title"
                          title={entry.title}
                        >
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

                {draftEntries.map((entry) => {
                  const duration = minutesBetween(entry.startTime, entry.endTime);
                  const subjectLabel = getSubjectLabel(
                    entry.subject,
                    entry.type,
                    entry.sourceType
                  );

                  return (
                    <div
                      key={`draft-${entry.id}`}
                      className="timeline-plan-block split timeline-draft-block"
                      style={buildColumnBlockStyle(
                        minutesFromTime(entry.startTime),
                        duration,
                        entry.lane,
                        entry.laneCount,
                        "plan"
                      )}
                      title={`${entry.title} / ${entry.startTime}-${entry.endTime}`}
                    >
                      <div className="timeline-entry-line">
                        <strong
                          className="timeline-entry-title"
                          title={entry.title}
                        >
                          {entry.title}
                        </strong>
                        <span className="timeline-entry-time">
                          {entry.startTime}-{entry.endTime}
                        </span>
                        <span
                          className="timeline-entry-subject"
                          title={subjectLabel}
                        >
                          {subjectLabel}
                        </span>
                        <span className="weekly-draft-badge">AI提案</span>
                      </div>
                      {onRemoveWeeklyDraftBlock ? (
                        <button
                          className="weekly-draft-remove-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveWeeklyDraftBlock(entry.id);
                          }}
                          type="button"
                          aria-label={`${entry.title}を削除`}
                          title="仮予定を削除"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  );
                })}

                {actualEntries.map((entry) => {
                  const duration = minutesBetween(entry.startTime, entry.endTime);
                  const theme = getSubjectTheme(
                    entry.subject,
                    entry.type,
                    entry.sourceType
                  );
                  const subjectLabel = getSubjectLabel(
                    entry.subject,
                    entry.type,
                    entry.sourceType
                  );

                  return (
                    <button
                      key={entry.id}
                      className={
                        selectedEntryId === entry.selectionId
                          ? "timeline-actual-block split is-selected"
                          : "timeline-actual-block split"
                      }
                      style={{
                        ...buildColumnBlockStyle(
                          minutesFromTime(entry.startTime),
                          duration,
                          entry.lane,
                          entry.laneCount,
                          "actual"
                        ),
                        backgroundColor: theme.soft,
                        borderColor: theme.border,
                        color: theme.text,
                        boxShadow: `inset 5px 0 0 ${theme.fill}`,
                      }}
                      onClick={() =>
                        onSelectEntry(
                          entry.entryKind === "plan"
                            ? { kind: "plan", id: entry.targetId }
                            : entry.entryKind === "month-event"
                              ? { kind: "month-event", id: entry.targetId }
                              : { kind: "standalone-actual", id: entry.targetId }
                        )
                      }
                      type="button"
                    >
                      <div className="timeline-entry-line">
                        <strong
                          className="timeline-entry-title"
                          title={entry.title}
                        >
                          {entry.title}
                        </strong>
                        <span className="timeline-entry-time">
                          {entry.startTime}-{entry.endTime}
                        </span>
                        <span
                          className="timeline-entry-subject"
                          title={subjectLabel}
                        >
                          {subjectLabel}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {timelineLegend}
        </>
      )}
    </section>
  );
}
