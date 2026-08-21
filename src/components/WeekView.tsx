import { useState, type CSSProperties } from 'react';
import {
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
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import type { Actual, Plan, PlanSourceType } from '../types/domain';

type WeekTimelineMode = 'plan' | 'actual';

interface WeekViewProps {
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  weeklyDraftBlocks?: WeeklyPlanDraftBlock[];
  onRemoveWeeklyDraftBlock?: (blockId: string) => void;
  onOpenDay: (date: string) => void;
}

interface WeekPreviewBaseBlock {
  id: string;
  title: string;
  subject: string;
  type: Plan['type'];
  sourceType?: PlanSourceType;
  startTime: string;
  endTime: string;
  draft?: boolean;
}

interface WeekPreviewBlock extends WeekPreviewBaseBlock {
  lane: number;
  laneCount: number;
}

const WEEK_HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function formatWeekDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  const weekday = WEEKDAY_LABELS[date.getDay()] ?? '';
  return `${date.getMonth() + 1}/${date.getDate()}(${weekday})`;
}

function resolveActualTitle(actual: Actual, plan?: Plan): string {
  return actual.title?.trim() || plan?.title || '記録';
}

function resolveActualSubject(actual: Actual, plan?: Plan): string {
  return actual.subject.trim() || plan?.subject || '記録';
}

function buildLanes<T extends WeekPreviewBaseBlock>(items: T[]): Array<T & WeekPreviewBlock> {
  const sorted = [...items].sort((left, right) => {
    const startDelta = minutesFromTime(left.startTime) - minutesFromTime(right.startTime);
    if (startDelta !== 0) return startDelta;
    return minutesFromTime(left.endTime) - minutesFromTime(right.endTime);
  });
  const active: Array<{ lane: number; endMinutes: number }> = [];
  const laneById = new Map<string, number>();
  let laneCount = 0;

  sorted.forEach((item) => {
    const startMinutes = minutesFromTime(item.startTime);
    const endMinutes = Math.max(
      startMinutes + minutesBetween(item.startTime, item.endTime),
      startMinutes + 1,
    );

    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].endMinutes <= startMinutes) active.splice(index, 1);
    }

    const used = new Set(active.map((entry) => entry.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;

    laneById.set(item.id, lane);
    laneCount = Math.max(laneCount, lane + 1);
    active.push({ lane, endMinutes });
  });

  return sorted.map((item) => ({
    ...item,
    lane: laneById.get(item.id) ?? 0,
    laneCount: Math.max(laneCount, 1),
  }));
}

function buildMarkerStyle(hour: number): CSSProperties {
  return {
    top: `calc(${hour * 6} * var(--weekly-draft-preview-ten-minute-height))`,
  };
}

function buildBlockStyle(entry: WeekPreviewBlock): CSSProperties {
  const startTenMinuteUnit = minutesFromTime(entry.startTime) / 10;
  const durationTenMinuteUnits = Math.max(
    minutesBetween(entry.startTime, entry.endTime) / 10,
    1,
  );
  const laneWidth = 100 / Math.max(entry.laneCount, 1);

  return {
    top: `calc(${startTenMinuteUnit} * var(--weekly-draft-preview-ten-minute-height))`,
    height: `max(calc(${durationTenMinuteUnits} * var(--weekly-draft-preview-ten-minute-height)), 18px)`,
    left: `calc(${entry.lane * laneWidth}% + 2px)`,
    width: `calc(${laneWidth}% - 4px)`,
    right: 'auto',
  };
}

function getToneClass(entry: WeekPreviewBaseBlock): string {
  const key = (entry.subject || entry.title || entry.id).trim();
  const toneIndex = Array.from(key || entry.id).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  ) % 8;
  return `weekly-draft-tone-${toneIndex + 1}`;
}

function getDurationClass(entry: WeekPreviewBaseBlock): string {
  const duration = minutesBetween(entry.startTime, entry.endTime);
  if (duration <= 20) return 'schedule-week-block-micro';
  if (duration <= 40) return 'schedule-week-block-short';
  return '';
}

export function WeekView({
  selectedDate,
  plans,
  actuals,
  weeklyDraftBlocks = [],
  onRemoveWeeklyDraftBlock,
  onOpenDay,
}: WeekViewProps) {
  const [timelineMode, setTimelineMode] = useState<WeekTimelineMode>('plan');
  const weekDates = getWeekDates(selectedDate);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const actualByOccurrenceKey = new Map(
    actuals.map((actual) => [getActualOccurrenceKey(actual), actual]),
  );
  const gridStyle = {
    gridTemplateColumns: '46px repeat(7, minmax(0, 1fr))',
  } as CSSProperties;
  const timelineStyle = {
    height: 'calc(144 * var(--weekly-draft-preview-ten-minute-height))',
  } as CSSProperties;

  return (
    <section className="panel schedule-week-view">
      <div className="week-timeline-toolbar print-hide">
        <div className="segmented-control week-timeline-mode-control">
          <button
            className={timelineMode === 'plan' ? 'segment active' : 'segment'}
            onClick={() => setTimelineMode('plan')}
            type="button"
          >
            予定
          </button>
          <button
            className={timelineMode === 'actual' ? 'segment active' : 'segment'}
            onClick={() => setTimelineMode('actual')}
            type="button"
          >
            記録
          </button>
        </div>
      </div>

      <div className="weekly-draft-preview schedule-week-preview">
        <div className="weekly-draft-preview-scroll schedule-week-preview-scroll">
          <div className="weekly-draft-preview-grid">
            <div className="weekly-draft-preview-header" style={gridStyle}>
              <div className="weekly-draft-preview-corner">時間</div>
              {weekDates.map((date) => (
                <button
                  className="weekly-draft-preview-date"
                  key={date}
                  onClick={() => onOpenDay(date)}
                  type="button"
                >
                  <strong>{formatWeekDate(date)}</strong>
                </button>
              ))}
            </div>

            <div className="weekly-draft-preview-body" style={gridStyle}>
              <div className="weekly-draft-preview-time-axis" style={timelineStyle} aria-hidden="true">
                {WEEK_HOURS.map((hour) => (
                  <span
                    className={[
                      'weekly-draft-preview-time-label',
                      hour === 0 ? 'weekly-draft-preview-time-label--start' : '',
                      hour === 24 ? 'weekly-draft-preview-time-label--end' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    key={hour}
                    style={buildMarkerStyle(hour)}
                  >
                    {String(hour).padStart(2, '0')}:00
                  </span>
                ))}
              </div>

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
                  .map((actual) => ({
                    actual,
                    plan: actual.planId ? planById.get(actual.planId) : undefined,
                  }));
                const dayActuals = [...linkedActuals, ...standaloneActuals].sort(
                  (left, right) =>
                    minutesFromTime(left.actual.actualStartTime) -
                    minutesFromTime(right.actual.actualStartTime),
                );
                const dayDraftBlocks = weeklyDraftBlocks.filter(
                  (block) => block.date === date && block.status === 'draft',
                );

                const planBlocks = buildLanes<WeekPreviewBaseBlock>([
                  ...dayPlans.map((plan) => ({
                    id: buildPlanOccurrenceKey(plan.id, plan.date),
                    title: plan.title,
                    subject: plan.subject,
                    type: plan.type,
                    sourceType: plan.sourceType,
                    startTime: plan.startTime,
                    endTime: plan.endTime,
                  })),
                  ...dayDraftBlocks.map((block) => ({
                    id: block.id,
                    title: block.title,
                    subject: block.subject || block.label,
                    type: block.type,
                    startTime: block.startTime,
                    endTime: block.endTime,
                    draft: true,
                  })),
                ]);
                const actualBlocks = buildLanes<WeekPreviewBaseBlock>(
                  dayActuals.map(({ actual, plan }) => ({
                    id: actual.id,
                    title: resolveActualTitle(actual, plan),
                    subject: resolveActualSubject(actual, plan),
                    type: plan?.type ?? 'other',
                    sourceType: plan?.sourceType,
                    startTime: actual.actualStartTime,
                    endTime: actual.actualEndTime,
                  })),
                );
                const visibleBlocks = timelineMode === 'plan' ? planBlocks : actualBlocks;

                return (
                  <button
                    className="weekly-draft-preview-day-column schedule-week-day-column"
                    key={date}
                    onDoubleClick={() => onOpenDay(date)}
                    style={timelineStyle}
                    type="button"
                    aria-label={`${formatWeekDate(date)}の${timelineMode === 'plan' ? '予定' : '記録'}`}
                  >
                    {WEEK_HOURS.map((hour) => (
                      <span
                        className="weekly-draft-preview-hour-line"
                        key={`${date}-${hour}`}
                        style={buildMarkerStyle(hour)}
                      />
                    ))}

                    {visibleBlocks.map((entry) => (
                      <span
                        className={[
                          'weekly-draft-preview-block',
                          'weekly-draft-preview-block--overview',
                          'schedule-week-block',
                          getToneClass(entry),
                          getDurationClass(entry),
                          entry.draft ? 'schedule-week-block-draft' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={entry.id}
                        style={buildBlockStyle(entry)}
                        title={`${entry.title} / ${entry.startTime}-${entry.endTime}${entry.draft ? ' / 仮予定' : ''}`}
                      >
                        <strong>{entry.title}</strong>
                        <small>{entry.startTime}-{entry.endTime}</small>
                        {entry.draft && onRemoveWeeklyDraftBlock ? (
                          <span
                            className="schedule-week-draft-remove"
                            role="button"
                            tabIndex={0}
                            aria-label={`${entry.title}を削除`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onRemoveWeeklyDraftBlock(entry.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              event.stopPropagation();
                              onRemoveWeeklyDraftBlock(entry.id);
                            }}
                          >
                            ×
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
