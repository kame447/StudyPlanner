import { useMemo, useState, type FormEvent } from 'react';
import { PLAN_TYPE_OPTIONS, getPlanTypeLabel } from '../lib/plans';
import type {
  PlanType,
  TodoStatus,
  TodoTask,
  TodoTaskDraft,
} from '../types/domain';

type TodoSortDirection = 'asc' | 'desc';
type TodoSectionKey = 'due' | 'unset' | 'done';

interface TodoViewProps {
  userId: string;
  todos: TodoTask[];
  onSaveTodo: (draft: TodoTaskDraft, targetTodoId?: string) => Promise<void>;
  onDeleteTodo: (todo: TodoTask) => Promise<void>;
}

const TODO_INITIAL_VISIBLE_COUNT = 5;

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
  };
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
  todos,
  onSaveTodo,
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
  const [savingTodoId, setSavingTodoId] = useState<string | null>(null);

  const groupedTodos = useMemo(() => {
    const visibleTodos = todos.filter((todo) => todo.status !== 'archived');
    const activeTodos = visibleTodos.filter((todo) => todo.status !== 'done');

    return {
      due: activeTodos
        .filter((todo) => Boolean(todo.dueDate))
        .sort((left, right) => compareDueTodos(left, right, sortDirection)),
      unset: activeTodos
        .filter((todo) => !todo.dueDate)
        .sort(compareUnsetTodos),
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
        },
        todo.id,
      );
    } finally {
      setSavingTodoId(null);
    }
  }

  function renderTodo(todo: TodoTask) {
    const isBusy = savingTodoId === todo.id;

    return (
      <article className="todo-item todo-view-item" key={todo.id}>
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
                {todo.estimatedMinutes}分
              </span>
            ) : null}
            <span className="todo-tag todo-date-tag">{formatTodoDue(todo)}</span>
          </div>
          {todo.memo ? <p>{todo.memo}</p> : null}
        </div>
        <div className="todo-item-actions">
          <button
            className="ghost-button todo-action-button"
            onClick={() => openEditModal(todo)}
            type="button"
          >
            編集
          </button>
          {todo.status === 'open' ? (
            <button
              className="ghost-button todo-action-button"
              disabled={isBusy}
              onClick={() => {
                void updateTodoStatus(todo, 'done');
              }}
              type="button"
            >
              完了
            </button>
          ) : null}
          {todo.status === 'done' ? (
            <button
              className="ghost-button todo-action-button"
              disabled={isBusy}
              onClick={() => {
                void updateTodoStatus(todo, 'open');
              }}
              type="button"
            >
              未完了に戻す
            </button>
          ) : null}
          <button
            className="ghost-button todo-delete-button"
            disabled={isBusy}
            onClick={() => {
              void onDeleteTodo(todo);
            }}
            type="button"
          >
            削除
          </button>
        </div>
      </article>
    );
  }

  function renderTodoSection(sectionKey: TodoSectionKey) {
    const sectionTodos = groupedTodos[sectionKey];
    const isExpanded = expandedSections[sectionKey];
    const visibleTodos = isExpanded
      ? sectionTodos
      : sectionTodos.slice(0, TODO_INITIAL_VISIBLE_COUNT);
    const hasOverflow = sectionTodos.length > TODO_INITIAL_VISIBLE_COUNT;

    return (
      <section className="todo-status-section" key={sectionKey}>
        <div className="todo-status-section-head">
          <h3>{TODO_SECTION_LABELS[sectionKey]}</h3>
          <span className="todo-section-count">{sectionTodos.length}</span>
        </div>
        {visibleTodos.length > 0 ? (
          <div className="todo-list todo-view-list">
            {visibleTodos.map(renderTodo)}
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
            {isExpanded ? '折りたたむ' : `すべて表示（${sectionTodos.length}件）`}
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
    </section>
  );
}
