import type { CSSProperties } from "react";
import type { ScheduleOccurrence } from "../domain/scheduleOccurrence";
import { supportsScopedRecurringPlanEdits } from "../domain/recurringPlan";
import { minutesBetween, minutesFromTime } from "../lib/date";
import {
  resolveActualAlignedToPlan,
  resolveActualSubject,
  resolveActualTitle,
} from "../lib/actualDrafts";
import { layoutTimelineEntries } from "../lib/dayTimelineLayout";
import {
  buildPlanOccurrenceKey,
  getActualOccurrenceKey,
} from "../lib/planRecurrence";
import { isScheduleOccurrenceOutsideHourlyGrid } from "../lib/scheduleOccurrencePresentation";
import { getSubjectLabel, getSubjectTheme } from "../lib/subjectTheme";
import type { WeekPlanMoveTarget } from "../lib/weekPlanDrag";
import { useTimelineDragController } from "../hooks/useTimelineDragController";
import { useUndoRedoHistory } from "../hooks/useUndoRedoHistory";
import type { WeeklyPlanDraftBlock } from "../features/weeklyPlanning/types";
import type {
  Actual,
  MonthEvent,
  Plan,
  PlanSourceType,
  PlanType,
} from "../types/domain";
import { DragUndoRedoControls } from "./DragUndoRedoControls";
import { TimelineDragOverlay } from "./TimelineDragOverlay";

interface DayTimelineProps {
  dateLabel: string;
  plans: Plan[];
  monthEvents: MonthEvent[];
  scheduleOccurrences: ScheduleOccurrence[];
  actuals: Actual[];
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  onMovePlan?: (plan: Plan, target: WeekPlanMoveTarget) => Promise<void>;
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
  plan?: Plan;
  occurrence?: ScheduleOccurrence;
}

const HOUR_HEIGHT = 54;
const MIN_BLOCK_HEIGHT = 34;
const DAY_HOURS = Array.from({ length: 25 }, (_, hour) => hour);

function buildTimelineEntries<
  T extends Omit<TimelineEntry, "lane" | "laneCount">
>(items: T[]): Array<TimelineEntry & T> {
  return layoutTimelineEntries(items, {
    hourHeight: HOUR_HEIGHT,
    minBlockHeight: MIN_BLOCK_HEIGHT,
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

function getTimelineDensityClass(
  startTime: string,
  endTime: string,
  laneCount: number
): string {
  const durationMinutes = minutesBetween(startTime, endTime);
  const classes: string[] = [];

  if (laneCount >= 3) {
    classes.push("is-narrow");
  } else if (laneCount >= 2) {
    classes.push("is-compact");
  }

  if (durationMinutes <= 15) {
    classes.push("is-micro");
  } else if (durationMinutes <= 30) {
    classes.push("is-tiny");
  } else if (durationMinutes <= 45) {
    classes.push("is-short");
  }

  return classes.join(" ");
}

function planTypeForOccurrence(occurrence: ScheduleOccurrence): PlanType {
  if (occurrence.category === "study") return "study";
  if (occurrence.category === "exam") return "mock-exam";
  if (occurrence.category === "school" || occurrence.category === "class") return "school-event";
  if (occurrence.category === "cram-school") return "cram-school";
  if (occurrence.category === "deadline") return "deadline";
  return "other";
}

export function DayTimeline({
  dateLabel,
  plans,
  monthEvents,
  scheduleOccurrences,
  actuals,
  weeklyDraftBlocks = [],
  onRemoveWeeklyDraftBlock,
  onMovePlan,
  selectedEntryId,
  onSelectEntry,
  onPreviousDay,
  onNextDay,
  onPrint,
  onImportTimetable,
  timetableImportCount = 0,
}: DayTimelineProps) {
  const moveHistory = useUndoRedoHistory<Plan, WeekPlanMoveTarget>();
  const dragController = useTimelineDragController<Plan>({
    onCommit: async (descriptor, before, after) => {
      if (!onMovePlan) return;
      const currentPlan = plans.find((plan) => plan.id === descriptor.item.id) ?? descriptor.item;
      const isScopedRecurring = supportsScopedRecurringPlanEdits(currentPlan);
      await onMovePlan(currentPlan, after);
      if (!isScopedRecurring) {
        moveHistory.record({
          key: currentPlan,
          before,
          after,
        });
      }
    },
    deferTouchDragUntilMoveAfterLongPress: true,
  });
  const occurrenceByPlanId = new Map(
    scheduleOccurrences
      .filter((occurrence) => occurrence.source.backingKind === "plan")
      .map((occurrence) => [occurrence.source.backingId, occurrence])
  );
  const occurrenceByMonthEventId = new Map(
    scheduleOccurrences
      .filter((occurrence) => occurrence.source.backingKind === "month-event")
      .map((occurrence) => [occurrence.source.backingId, occurrence])
  );
  const spanningOccurrences = scheduleOccurrences.filter(
    isScheduleOccurrenceOutsideHourlyGrid
  );
  const actualByOccurrenceKey = new Map(
    actuals.map((actual) => [getActualOccurrenceKey(actual), actual])
  );
  const planEntries = buildTimelineEntries([
    ...plans.flatMap((plan) => {
      const occurrence = occurrenceByPlanId.get(plan.id);
      if (occurrence && isScheduleOccurrenceOutsideHourlyGrid(occurrence)) return [];
      return [{
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
        plan,
        occurrence,
      }];
    }),
    ...monthEvents.flatMap((monthEvent) => {
      const occurrence = occurrenceByMonthEventId.get(monthEvent.id);
      if (occurrence && isScheduleOccurrenceOutsideHourlyGrid(occurrence)) return [];
      return [{
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
        occurrence,
      }];
    }),
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
            title: resolveActualTitle(plan, actual),
            subject: resolveActualSubject(plan, actual),
            type: plan.type,
            sourceType: plan.sourceType,
            startTime: actual.actualStartTime,
            endTime: actual.actualEndTime,
            alignedToPlan: resolveActualAlignedToPlan(plan, actual),
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
  spanningOccurrences.forEach((occurrence) => {
    const type = planTypeForOccurrence(occurrence);
    const label = getSubjectLabel(occurrence.subject, type, occurrence.planSourceType);
    legendMap.set(label, getSubjectTheme(label, type, occurrence.planSourceType).fill);
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

  function applyHistoryTarget(historyPlan: Plan, target: WeekPlanMoveTarget) {
    const currentPlan = plans.find((plan) => plan.id === historyPlan.id) ?? historyPlan;
    if (!onMovePlan) {
      return Promise.reject(new Error("移動対象の予定を確認できませんでした。"));
    }
    return onMovePlan(currentPlan, target);
  }

  function handleUndoMove() {
    void moveHistory
      .undo((entry, target) => applyHistoryTarget(entry.key, target))
      .catch(() => undefined);
  }

  function handleRedoMove() {
    void moveHistory
      .redo((entry, target) => applyHistoryTarget(entry.key, target))
      .catch(() => undefined);
  }

  return (
    <>
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
        actualEntries.length === 0 &&
        spanningOccurrences.length === 0 ? (
          <>
            <p className="empty-copy">
              この日の予定はありません。追加すると時間軸に並びます。
            </p>
            {timelineLegend}
          </>
        ) : (
          <>
            {spanningOccurrences.length > 0 ? (
              <div
                data-day-spanning-events="true"
                style={{
                  display: "grid",
                  gridTemplateColumns: "52px minmax(0, 1fr)",
                  alignItems: "start",
                  gap: "6px",
                  padding: "6px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  background: "var(--surface)",
                }}
              >
                <span
                  style={{
                    paddingTop: "5px",
                    color: "var(--text-muted)",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                  }}
                >
                  終日
                </span>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "4px",
                    minWidth: 0,
                  }}
                >
                  {spanningOccurrences.map((occurrence) => {
                    const type = planTypeForOccurrence(occurrence);
                    const theme = getSubjectTheme(
                      occurrence.subject,
                      type,
                      occurrence.planSourceType
                    );
                    const entryKind = occurrence.source.backingKind === "plan"
                      ? "plan"
                      : "month-event";
                    return (
                      <button
                        key={occurrence.id}
                        data-schedule-occurrence-id={occurrence.id}
                        data-day-spanning-event="true"
                        type="button"
                        title={`${occurrence.title} / ${occurrence.start.date} ${occurrence.start.time} - ${occurrence.end.date} ${occurrence.end.time}`}
                        aria-label={`${occurrence.title}。終日または日を跨ぐ予定。長押しで操作`}
                        onClick={() =>
                          onSelectEntry({
                            kind: entryKind,
                            id: occurrence.source.backingId,
                          })
                        }
                        onContextMenu={(event) => event.preventDefault()}
                        style={{
                          minWidth: 0,
                          maxWidth: "100%",
                          padding: "5px 9px",
                          overflow: "hidden",
                          border: `1px solid ${theme.border}`,
                          borderRadius: "8px",
                          background: theme.soft,
                          color: theme.text,
                          font: "inherit",
                          fontSize: "0.72rem",
                          fontWeight: 750,
                          lineHeight: 1.2,
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                        }}
                      >
                        {occurrence.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

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
                    const showSubjectLabel = subjectLabel.trim() !== entry.title.trim();
                    const draggablePlan = entry.plan && onMovePlan ? entry.plan : null;
                    const dragDescriptor = draggablePlan
                      ? {
                          key: entry.id,
                          item: draggablePlan,
                          title: entry.title,
                          original: {
                            date: draggablePlan.occurrenceDate ?? draggablePlan.date,
                            startTime: entry.startTime,
                            endTime: entry.endTime,
                          },
                          dates: [draggablePlan.occurrenceDate ?? draggablePlan.date],
                          allowDateChange: false,
                          dayColumnSelector: ".timeline-canvas.split",
                        }
                      : null;

                    return (
                      <button
                        key={entry.id}
                        className={[
                          "timeline-plan-block split",
                          draggablePlan ? "schedule-week-plan-button" : "",
                          dragController.isDragging(entry.id) ? "is-drag-source" : "",
                          selectedEntryId === entry.selectionId ? "is-selected" : "",
                          getTimelineDensityClass(
                            entry.startTime,
                            entry.endTime,
                            entry.laneCount
                          ),
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-schedule-occurrence-id={entry.occurrence?.id}
                        style={buildColumnBlockStyle(
                          minutesFromTime(entry.startTime),
                          duration,
                          entry.lane,
                          entry.laneCount,
                          "plan"
                        )}
                        onClick={(event) => {
                          if (dragDescriptor && dragController.shouldSuppressClick()) {
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                          }
                          onSelectEntry(
                            entry.entryKind === "plan"
                              ? { kind: "plan", id: entry.targetId }
                              : { kind: "month-event", id: entry.targetId }
                          );
                        }}
                        onPointerDown={
                          dragDescriptor
                            ? (event) => dragController.handlePointerDown(event, dragDescriptor)
                            : undefined
                        }
                        onPointerMove={dragDescriptor ? dragController.handlePointerMove : undefined}
                        onPointerUp={dragDescriptor ? dragController.handlePointerUp : undefined}
                        onPointerCancel={dragDescriptor ? dragController.handlePointerCancel : undefined}
                        onTouchStart={
                          dragDescriptor
                            ? (event) => dragController.handleTouchStart(event, dragDescriptor)
                            : undefined
                        }
                        onTouchMove={dragDescriptor ? dragController.handleTouchMove : undefined}
                        onTouchEnd={dragDescriptor ? dragController.handleTouchEnd : undefined}
                        onTouchCancel={dragDescriptor ? dragController.handleTouchCancel : undefined}
                        onContextMenu={
                          entry.occurrence || dragDescriptor
                            ? (event) => event.preventDefault()
                            : undefined
                        }
                        title={[entry.title, entry.startTime + "-" + entry.endTime, subjectLabel].join(" / ")}
                        aria-label={entry.title + "、" + entry.startTime + "から" + entry.endTime + "、" + subjectLabel + (entry.occurrence ? "。長押しで操作" : "") + (draggablePlan ? "、長押しして動かすと移動" : "")}
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
                          {showSubjectLabel ? (
                            <span
                              className="timeline-entry-subject"
                              style={{ color: theme.text }}
                              title={subjectLabel}
                            >
                              {subjectLabel}
                            </span>
                          ) : null}
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
                    const showSubjectLabel = subjectLabel.trim() !== entry.title.trim();

                    return (
                      <div
                        key={`draft-${entry.id}`}
                        className={[
                          "timeline-plan-block split timeline-draft-block",
                          getTimelineDensityClass(
                            entry.startTime,
                            entry.endTime,
                            entry.laneCount
                          ),
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={buildColumnBlockStyle(
                          minutesFromTime(entry.startTime),
                          duration,
                          entry.lane,
                          entry.laneCount,
                          "plan"
                        )}
                        title={[entry.title, entry.startTime + "-" + entry.endTime, subjectLabel, "仮予定"].join(" / ")}
                        role="group"
                        aria-label={entry.title + "、" + entry.startTime + "から" + entry.endTime + "、" + subjectLabel + "、仮予定"}
                      >
                        <div className="timeline-entry-line">
                          <strong
                            className="timeline-entry-title"
                            title={entry.title}
                          >
                            {entry.title}
                          </strong>
                          <span className="timeline-entry-meta-row">
                            <span className="timeline-entry-time">
                              {entry.startTime}-{entry.endTime}
                            </span>
                            <span className="weekly-draft-badge">仮予定</span>
                            {showSubjectLabel ? (
                              <span
                                className="timeline-entry-subject"
                                title={subjectLabel}
                              >
                                {subjectLabel}
                              </span>
                            ) : null}
                          </span>
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
                    const showSubjectLabel = subjectLabel.trim() !== entry.title.trim();

                    return (
                      <button
                        key={entry.id}
                        className={[
                          "timeline-actual-block split",
                          selectedEntryId === entry.selectionId ? "is-selected" : "",
                          getTimelineDensityClass(
                            entry.startTime,
                            entry.endTime,
                            entry.laneCount
                          ),
                        ]
                          .filter(Boolean)
                          .join(" ")}
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
                        title={[entry.title, entry.startTime + "-" + entry.endTime, subjectLabel].join(" / ")}
                        aria-label={entry.title + "、" + entry.startTime + "から" + entry.endTime + "、" + subjectLabel}
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
                          {showSubjectLabel ? (
                            <span
                              className="timeline-entry-subject"
                              title={subjectLabel}
                            >
                              {subjectLabel}
                            </span>
                          ) : null}
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
      <TimelineDragOverlay visual={dragController.dragVisual} />
      <DragUndoRedoControls
        visible={moveHistory.hasHistory}
        canUndo={moveHistory.canUndo}
        canRedo={moveHistory.canRedo}
        isBusy={moveHistory.isBusy}
        onUndo={handleUndoMove}
        onRedo={handleRedoMove}
      />
    </>
  );
}
