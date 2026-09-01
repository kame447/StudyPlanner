import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { useTimelineDragController } from '../hooks/useTimelineDragController';
import { useUndoRedoHistory } from '../hooks/useUndoRedoHistory';
import {
  minutesBetween,
  minutesFromTime,
  parseTimeToMinutes,
  sortByDateTime,
} from '../lib/date';
import type { WeekPlanMoveTarget } from '../lib/weekPlanDrag';
import type { Plan } from '../types/domain';
import { DragUndoRedoControls } from './DragUndoRedoControls';
import { TimelineDragOverlay } from './TimelineDragOverlay';
import {
  buildAiPlanningPreviewDatePages,
  clampAiPlanningPreviewPageIndex,
  getAiPlanningPreviewDateRange,
} from './aiPlanningPreviewPeriod';

interface AiPlanningPreviewDialogProps {
  blocks: WeeklyPlanDraftBlock[];
  plans: Plan[];
  error: string;
  hasLocalPreview: boolean;
  isBusy: boolean;
  isSaving: boolean;
  canSave: boolean;
  onClose: () => void;
  onAdjust: () => void;
  onRemove: (blockId: string) => void;
  onPromote: (blocks: WeeklyPlanDraftBlock[]) => void;
  onSave: (blocks: WeeklyPlanDraftBlock[]) => void;
}

interface PreviewGroup {
  date: string;
  blocks: WeeklyPlanDraftBlock[];
  existingPlans: Plan[];
}

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const MINUTES_PER_DAY = 24 * 60;
const DAY_DETAIL_HOUR_HEIGHT = 38;
const REMOVE_BLOCK_BUTTON_STYLE: CSSProperties = {
  position: 'absolute',
  top: '3px',
  right: '3px',
  zIndex: 3,
  width: '28px',
  height: '28px',
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: '1px solid var(--border)',
  borderRadius: '999px',
  background: 'var(--surface-strong)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  touchAction: 'manipulation',
};

function formatDateLabel(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  return `${value.getMonth() + 1}/${value.getDate()} ${WEEKDAY_LABELS[value.getDay()] ?? ''}`;
}

function toneClass(block: WeeklyPlanDraftBlock): string {
  const key = (block.label || block.subject || block.title || block.id).trim();
  const index =
    Array.from(key).reduce((sum, character) => sum + character.charCodeAt(0), 0) % 8;
  return `weekly-draft-tone-${index + 1}`;
}

function overviewMarkerStyle(hour: number): CSSProperties {
  return { top: `${(hour / 24) * 100}%` };
}

function overviewBlockStyle(startTime: string, endTime: string): CSSProperties {
  const start = Math.max(0, minutesFromTime(startTime));
  const end = Math.min(MINUTES_PER_DAY, parseTimeToMinutes(endTime, 'end'));
  const duration = Math.max(end - start, 1);
  return {
    top: `${(start / MINUTES_PER_DAY) * 100}%`,
    height: `max(${(duration / MINUTES_PER_DAY) * 100}%, 12px)`,
  };
}

function detailMarkerStyle(hour: number): CSSProperties {
  return { top: `${hour * DAY_DETAIL_HOUR_HEIGHT}px` };
}

function detailBlockStyle(startTime: string, endTime: string): CSSProperties {
  const start = Math.max(0, minutesFromTime(startTime));
  const end = Math.min(MINUTES_PER_DAY, parseTimeToMinutes(endTime, 'end'));
  const duration = Math.max(end - start, 1);
  return {
    top: `${(start / 60) * DAY_DETAIL_HOUR_HEIGHT}px`,
    height: `${Math.max((duration / 60) * DAY_DETAIL_HOUR_HEIGHT, 24)}px`,
  };
}

function activateByKeyboard(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

export function AiPlanningPreviewDialog({
  blocks,
  plans,
  error,
  hasLocalPreview,
  isBusy,
  isSaving,
  canSave,
  onClose,
  onAdjust,
  onRemove,
  onPromote,
  onSave,
}: AiPlanningPreviewDialogProps) {
  const [mode, setMode] = useState<'overview' | 'day'>('overview');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedDate, setSelectedDate] = useState('');
  const [editableBlocks, setEditableBlocks] = useState<WeeklyPlanDraftBlock[]>(blocks);
  const moveHistory = useUndoRedoHistory<string, WeekPlanMoveTarget>();
  const sourceSignature = useMemo(
    () =>
      blocks
        .map(
          (block) =>
            `${block.id}:${block.date}:${block.startTime}:${block.endTime}:${block.updatedAt}`,
        )
        .join('|'),
    [blocks],
  );
  const dateRange = useMemo(() => getAiPlanningPreviewDateRange(blocks), [blocks]);
  const datePages = useMemo(() => buildAiPlanningPreviewDatePages(blocks), [blocks]);
  const activePageIndex = clampAiPlanningPreviewPageIndex(pageIndex, datePages.length);
  const pageDates = datePages[activePageIndex] ?? [];
  const allDates = useMemo(() => datePages.flat(), [datePages]);
  const selectedDateIndex = selectedDate ? allDates.indexOf(selectedDate) : -1;
  const totalMinutes = useMemo(
    () =>
      editableBlocks.reduce(
        (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
        0,
      ),
    [editableBlocks],
  );
  const groups = useMemo<PreviewGroup[]>(
    () =>
      pageDates.map((date) => ({
        date,
        blocks: editableBlocks.filter((block) => block.date === date),
        existingPlans: sortByDateTime(plans.filter((plan) => plan.date === date)),
      })),
    [editableBlocks, pageDates, plans],
  );
  const selectedGroup = useMemo<PreviewGroup | null>(() => {
    if (!selectedDate) return null;
    return {
      date: selectedDate,
      blocks: editableBlocks.filter((block) => block.date === selectedDate),
      existingPlans: sortByDateTime(plans.filter((plan) => plan.date === selectedDate)),
    };
  }, [editableBlocks, plans, selectedDate]);
  const overviewGridStyle = {
    gridTemplateColumns: `46px repeat(${Math.max(groups.length, 1)}, minmax(0, 1fr))`,
  } satisfies CSSProperties;
  const detailTimelineHeight = 24 * DAY_DETAIL_HOUR_HEIGHT;

  function applyBlockTarget(blockId: string, target: WeekPlanMoveTarget) {
    const updatedAt = new Date().toISOString();
    setEditableBlocks((current) =>
      current.map((block) =>
        block.id === blockId
          ? {
              ...block,
              date: target.date,
              startTime: target.startTime,
              endTime: target.endTime,
              userEdited: true,
              updatedAt,
            }
          : block,
      ),
    );
  }

  const dragController = useTimelineDragController<WeeklyPlanDraftBlock>({
    onCommit: (descriptor, before, after) => {
      applyBlockTarget(descriptor.item.id, after);
      moveHistory.record({
        key: descriptor.item.id,
        before,
        after,
      });
    },
  });

  useEffect(() => {
    setEditableBlocks(blocks);
    moveHistory.clear();
    setMode('overview');
    setPageIndex(0);
    setSelectedDate('');
  }, [sourceSignature]);

  function openDay(date: string) {
    setSelectedDate(date);
    const nextPageIndex = datePages.findIndex((page) => page.includes(date));
    if (nextPageIndex >= 0) setPageIndex(nextPageIndex);
    setMode('day');
  }

  function chooseDayMode() {
    if (selectedDate && allDates.includes(selectedDate)) {
      setMode('day');
      return;
    }
    const firstDate = pageDates[0] ?? allDates[0];
    if (firstDate) openDay(firstDate);
  }

  function moveDay(offset: number) {
    if (selectedDateIndex < 0) return;
    const nextDate = allDates[selectedDateIndex + offset];
    if (!nextDate) return;
    openDay(nextDate);
  }

  function handleUndoMove() {
    void moveHistory.undo((entry, target) => applyBlockTarget(entry.key, target));
  }

  function handleRedoMove() {
    void moveHistory.redo((entry, target) => applyBlockTarget(entry.key, target));
  }

  return (
    <>
      <div className="ai-planning-preview-overlay ai-planning-preview-overlay-v2" onClick={onClose}>
        <section
          className="ai-planning-preview-modal ai-planning-preview-dialog-v2"
          role="dialog"
          aria-modal="true"
          aria-label="計画プレビュー"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="ai-planning-preview-header">
            <button type="button" onClick={onClose}>
              <X size={18} aria-hidden="true" />閉じる
            </button>
            <div>
              <h2>計画プレビュー</h2>
              <p>
                {dateRange
                  ? `${formatDateLabel(dateRange.startDate)} - ${formatDateLabel(dateRange.endDate)}`
                  : '-'}
              </p>
            </div>
            <span>{editableBlocks.length}件</span>
          </header>

          <div className="ai-planning-preview-mode-tabs" role="tablist" aria-label="計画プレビュー表示">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'overview'}
              className={mode === 'overview' ? 'active' : ''}
              onClick={() => setMode('overview')}
            >
              全体
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'day'}
              className={mode === 'day' ? 'active' : ''}
              onClick={chooseDayMode}
              disabled={allDates.length === 0}
            >
              日別
            </button>
          </div>

          {mode === 'overview' ? (
            <>
              <div className="ai-planning-preview-period-nav" aria-label="計画期間の表示範囲">
                <button
                  type="button"
                  aria-label="前の期間を表示"
                  disabled={activePageIndex <= 0}
                  onClick={() =>
                    setPageIndex((current) =>
                      clampAiPlanningPreviewPageIndex(current - 1, datePages.length),
                    )
                  }
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                  <span>前の7日</span>
                </button>
                <div>
                  <strong>
                    {pageDates.length > 0
                      ? `${formatDateLabel(pageDates[0]!)} - ${formatDateLabel(pageDates[pageDates.length - 1]!)}`
                      : '-'}
                  </strong>
                  <small>{datePages.length > 0 ? `${activePageIndex + 1} / ${datePages.length}` : '0 / 0'}</small>
                </div>
                <button
                  type="button"
                  aria-label="次の期間を表示"
                  disabled={activePageIndex >= datePages.length - 1}
                  onClick={() =>
                    setPageIndex((current) =>
                      clampAiPlanningPreviewPageIndex(current + 1, datePages.length),
                    )
                  }
                >
                  <span>次の7日</span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>

              <p className="ai-planning-preview-hint">予定をドラッグして日時を調整できます。日付をタップすると、その日を大きく表示します。日別表示では予定ごとに除外できます。</p>

              <div className="ai-planning-preview-scroll ai-planning-preview-overview-scroll">
                <div className="ai-planning-week-grid ai-planning-preview-overview-grid">
                  <div className="ai-planning-week-header" style={overviewGridStyle}>
                    <span>時間</span>
                    {groups.map((group) => (
                      <div
                        key={group.date}
                        role="button"
                        tabIndex={0}
                        aria-label={`${formatDateLabel(group.date)}を日別表示`}
                        onClick={() => openDay(group.date)}
                        onKeyDown={(event) => activateByKeyboard(event, () => openDay(group.date))}
                      >
                        <strong>{formatDateLabel(group.date)}</strong>
                        <small>{group.blocks.length}件</small>
                      </div>
                    ))}
                  </div>
                  <div className="ai-planning-week-body ai-planning-preview-overview-body" style={overviewGridStyle}>
                    <div className="ai-planning-time-axis" aria-hidden="true">
                      {HOURS.map((hour) => (
                        <span key={hour} style={overviewMarkerStyle(hour)}>
                          {String(hour).padStart(2, '0')}:00
                        </span>
                      ))}
                    </div>
                    {groups.map((group) => {
                      const targetGhost =
                        dragController.dragVisual?.target.date === group.date
                          ? dragController.dragVisual
                          : null;

                      return (
                        <div
                          className="ai-planning-day-column ai-planning-preview-overview-day"
                          key={group.date}
                          role="button"
                          tabIndex={0}
                          aria-label={`${formatDateLabel(group.date)}の予定を日別表示`}
                          onClick={() => openDay(group.date)}
                          onKeyDown={(event) => activateByKeyboard(event, () => openDay(group.date))}
                        >
                          {HOURS.map((hour) => (
                            <span
                              className="ai-planning-hour-line"
                              key={hour}
                              style={overviewMarkerStyle(hour)}
                            />
                          ))}
                          {targetGhost ? (
                            <span
                              className={`schedule-week-drop-ghost ${targetGhost.toneClass}`}
                              style={overviewBlockStyle(
                                targetGhost.target.startTime,
                                targetGhost.target.endTime,
                              )}
                              aria-hidden="true"
                            >
                              <strong>{targetGhost.title}</strong>
                              <small>
                                {targetGhost.target.startTime}-{targetGhost.target.endTime}
                              </small>
                            </span>
                          ) : null}
                          {group.existingPlans.map((plan) => (
                            <div
                              className="ai-planning-existing-block ai-planning-preview-overview-block"
                              key={plan.id}
                              style={overviewBlockStyle(plan.startTime, plan.endTime)}
                              title={`${plan.title} ${plan.startTime}-${plan.endTime}`}
                            >
                              <strong>{plan.title}</strong>
                              <small>{plan.startTime}-{plan.endTime}</small>
                            </div>
                          ))}
                          {group.blocks.map((block) => {
                            const dragDescriptor = !isBusy
                              ? {
                                  key: `overview:${block.id}`,
                                  item: block,
                                  title: block.title,
                                  toneClass: toneClass(block),
                                  original: {
                                    date: block.date,
                                    startTime: block.startTime,
                                    endTime: block.endTime,
                                  },
                                  dates: pageDates,
                                  allowDateChange: true,
                                  dayColumnSelector: '.ai-planning-preview-overview-day',
                                  scrollSelector: '.ai-planning-preview-overview-scroll',
                                }
                              : null;

                            return (
                              <div
                                className={[
                                  'ai-planning-draft-block',
                                  'ai-planning-preview-overview-block',
                                  toneClass(block),
                                  dragDescriptor ? 'schedule-week-plan-button' : '',
                                  dragController.isDragging(`overview:${block.id}`)
                                    ? 'is-drag-source'
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                key={block.id}
                                style={overviewBlockStyle(block.startTime, block.endTime)}
                                title={`${block.title} ${block.startTime}-${block.endTime}`}
                                aria-label={`${block.title} ${block.startTime}から${block.endTime}。長押しまたはドラッグで移動`}
                                onClick={(event) => {
                                  if (!dragController.shouldSuppressClick()) return;
                                  event.preventDefault();
                                  event.stopPropagation();
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
                                  dragDescriptor ? (event) => event.preventDefault() : undefined
                                }
                              >
                                <strong>{block.title}</strong>
                                <small>{block.startTime}-{block.endTime}</small>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="ai-planning-preview-day-detail">
              <div className="ai-planning-preview-day-nav">
                <button
                  type="button"
                  aria-label="前日を表示"
                  disabled={selectedDateIndex <= 0}
                  onClick={() => moveDay(-1)}
                >
                  <ChevronLeft size={18} aria-hidden="true" />前日
                </button>
                <div>
                  <strong>{selectedDate ? formatDateLabel(selectedDate) : '日別表示'}</strong>
                  <small>{selectedGroup?.blocks.length ?? 0}件</small>
                </div>
                <button
                  type="button"
                  aria-label="翌日を表示"
                  disabled={selectedDateIndex < 0 || selectedDateIndex >= allDates.length - 1}
                  onClick={() => moveDay(1)}
                >
                  翌日<ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>

              <div className="ai-planning-preview-day-scroll">
                <div className="ai-planning-preview-day-grid">
                  <div className="ai-planning-preview-day-axis" style={{ height: `${detailTimelineHeight}px` }}>
                    {HOURS.map((hour) => (
                      <span key={hour} style={detailMarkerStyle(hour)}>
                        {String(hour).padStart(2, '0')}:00
                      </span>
                    ))}
                  </div>
                  <div className="ai-planning-preview-day-column-detail" style={{ height: `${detailTimelineHeight}px` }}>
                    {HOURS.map((hour) => (
                      <span
                        className="ai-planning-hour-line"
                        key={hour}
                        style={detailMarkerStyle(hour)}
                      />
                    ))}
                    {dragController.dragVisual &&
                    dragController.dragVisual.target.date === selectedDate ? (
                      <span
                        className={`schedule-week-drop-ghost ${dragController.dragVisual.toneClass}`}
                        style={{
                          ...detailBlockStyle(
                            dragController.dragVisual.target.startTime,
                            dragController.dragVisual.target.endTime,
                          ),
                          left: '4px',
                          width: 'calc(100% - 8px)',
                        }}
                        aria-hidden="true"
                      >
                        <strong>{dragController.dragVisual.title}</strong>
                        <small>
                          {dragController.dragVisual.target.startTime}-{dragController.dragVisual.target.endTime}
                        </small>
                      </span>
                    ) : null}
                    {selectedGroup?.existingPlans.map((plan) => (
                      <div
                        className="ai-planning-existing-block ai-planning-preview-detail-block"
                        key={plan.id}
                        style={detailBlockStyle(plan.startTime, plan.endTime)}
                      >
                        <strong>{plan.title}</strong>
                        <small>{plan.startTime}-{plan.endTime}</small>
                      </div>
                    ))}
                    {selectedGroup?.blocks.map((block) => {
                      const dragDescriptor = !isBusy
                        ? {
                            key: `day:${block.id}`,
                            item: block,
                            title: block.title,
                            toneClass: toneClass(block),
                            original: {
                              date: block.date,
                              startTime: block.startTime,
                              endTime: block.endTime,
                            },
                            dates: [block.date],
                            allowDateChange: false,
                            dayColumnSelector: '.ai-planning-preview-day-column-detail',
                          }
                        : null;

                      return (
                        <div
                          className={[
                            'ai-planning-draft-block',
                            'ai-planning-preview-detail-block',
                            toneClass(block),
                            dragDescriptor ? 'schedule-week-plan-button' : '',
                            dragController.isDragging(`day:${block.id}`)
                              ? 'is-drag-source'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          key={block.id}
                          style={{
                            ...detailBlockStyle(block.startTime, block.endTime),
                            paddingRight: '38px',
                          }}
                          title={`${block.title} ${block.startTime}-${block.endTime}`}
                          aria-label={`${block.title} ${block.startTime}から${block.endTime}。長押しまたはドラッグで移動`}
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
                            dragDescriptor ? (event) => event.preventDefault() : undefined
                          }
                        >
                          <strong>{block.title}</strong>
                          <small>{block.startTime}-{block.endTime}</small>
                          <button
                            type="button"
                            aria-label={`${block.title}を計画から除外`}
                            title="この予定を除外"
                            disabled={isBusy}
                            style={{
                              ...REMOVE_BLOCK_BUTTON_STYLE,
                              cursor: isBusy ? 'default' : 'pointer',
                              opacity: isBusy ? 0.45 : 1,
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onTouchStart={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              onRemove(block.id);
                            }}
                          >
                            <X size={15} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="ai-planning-preview-total" aria-label="計画全体の集計">
            <span>全{editableBlocks.length}件</span>
            <span>合計 {Math.floor(totalMinutes / 60)}時間{totalMinutes % 60 > 0 ? `${totalMinutes % 60}分` : ''}</span>
          </div>

          {error ? <p className="ai-planning-preview-error" role="alert">{error}</p> : null}

          <footer className="ai-planning-preview-actions">
            <button className="ai-planning-secondary-action" type="button" onClick={onAdjust}>
              さらに調整
            </button>
            {hasLocalPreview ? (
              <button
                className="ai-planning-primary-action"
                type="button"
                disabled={isBusy}
                onClick={() => onPromote(editableBlocks)}
              >
                この内容で仮予定にする
              </button>
            ) : (
              <button
                className="ai-planning-primary-action"
                type="button"
                disabled={isBusy || !canSave}
                onClick={() => onSave(editableBlocks)}
              >
                {isSaving ? '保存中...' : 'この内容で保存'}
              </button>
            )}
          </footer>
        </section>
      </div>
      <TimelineDragOverlay visual={dragController.dragVisual} placement="preview" />
      <DragUndoRedoControls
        visible={moveHistory.hasHistory}
        canUndo={moveHistory.canUndo}
        canRedo={moveHistory.canRedo}
        isBusy={moveHistory.isBusy}
        placement="preview"
        onUndo={handleUndoMove}
        onRedo={handleRedoMove}
      />
    </>
  );
}