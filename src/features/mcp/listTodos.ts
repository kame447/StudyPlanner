import type { PlanType, TodoStatus, TodoTask } from '../../types/domain';

/**
 * Rows one port call may return. The server-side query stops here without saying so, so a result this large cannot be
 * told apart from a cut-off one and is refused rather than returned as if complete.
 */
export const TODO_PORT_ROW_LIMIT = 500;

/**
 * Read port for one owner's todos. An implementation must filter by an equality on `userId` in the query itself (never
 * read the whole collection), and must not trigger migration or any write. It is not composed anywhere yet.
 */
export interface TodoReadPort { listTodosByOwner(ownerId: string): Promise<TodoTask[]> }

/** Minimal fields only. `memo` (free text), `scheduledPlanId` (internal link) and `userId` are deliberately not returned. */
export interface TodoListItem {
  id: string; title: string; subject: string; type: PlanType; estimatedMinutes: number | null;
  dueDate: string | null; dueTime: string | null; status: TodoStatus; pinned: boolean;
}
export interface TodoListResult { todos: TodoListItem[] }
export type ListTodos = (actorOwnerId: string, input: unknown) => Promise<TodoListResult>;

export class TodoListError extends Error {
  constructor(readonly code: 'owner_mismatch' | 'invalid_input' | 'source_unavailable') {
    super(code);
    this.name = 'TodoListError';
  }
}

/** A capability for one owner. Takes no arguments: the owner comes only from the authenticated actor. */
export function createTodoLister(source: { ownerId: string; port: TodoReadPort }): ListTodos {
  return async (actorOwnerId, input) => {
    if (!actorOwnerId || actorOwnerId !== source.ownerId) throw new TodoListError('owner_mismatch');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 0) throw new TodoListError('invalid_input');
    let records: TodoTask[];
    try { records = await source.port.listTodosByOwner(actorOwnerId); }
    catch { throw new TodoListError('source_unavailable'); }
    if (records.length >= TODO_PORT_ROW_LIMIT) throw new TodoListError('source_unavailable');
    // Repository identity is a trust boundary: reject the whole result rather than omit foreign records.
    if (records.some(record => record.userId !== actorOwnerId)) throw new TodoListError('owner_mismatch');
    // Soonest due first, undated last; id breaks ties so the order is deterministic.
    const sorted = [...records].sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99')
      || (a.dueTime ?? '').localeCompare(b.dueTime ?? '') || a.id.localeCompare(b.id));
    return { todos: sorted.map(record => ({ id: record.id, title: record.title, subject: record.subject, type: record.type,
      estimatedMinutes: record.estimatedMinutes, dueDate: record.dueDate, dueTime: record.dueTime ?? null,
      status: record.status, pinned: record.pinned === true })) };
  };
}
