import { useMemo, useState, type FormEvent } from 'react';
import { PLAN_TYPE_OPTIONS, getPlanTypeLabel } from '../lib/plans';
import type { PlanType, TodoStatus, TodoTask, TodoTaskDraft } from '../types/domain';

interface TodoViewProps {
  userId: string;
  todos: TodoTask[];
  onSaveTodo: (draft: TodoTaskDraft) => Promise<void>;
  onDeleteTodo: (todo: TodoTask) => Promise<void>;
}

const TODO_STATUS_SECTIONS: Array<{ status: TodoStatus; label: string }> = [
  { status: 'open', label: '未配置' },
  { status: 'scheduled', label: '予定済み' },
  { status: 'done', label: '完了' },
  { status: 'archived', label: 'アーカイブ' },
];

const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  open: '未配置',
  scheduled: '予定済み',
  done: '完了',
  archived: 'アーカイブ',
};

function createEmptyTodoDraft(userId: string): TodoTaskDraft {
  return {
    userId,
    title: '',
    subject: '',
    type: 'study',
    estimatedMinutes: null,
    dueDate: null,
    memo: '',
  };
}

function compareTodos(left: TodoTask, right: TodoTask): number {
  const leftDueDate = left.dueDate ?? '9999-12-31';
  const rightDueDate = right.dueDate ?? '9999-12-31';
  const dueDateDelta = leftDueDate.localeCompare(rightDueDate);

  if (dueDateDelta !== 0) {
    return dueDateDelta;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function getTodoStatusClass(status: TodoStatus): string {
  return `todo-lozenge todo-status-${status}`;
}

export function TodoView({
  userId,
  todos,
  onSaveTodo,
  onDeleteTodo,
}: TodoViewProps) {
  const [draft, setDraft] = useState<TodoTaskDraft>(() =>
    createEmptyTodoDraft(userId),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const todosByStatus = useMemo(() => {
    return TODO_STATUS_SECTIONS.reduce(
      (groups, section) => {
        groups[section.status] = todos
          .filter((todo) => todo.status === section.status)
          .sort(compareTodos);
        return groups;
      },
      {} as Record<TodoStatus, TodoTask[]>,
    );
  }, [todos]);

  function updateDraft<K extends keyof TodoTaskDraft>(
    key: K,
    value: TodoTaskDraft[K],
  ) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.title.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSaveTodo({
        ...draft,
        userId,
        title: draft.title.trim(),
        subject: draft.subject.trim(),
        memo: draft.memo.trim(),
      });
      setDraft(createEmptyTodoDraft(userId));
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderTodo(todo: TodoTask) {
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
            {todo.dueDate ? (
              <span className="todo-tag todo-date-tag">期限 {todo.dueDate}</span>
            ) : null}
          </div>
          {todo.memo ? <p>{todo.memo}</p> : null}
        </div>
        <button
          className="ghost-button todo-delete-button"
          onClick={() => {
            void onDeleteTodo(todo);
          }}
          type="button"
        >
          削除
        </button>
      </article>
    );
  }

  return (
    <section className="panel todo-view">
      <div className="section-header todo-view-header">
        <div>
          <h2>Todo</h2>
        </div>
      </div>

      <form className="todo-form todo-view-form" onSubmit={handleSubmit}>
        <label className="field todo-title-field">
          <span>タイトル</span>
          <input
            value={draft.title}
            onChange={(event) => updateDraft('title', event.target.value)}
            placeholder="未配置タスク"
          />
        </label>

        <div className="form-grid compact todo-form-grid">
          <label className="field">
            <span>教科</span>
            <input
              value={draft.subject}
              onChange={(event) => updateDraft('subject', event.target.value)}
              placeholder="数学"
            />
          </label>

          <label className="field">
            <span>種別</span>
            <select
              value={draft.type}
              onChange={(event) =>
                updateDraft('type', event.target.value as PlanType)
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
              step="5"
              value={draft.estimatedMinutes ?? ''}
              onChange={(event) =>
                updateDraft(
                  'estimatedMinutes',
                  event.target.value ? Number(event.target.value) : null,
                )
              }
            />
          </label>

          <label className="field">
            <span>締切</span>
            <input
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(event) =>
                updateDraft('dueDate', event.target.value || null)
              }
            />
          </label>
        </div>

        <label className="field">
          <span>メモ</span>
          <textarea
            value={draft.memo}
            onChange={(event) => updateDraft('memo', event.target.value)}
            rows={2}
          />
        </label>

        <div className="row-actions todo-form-actions">
          <button
            className="primary-button"
            disabled={isSubmitting || !draft.title.trim()}
            type="submit"
          >
            Todoを追加
          </button>
        </div>
      </form>

      <div className="todo-section-list">
        {TODO_STATUS_SECTIONS.map((section) => {
          const sectionTodos = todosByStatus[section.status];

          return (
            <section className="todo-status-section" key={section.status}>
              <div className="todo-status-section-head">
                <h3>{section.label}</h3>
                <span className="todo-section-count">{sectionTodos.length}</span>
              </div>
              {sectionTodos.length > 0 ? (
                <div className="todo-list todo-view-list">
                  {sectionTodos.map(renderTodo)}
                </div>
              ) : (
                <p className="empty-copy todo-empty">Todoはありません。</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
