import { useState, type CSSProperties } from 'react';
import {
  addDays,
  formatCompactMinutes,
  formatDateLabel,
  getWeekDates,
  minutesBetween,
  minutesFromTime,
  sortByDateTime,
} from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
} from '../lib/planRecurrence';
import {
  normalizeStudyRecordsForDisplay,
  sumStudyRecordMinutes,
} from '../lib/studyRecords';
import { resolveTimelineSubjectDisplay } from '../lib/timelineSubject';
import { WeekPickerDialog } from './DatePickerDialogs';
import type {
  Actual,
  Plan,
  PlanSourceType,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

interface WeekViewProps {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  studyMaterials: StudyMaterial[];
  studySubjects: StudySubject[];
  onChangeWeek: (date: string) => void;
  onOpenDay: (date: string) => void;
}

type WeekTimelineMode = 'plan' | 'actual' | 'compare';

interface WeekTimelineBaseBlock {
  id: string;
  title: string;
  subject: string;
  type: Plan['type'];
  sourceType?: PlanSourceType;
  materialId?: string | null;
  materialName?: string;
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

function getWeekTimelineDisplayClass(laneCount: number): string {
  if (laneCount >= 3) {
    return 'week-timeline-block--narrow';
  }

  if (laneCount >= 2) {
    return 'week-timeline-block--compact';
  }

  return 'week-timeline-block--wide';
}

export function WeekView({
  selectedDate,
  plans,
  actuals,
  studyMaterials,
  studySubjects,
  onChangeWeek,
  onOpenDay,
}: WeekViewProps) {
  const [timelineMode, setTimelineMode] = useState<WeekTimelineMode>('plan');
  const [isWeekPickerOpen, setIsWeekPickerOpen] = useState(false);
  const weekDates = getWeekDates(selectedDate);
  const weekRangeLabel = `${formatDateLabel(weekDates[0])} - ${formatDateLabel(weekDates[6])}`;
  const materialsById = new Map(studyMaterials.map((material) => [material.id, material]));
  const subjectsById = new Map(studySubjects.map((subject) => [subject.id, subject]));
  const subjectsByName = new Map(studySubjects.map((subject) => [subject.name.trim(), subject]));
  const weekActualRecords = normalizeStudyRecordsForDisplay({
    actuals,
    plans,
    materials: studyMaterials,
    subjects: studySubjects,
    startDate: weekDates[0],
    endDate: weekDates[6],
  });

  return (
    <section className="panel">
      <div className="view-header-stack">
        <div>
          <div className="view-titlebar">
            <h2>Weekly </h2>
            <div className="view-title-actions print-hide">
              <div className="nav-actions view-title-nav">
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => onChangeWeek(addDays(selectedDate, -7))}
                  type="button"
                  aria-label="前週"
                  title="前週"
                >
                  <span aria-hidden="true">＜</span>
                </button>
                <button
                  className="week-range-chip date-picker-trigger"
                  onClick={() => setIsWeekPickerOpen(true)}
                  type="button"
                  aria-label="週を選択"
                >
                  {weekRangeLabel}
                </button>
                <button
                  className="ghost-button nav-icon-button"
                  onClick={() => onChangeWeek(addDays(selectedDate, 7))}
                  type="button"
                  aria-label="翌週"
                  title="翌週"
                >
                  <span aria-hidden="true">＞</span>
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
        </div>
      </div>

      <WeekPickerDialog
        open={isWeekPickerOpen}
        selectedDate={selectedDate}
        onSelectWeek={onChangeWeek}
        onClose={() => setIsWeekPickerOpen(false)}
      />

      <div className="week-timeline-toolbar print-hide">
        <div className="segmented-control week-timeline-mode-control">
          {(
            [
              ['plan', '予定'],
              ['actual', '記録'],
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
            記録
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
          const dayActualRecords = weekActualRecords.filter(
            (record) => record.date === date,
          );
          const dayPlanMinutes = dayPlans.reduce(
            (sum, plan) => sum + minutesBetween(plan.startTime, plan.endTime),
            0,
          );
          const dayActualMinutes = sumStudyRecordMinutes(dayActualRecords);
          const planBlocks = buildWeekTimelineLanes(
            dayPlans.map((plan) => ({
              id: buildPlanOccurrenceKey(plan.id, plan.date),
              title: plan.title,
              subject: plan.subject,
              type: plan.type,
              sourceType: plan.sourceType,
              materialId: plan.materialId ?? null,
              materialName: plan.materialName,
              startTime: plan.startTime,
              endTime: plan.endTime,
            })),
          );
          const actualBlocks = buildWeekTimelineLanes(
            dayActualRecords.map((record) => ({
              id: record.actualId,
              title: record.title,
              subject: record.subject,
              type: record.type,
              sourceType: record.sourceType,
              materialId: record.materialId,
              materialName: record.materialName,
              startTime: record.startTime,
              endTime: record.endTime,
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
                      <span>目標</span>{' '}
                      <strong>{formatCompactMinutes(dayPlanMinutes)}</strong>
                    </span>
                    <span className="week-day-summary-item">
                      <span>記録</span>{' '}
                      <strong>{formatCompactMinutes(dayActualMinutes)}</strong>
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
                    const subject = resolveTimelineSubjectDisplay(entry, {
                      materialsById,
                      subjectsById,
                      subjectsByName,
                    });

                    return (
                      <button
                        key={`plan-${entry.id}`}
                        className={`week-timeline-block week-timeline-plan-block ${getWeekTimelineDisplayClass(entry.laneCount)}`}
                        style={buildWeekTimelineBlockStyle(entry)}
                        onClick={() => onOpenDay(date)}
                        title={`${entry.title} / ${entry.startTime} - ${entry.endTime}`}
                        type="button"
                      >
                        <span className="week-timeline-entry-line">
                          <strong className="week-timeline-block__title">
                            {entry.title}
                          </strong>
                          <span className="week-timeline-meta">
                            <span className="week-timeline-time">
                              {entry.startTime}-{entry.endTime}
                            </span>
                            <span
                              className="week-timeline-subject"
                              title={subject.label}
                            >
                              {subject.label}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}

                {(timelineMode === 'actual' || timelineMode === 'compare') &&
                  actualBlocks.map((entry) => {
                    const subject = resolveTimelineSubjectDisplay(entry, {
                      materialsById,
                      subjectsById,
                      subjectsByName,
                    });
                    const theme = subject.theme;

                    return (
                      <button
                        key={`actual-${entry.id}`}
                        className={`week-timeline-block week-timeline-actual-block ${getWeekTimelineDisplayClass(entry.laneCount)}`}
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
                          <span className="week-timeline-meta">
                            <span className="week-timeline-time">
                              {entry.startTime}-{entry.endTime}
                            </span>
                            <span
                              className="week-timeline-subject"
                              title={subject.label}
                            >
                              {subject.label}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}

                {!hasVisibleBlocks ? (
                  <p className="week-timeline-empty">
                    {timelineMode === 'actual' ? '記録なし' : '予定なし'}
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
