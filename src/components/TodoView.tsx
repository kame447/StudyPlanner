import { useMemo, useState, type FormEvent } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  NotebookText,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { resolveQuickEntryEndTime } from '../lib/quickEntryDrafts';
import { PLAN_TYPE_OPTIONS, getPlanTypeLabel } from '../lib/plans';
import type {
  PlanDraft,
  PlanType,
  TodoStatus,
  TodoTask,
  TodoTaskDraft,
} from '../types/domain';

type TodoSortDirection = 'asc' | 'desc';
type TodoSectionKey = 'due' | 'unset' | 'done';
type DurationOptionValue = number | null | 'custom';

interface TodoViewProps {
  userId: string;
  selectedDate: string;
  todos: TodoTask[];
  onSaveTodo: (draft: TodoTaskDraft, targetTodoId?: string) => Promise<void>;
  onScheduleTodo: (todo: TodoTask, draft: PlanDraft) => Promise<unknown>;
  onDeleteTodo: (todo: TodoTask) => Promise<void>;
}

const TODO_INITIAL_VISIBLE_COUNT = 5;

const SCHEDULE_DURATION_OPTIONS: Array<{
  value: DurationOptionValue;
  label: string;
}> = [
  { value: null, label: 'なし' },
  { value: 15, label: '15分' },
  { value: 30, label: '30分' },
  { value: 45, label: '45分' },
  { value: 60, label: '60分' },
  { value: 90, label: '90分' },
  { value: 120, label: '120分' },
  { value: 150, label: '150分' },
  { value: 180, label: '180分' },
  { value: 'custom', label: '自由' },
];

const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  open: '未完了',
  scheduled: '予定化済み',
  done: '完了',
  archived: 'アーカイブ',
};

const TODO_SECTION_LABELS: Record<TodoSectionKey, string> = {
  due: '締切あり',
  unset: '締切未設定',
  done: '完了',
};

function createTodoDraftFromTask(todo: TodoTask): TodoTaskDraft {
  return {
    userId: todo.userId,
    title: todo.title,
    subject: todo.subject,
    type: todo.type,
    estimatedMinutes: todo.estimatedMinutes,
    dueDate: todo.dueDate,
    dueTime: todo.dueDate ? todo.dueTime ?? null : null,
    memo: todo.memo,
    status: todo.status,
    scheduledPlanId: todo.scheduledPlanId,
    pinned: Boolean(todo.pinned),
  };
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDueSortValue(todo: TodoTask): string {
  return `${todo.dueDate ?? '9999-12-31'}T${todo.dueTime ?? '23:59'}`;
}

function compareDueTodos(
  left: TodoTask,
  right: TodoTask,
  direction: TodoSortDirection,
): number {
  const dueDelta = getDueSortValue(left).localeCompare(getDueSortValue(right));

  if (dueDelta !== 0) {
    return direction === 'asc' ? dueDelta : -dueDelta;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function compareUnsetTodos(left: TodoTask, right: TodoTask): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function comparePinnedTodos(
  left: TodoTask,
  right: TodoTask,
  compareRest: (leftTodo: TodoTask, rightTodo: TodoTask) => number,
): number {
  const leftPinned = left.pinned === true;
  const rightPinned = right.pinned === true;

  if (leftPinned !== rightPinned) {
    return leftPinned ? -1 : 1;
  }

  return compareRest(left, right);
}

function getTodoStatusClass(status: TodoStatus): string {
  return `todo-lozenge todo-status-${status}`;
}

function formatTodoDate(date: string): string {
  const [, month, day] = date.split('-');

  if (!month || !day) {
    return date;
  }

  return `${Number(month)}/${Number(day)}`;
}

function formatTodoDue(todo: TodoTask): string {
  if (!todo.dueDate) {
    return '締切未設定';
  }

  const dateLabel = formatTodoDate(todo.dueDate);
  return todo.dueTime
    ? `締切 ${dateLabel} ${todo.dueTime}`
    : `締切 ${dateLabel}`;
}

export function TodoView({
  userId,
  selectedDate,
  todos,
  onSaveTodo,
  onScheduleTodo,
  onDeleteTodo,
}: TodoViewProps) {
  const [sortDirection, setSortDirection] = useState<TodoSortDirection>('asc');
  const [expandedSections, setExpandedSections] = useState<
    Record<TodoSectionKey, boolean>
  >({
    due: false,
    unset: false,
    done: false,
  });
  const [editingTodo, setEditingTodo] = useState<TodoTask | null>(null);
  const [editDraft, setEditDraft] = useState<TodoTaskDraft | null>(null);
  const [schedulingTodo, setSchedulingTodo] = useState<TodoTask | null>(null);
  const [scheduleDate, setScheduleDate] = useState(selectedDate || todayIsoDate());
  const [scheduleStartTime, setScheduleStartTime] = useState('19:00');
  const [scheduleMinutes, setScheduleMinutes] = useState<number | null>(null);
  const [isCustomScheduleDuration, setIsCustomScheduleDuration] =
    useState(false);
  const [customScheduleDurationInput, setCustomScheduleDurationInput] =
    useState('');
  const [savingTodoId, setSavingTodoId] = useState<string | null>(null);

  const groupedTodos = useMemo(() => {
    const visibleTodos = todos.filter((todo) => todo.status !== 'archived');
    const activeTodos = visibleTodos.filter((todo) => todo.status !== 'done');

    return {
      due: activeTodos
        .filter((todo) => Boolean(todo.dueDate))
        .sort((left, right) =>
          comparePinnedTodos(left, right, (leftTodo, rightTodo) =>
            compareDueTodos(leftTodo, rightTodo, sortDirection),
          ),
        ),
      unset: activeTodos
        .filter((todo) => !todo.dueDate)
        .sort((left, right) =>
          comparePinnedTodos(left, right, compareUnsetTodos),
        ),
      done: visibleTodos
        .filter((todo) => todo.status === 'done')
        .sort((left, right) => compareDueTodos(left, right, sortDirection)),
    };
  }, [sortDirection, todos]);

  function updateEditDraft<K extends keyof TodoTaskDraft>(
    key: K,
    value: TodoTaskDraft[K],
  ) {
    setEditDraft((current) => {
      if (!current) {
        return current;
      }

      if (key === 'dueDate' && !value) {
        return {
          ...current,
          dueDate: null,
          dueTime: null,
        };
      }

      return {
        ...current,
        [key]: value,
      };
    });
  }

  function openEditModal(todo: TodoTask) {
    setEditingTodo(todo);
    setEditDraft(createTodoDraftFromTask(todo));
  }

  function closeEditModal() {
    setEditingTodo(null);
    setEditDraft(null);
  }

  function openScheduleModal(todo: TodoTask) {
    setSchedulingTodo(todo);
    setScheduleDate(todo.dueDate ?? selectedDate ?? todayIsoDate());
    setScheduleStartTime('19:00');
    setScheduleMinutes(todo.estimatedMinutes);
    setIsCustomScheduleDuration(
      typeof todo.estimatedMinutes === 'number' &&
        !SCHEDULE_DURATION_OPTIONS.some(
          (option) => option.value === todo.estimatedMinutes,
        ),
    );
    setCustomScheduleDurationInput(
      typeof todo.estimatedMinutes === 'number' &&
        !SCHEDULE_DURATION_OPTIONS.some(
          (option) => option.value === todo.estimatedMinutes,
        )
        ? String(todo.estimatedMinutes)
        : '',
    );
  }

  function closeScheduleModal() {
    setSchedulingTodo(null);
    setScheduleDate(selectedDate || todayIsoDate());
    setScheduleStartTime('19:00');
    setScheduleMinutes(null);
    setIsCustomScheduleDuration(false);
    setCustomScheduleDurationInput('');
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingTodo || !editDraft || !editDraft.title.trim()) {
      return;
    }

    setSavingTodoId(editingTodo.id);
    try {
      await onSaveTodo(
        {
          ...editDraft,
          userId,
          title: editDraft.title.trim(),
          subject: editDraft.subject.trim(),
          dueDate: editDraft.dueDate || null,
          dueTime: editDraft.dueDate ? editDraft.dueTime || null : null,
          memo: editDraft.memo.trim(),
          status: editingTodo.status,
        },
        editingTodo.id,
      );
      closeEditModal();
    } finally {
      setSavingTodoId(null);
    }
  }

  async function updateTodoStatus(todo: TodoTask, status: TodoStatus) {
    setSavingTodoId(todo.id);
    try {
      await onSaveTodo(
        {
          ...createTodoDraftFromTask(todo),
          userId,
          status,
          scheduledPlanId: status === 'open' ? null : todo.scheduledPlanId,
          pinned:
            status === 'done' || status === 'open'
              ? false
              : Boolean(todo.pinned),
        },
        todo.id,
      );
    } finally {
      setSavingTodoId(null);
    }
  }

  async function toggleTodoPinned(todo: TodoTask) {
    setSavingTodoId(todo.id);
    try {
      await onSaveTodo(
        {
          ...createTodoDraftFromTask(todo),
          userId,
          pinned: !Boolean(todo.pinned),
        },
        todo.id,
      );
    } finally {
      setSavingTodoId(null);
    }
  }

  function applyScheduleDuration(value: DurationOptionValue) {
    if (value === 'custom') {
      setIsCustomScheduleDuration(true);

      const nextMinutes = Number(customScheduleDurationInput);
      setScheduleMinutes(
        Number.isInteger(nextMinutes) && nextMinutes > 0 ? nextMinutes : null,
      );
      return;
    }

    setIsCustomScheduleDuration(false);
    setCustomScheduleDurationInput('');
    setScheduleMinutes(value);
  }

  function updateCustomScheduleDuration(value: string) {
    setCustomScheduleDurationInput(value);

    const nextMinutes = Number(value);
    setScheduleMinutes(
      Number.isInteger(nextMinutes) && nextMinutes > 0 ? nextMinutes : null,
    );
  }

  async function handleScheduleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !schedulingTodo ||
      !schedulingTodo.title.trim() ||
      !scheduleDate ||
      !scheduleStartTime ||
      scheduleMinutes === null
    ) {
      return;
    }

    setSavingTodoId(schedulingTodo.id);
    try {
      await onScheduleTodo(schedulingTodo, {
        userId,
        title: schedulingTodo.title.trim(),
        subject: schedulingTodo.subject.trim(),
        date: scheduleDate,
        startTime: scheduleStartTime,
        endTime: resolveQuickEntryEndTime(scheduleStartTime, scheduleMinutes),
        repeat: 'none',
        repeatUntil: null,
        excludedDates: [],
        recurrenceRules: [],
        type: schedulingTodo.type,
        memo: schedulingTodo.memo.trim(),
        sourceType: 'todo',
        sourceId: schedulingTodo.id,
      });
      closeScheduleModal();
    } finally {
      setSavingTodoId(null);
    }
  }

  function renderTodo(todo: TodoTask) {
    const isBusy = savingTodoId === todo.id;
    const isPinned = todo.pinned === true && todo.status !== 'done';

    return (
      <article
        className={
          isPinned
            ? 'todo-item todo-view-item todo-item-pinned'
            : 'todo-item todo-view-item'
        }
        key={todo.id}
      >
        <div className="todo-item-main">
          <div className="todo-item-title-row">
            <strong>{todo.title}</strong>
            <span className={getTodoStatusClass(todo.status)}>
              {TODO_STATUS_LABELS[todo.status]}
            </span>
          </div>
          <div className="todo-meta" aria-label="Todoの補足情報">
            <span className="todo-tag todo-subject-tag">
              {todo.subject || getPlanTypeLabel(todo.type)}
            </span>
            <span className="todo-tag todo-type-tag">
              {getPlanTypeLabel(todo.type)}
            </span>
            {todo.estimatedMinutes !== null ? (
              <span className="todo-tag todo-duration-tag">
                <Clock aria-hidden="true" size={16} strokeWidth={1.9} />
                {todo.estimatedMinutes}分
              </span>
            ) : null}
            <span className="todo-tag todo-date-tag">
              <CalendarDays aria-hidden="true" size={16} strokeWidth={1.9} />
              {formatTodoDue(todo)}
            </span>
            {todo.status === 'scheduled' && todo.scheduledPlanId ? (
              <span className="todo-tag todo-scheduled-tag">予定化済み</span>
            ) : null}
            {todo.pinned && todo.status !== 'done' ? (
              <span className="todo-tag todo-pinned-tag">
                <Pin aria-hidden="true" size={16} strokeWidth={1.9} />
                ピン留め
              </span>
            ) : null}
          </div>
          {todo.memo ? (
            <p className="todo-memo">
              <NotebookText aria-hidden="true" size={16} strokeWidth={1.9} />
              <span>{todo.memo}</span>
            </p>
          ) : null}
        </div>
        <div className="todo-item-actions">
          <button
            className="ghost-button todo-icon-button"
            onClick={() => openEditModal(todo)}
            aria-label="編集"
            title="編集"
            type="button"
          >
            <Pencil aria-hidden="true" size={19} strokeWidth={1.9} />
          </button>
          {todo.status === 'open' || todo.status === 'scheduled' ? (
            <button
              className={
                todo.pinned
                  ? 'ghost-button todo-icon-button todo-pin-button active'
                  : 'ghost-button todo-icon-button todo-pin-button'
              }
              disabled={isBusy}
              onClick={() => {
                void toggleTodoPinned(todo);
              }}
              aria-label={todo.pinned ? 'ピン解除' : 'ピン留め'}
              title={todo.pinned ? 'ピン解除' : 'ピン留め'}
              type="button"
            >
              {todo.pinned ? (
                <PinOff aria-hidden="true" size={19} strokeWidth={1.9} />
              ) : (
                <Pin aria-hidden="true" size={19} strokeWidth={1.9} />
              )}
            </button>
          ) : null}
          {todo.status === 'open' ? (
            <button
              className="ghost-button todo-icon-button"
              disabled={isBusy}
              onClick={() => openScheduleModal(todo)}
              aria-label="予定にする"
              title="予定にする"
              type="button"
            >
              <CalendarDays aria-hidden="true" size={19} strokeWidth={1.9} />
            </button>
          ) : null}
          {todo.status === 'open' || todo.status === 'scheduled' ? (
            <button
              className="ghost-button todo-icon-button"
              disabled={isBusy}
              onClick={() => {
                void updateTodoStatus(todo, 'done');
              }}
              aria-label="完了"
              title="完了"
              type="button"
            >
              <CheckCircle2 aria-hidden="true" size={19} strokeWidth={1.9} />
            </button>
          ) : null}
          {todo.status === 'done' || todo.status === 'scheduled' ? (
            <button
              className="ghost-button todo-icon-button"
              disabled={isBusy}
              onClick={() => {
                void updateTodoStatus(todo, 'open');
              }}
              aria-label="未完了に戻す"
              title="未完了に戻す"
              type="button"
            >
              <Circle aria-hidden="true" size={19} strokeWidth={1.9} />
            </button>
          ) : null}
          <button
            className="ghost-button todo-icon-button todo-delete-button"
            disabled={isBusy}
            onClick={() => {
              void onDeleteTodo(todo);
            }}
            aria-label="削除"
            title="削除"
            type="button"
          >
            <Trash2 aria-hidden="true" size={19} strokeWidth={1.9} />
          </button>
        </div>
      </article>
    );
  }

  function renderTodoSection(sectionKey: TodoSectionKey) {
    const sectionTodos = groupedTodos[sectionKey];
    const isExpanded = expandedSections[sectionKey];
    const pinnedTodos =
      sectionKey === 'done'
        ? []
        : sectionTodos.filter((todo) => todo.pinned === true);
    const regularTodos =
      sectionKey === 'done'
        ? sectionTodos
        : sectionTodos.filter((todo) => todo.pinned !== true);
    const visibleTodos =
      isExpanded || sectionKey === 'done'
        ? sectionTodos
        : [
            ...pinnedTodos,
            ...regularTodos.slice(0, TODO_INITIAL_VISIBLE_COUNT),
          ];
    const collapsedDoneTodos = sectionTodos.slice(0, TODO_INITIAL_VISIBLE_COUNT);
    const renderedTodos =
      !isExpanded && sectionKey === 'done' ? collapsedDoneTodos : visibleTodos;
    const hasOverflow =
      sectionKey === 'done'
        ? sectionTodos.length > TODO_INITIAL_VISIBLE_COUNT
        : regularTodos.length > TODO_INITIAL_VISIBLE_COUNT;

    return (
      <section className="todo-status-section" key={sectionKey}>
        <div className="todo-status-section-head">
          <h3>{TODO_SECTION_LABELS[sectionKey]}</h3>
          <span className="todo-section-count">{sectionTodos.length}</span>
        </div>
        {renderedTodos.length > 0 ? (
          <div className="todo-list todo-view-list">
            {renderedTodos.map(renderTodo)}
          </div>
        ) : (
          <p className="empty-copy todo-empty">Todoはありません。</p>
        )}
        {hasOverflow ? (
          <button
            className="ghost-button todo-section-toggle"
            onClick={() =>
              setExpandedSections((current) => ({
                ...current,
                [sectionKey]: !current[sectionKey],
              }))
            }
            type="button"
          >
            {isExpanded ? (
              <>
                <ChevronUp aria-hidden="true" size={18} strokeWidth={1.9} />
                折りたたむ
              </>
            ) : (
              <>
                <ChevronDown aria-hidden="true" size={18} strokeWidth={1.9} />
                すべて表示（{sectionTodos.length}件）
              </>
            )}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="panel todo-view">
      <div className="section-header todo-view-header">
        <div>
          <h2>Todo</h2>
        </div>
        <div className="segmented-control todo-sort-control" aria-label="Todoの並び順">
          <button
            className={sortDirection === 'asc' ? 'segment active' : 'segment'}
            onClick={() => setSortDirection('asc')}
            type="button"
          >
            締切が早い順
          </button>
          <button
            className={sortDirection === 'desc' ? 'segment active' : 'segment'}
            onClick={() => setSortDirection('desc')}
            type="button"
          >
            締切が遅い順
          </button>
        </div>
      </div>

      <div className="todo-section-list">
        {renderTodoSection('due')}
        {renderTodoSection('unset')}
        {renderTodoSection('done')}
      </div>

      {editingTodo && editDraft ? (
        <div className="overlay modal-overlay" onClick={closeEditModal}>
          <form
            className="modal-card todo-edit-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleEditSubmit}
          >
            <div className="section-header todo-edit-header">
              <div>
                <h2>Todo編集</h2>
              </div>
              <span className={getTodoStatusClass(editingTodo.status)}>
                {TODO_STATUS_LABELS[editingTodo.status]}
              </span>
            </div>

            <label className="field">
              <span>タイトル</span>
              <input
                value={editDraft.title}
                onChange={(event) => updateEditDraft('title', event.target.value)}
              />
            </label>

            <div className="form-grid compact todo-form-grid">
              <label className="field">
                <span>教科</span>
                <input
                  value={editDraft.subject}
                  onChange={(event) =>
                    updateEditDraft('subject', event.target.value)
                  }
                />
              </label>

              <label className="field">
                <span>種別</span>
                <select
                  value={editDraft.type}
                  onChange={(event) =>
                    updateEditDraft('type', event.target.value as PlanType)
                  }
                >
                  {PLAN_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>所要時間</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={editDraft.estimatedMinutes ?? ''}
                  onChange={(event) =>
                    updateEditDraft(
                      'estimatedMinutes',
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                />
              </label>

              <label className="field">
                <span>締切日</span>
                <input
                  type="date"
                  value={editDraft.dueDate ?? ''}
                  onChange={(event) =>
                    updateEditDraft('dueDate', event.target.value || null)
                  }
                />
              </label>

              <label className="field">
                <span>締切時刻</span>
                <input
                  type="time"
                  value={editDraft.dueTime ?? ''}
                  disabled={!editDraft.dueDate}
                  onChange={(event) =>
                    updateEditDraft('dueTime', event.target.value || null)
                  }
                />
              </label>
            </div>

            <label className="field">
              <span>メモ</span>
              <textarea
                value={editDraft.memo}
                onChange={(event) => updateEditDraft('memo', event.target.value)}
                rows={3}
              />
            </label>

            <div className="row-actions todo-edit-actions">
              <button
                className="ghost-button"
                onClick={closeEditModal}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="primary-button"
                disabled={savingTodoId === editingTodo.id || !editDraft.title.trim()}
                type="submit"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {schedulingTodo ? (
        <div className="overlay modal-overlay" onClick={closeScheduleModal}>
          <form
            className="modal-card todo-edit-modal todo-schedule-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleScheduleSubmit}
          >
            <div className="section-header todo-edit-header">
              <div>
                <h2>予定にする</h2>
                <p>{schedulingTodo.title}</p>
              </div>
            </div>

            <div className="form-grid compact todo-form-grid">
              <label className="field">
                <span>日付</span>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                />
              </label>

              <label className="field">
                <span>開始時刻</span>
                <input
                  type="time"
                  value={scheduleStartTime}
                  onChange={(event) => setScheduleStartTime(event.target.value)}
                />
              </label>
            </div>

            <section className="todo-schedule-duration">
              <div className="todo-schedule-duration-head">
                <h3>所要時間</h3>
              </div>
              <div className="quick-entry-chip-row quick-entry-duration-grid">
                {SCHEDULE_DURATION_OPTIONS.map((option) => {
                  const isActive =
                    option.value === 'custom'
                      ? isCustomScheduleDuration
                      : !isCustomScheduleDuration && scheduleMinutes === option.value;

                  return (
                    <button
                      className={
                        isActive ? 'quick-entry-chip active' : 'quick-entry-chip'
                      }
                      key={option.label}
                      onClick={() => applyScheduleDuration(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {isCustomScheduleDuration ? (
                <label className="field quick-entry-custom-duration">
                  <span>自由入力（分）</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={customScheduleDurationInput}
                    onChange={(event) =>
                      updateCustomScheduleDuration(event.target.value)
                    }
                    placeholder="75"
                  />
                </label>
              ) : null}
            </section>

            <div className="row-actions todo-edit-actions">
              <button
                className="ghost-button"
                onClick={closeScheduleModal}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="primary-button"
                disabled={
                  savingTodoId === schedulingTodo.id ||
                  !schedulingTodo.title.trim() ||
                  !scheduleDate ||
                  !scheduleStartTime ||
                  scheduleMinutes === null
                }
                type="submit"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
