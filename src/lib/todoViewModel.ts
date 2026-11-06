import type { TodoTask } from '../types/domain';

export type TodoSortDirection = 'asc' | 'desc';

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

/** Selects visible sections without changing task objects or the source order. */
export function groupTodoTasks(todos: readonly TodoTask[], userId: string, sortDirection: TodoSortDirection) {
  const visibleTodos = todos.filter((todo) =>
    todo.userId === userId && todo.status !== 'archived',
  );
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
        comparePinnedTodos(left, right, (leftTodo, rightTodo) =>
          rightTodo.updatedAt.localeCompare(leftTodo.updatedAt),
        ),
      ),
    done: visibleTodos
      .filter((todo) => todo.status === 'done')
      .sort((left, right) => compareDueTodos(left, right, sortDirection)),
  };
}
