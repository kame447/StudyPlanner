import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PLAN_TYPE_OPTIONS, getPlanTypeLabel } from '../lib/plans';
import type { PlanType, TodoTask, TodoTaskDraft } from '../types/domain';

interface TodoListPanelProps {
  userId: string;
  todos: TodoTask[];
  onSaveTodo: (draft: TodoTaskDraft) => Promise<void>;
  onDeleteTodo: (todo: TodoTask) => Promise<void>;
}

const TODO_STATUS_LABELS: Record<TodoTask['status'], string> = {
  open: '未配置',
  scheduled: '予定済み',
  done: '完了',
  archived: 'アーカイブ',
};

function getTodoStatusClass(status: TodoTask['status']): string {
  return `todo-lozenge todo-status-${status}`;
}

function createEmptyTodoDraft(userId: string): TodoTaskDraft {
  return {
    userId,
    title: '',
    subject: '',
    type: 'study',
    estimatedMinutes: null,
    dueDate: null,
    dueTime: null,
    memo: '',
  };
}

function formatTodoDue(todo: TodoTask): string | null {
  if (todo.dueDate && todo.dueTime) {
    return `${todo.dueDate} ${todo.dueTime}`;
  }

  return todo.dueDate ?? todo.dueTime ?? null;
}

export function TodoListPanel({
  userId,
  todos,
  onSaveTodo,
  onDeleteTodo,
}: TodoListPanelProps) {
  const [draft, setDraft] = useState<TodoTaskDraft>(() =>
    createEmptyTodoDraft(userId),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const visibleTodos = todos.filter((todo) => todo.status !== 'archived');

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

  function updateDraft<K extends keyof TodoTaskDraft>(
    key: K,
    value: TodoTaskDraft[K],
  ) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <section className="panel todo-panel print-hide">
      <div className="section-header todo-panel-header">
        <div>
          <h2>Todo</h2>
        </div>
      </div>

      <form className="todo-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>タイトル</span>
          <input
            value={draft.title}
            onChange={(event) => updateDraft('title', event.target.value)}
            placeholder="未配置タスク"
          />
        </label>

        <div className="form-grid compact todo-form-grid">
          <label className="field">
            <span>科目</span>
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
            <span>目安分</span>
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
            <span>期限</span>
            <input
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(event) =>
                updateDraft('dueDate', event.target.value || null)
              }
            />
          </label>

          <label className="field">
            <span>期限時刻</span>
            <input
              type="time"
              value={draft.dueTime ?? ''}
              onChange={(event) =>
                updateDraft('dueTime', event.target.value || null)
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
            <Plus aria-hidden="true" size={20} strokeWidth={1.9} />
            追加
          </button>
        </div>
      </form>

      <div className="todo-list">
        {visibleTodos.length > 0 ? (
          visibleTodos.map((todo) => {
            const dueLabel = formatTodoDue(todo);

            return (
              <article className="todo-item" key={todo.id}>
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
                    {dueLabel ? (
                      <span className="todo-tag todo-date-tag">{dueLabel}</span>
                    ) : null}
                  </div>
                  {todo.memo ? <p>{todo.memo}</p> : null}
                </div>
                <button
                  className="ghost-button todo-delete-button"
                  onClick={() => {
                    void onDeleteTodo(todo);
                  }}
                  aria-label={`${todo.title}を削除`}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={18} strokeWidth={1.9} />
                  削除
                </button>
              </article>
            );
          })
        ) : (
          <p className="empty-copy todo-empty">Todoはありません。</p>
        )}
      </div>
    </section>
  );
}
