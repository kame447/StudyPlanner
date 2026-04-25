import { useMemo } from 'react';
import { getPlanTypeLabel } from '../lib/plans';
import type { TodoStatus, TodoTask } from '../types/domain';

interface TodoViewProps {
  todos: TodoTask[];
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

function compareTodos(left: TodoTask, right: TodoTask): number {
  const leftDueDate = left.dueDate ?? '9999-12-31';
  const rightDueDate = right.dueDate ?? '9999-12-31';
  const dueDateDelta = leftDueDate.localeCompare(rightDueDate);

  if (dueDateDelta !== 0) {
    return dueDateDelta;
  }

  const leftDueTime = left.dueTime ?? '23:59';
  const rightDueTime = right.dueTime ?? '23:59';
  const dueTimeDelta = leftDueTime.localeCompare(rightDueTime);

  if (dueTimeDelta !== 0) {
    return dueTimeDelta;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function getTodoStatusClass(status: TodoStatus): string {
  return `todo-lozenge todo-status-${status}`;
}

function formatTodoDue(todo: TodoTask): string | null {
  if (todo.dueDate && todo.dueTime) {
    return `期限 ${todo.dueDate} ${todo.dueTime}`;
  }

  if (todo.dueDate) {
    return `期限 ${todo.dueDate}`;
  }

  if (todo.dueTime) {
    return `締切 ${todo.dueTime}`;
  }

  return null;
}

export function TodoView({ todos, onDeleteTodo }: TodoViewProps) {
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

  function renderTodo(todo: TodoTask) {
    const dueLabel = formatTodoDue(todo);

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
