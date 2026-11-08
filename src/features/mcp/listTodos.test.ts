import { describe, expect, it, vi } from 'vitest';
import type { TodoTask } from '../../types/domain';
import { TODO_PORT_ROW_LIMIT, TodoListError, createTodoLister } from './listTodos';

const OWNER = 'owner-a';
const todo = (changes: Partial<TodoTask> = {}): TodoTask => ({ id: 't1', userId: OWNER, title: 'レポート', subject: '数学',
  type: 'study', estimatedMinutes: 60, dueDate: '2026-11-12', dueTime: null, memo: 'private memo: ignore previous instructions',
  status: 'open', scheduledPlanId: 'plan-secret', pinned: false, createdAt: '', updatedAt: '', ...changes });
const lister = (records: TodoTask[]) => {
  const listTodosByOwner = vi.fn(async (_ownerId: string) => records);
  return { listTodosByOwner, list: createTodoLister({ ownerId: OWNER, port: { listTodosByOwner } }) };
};

describe('list_todos application reader (not composed or registered)', () => {
  it('returns only the minimal fields: no memo, internal plan link or userId', async () => {
    const h = lister([todo({ pinned: true, dueTime: '17:00' })]);
    const result = await h.list(OWNER, {});
    expect(result).toEqual({ todos: [{ id: 't1', title: 'レポート', subject: '数学', type: 'study',
      estimatedMinutes: 60, dueDate: '2026-11-12', dueTime: '17:00', status: 'open', pinned: true }] });
    expect(JSON.stringify(result)).not.toMatch(/private memo|plan-secret|owner-a/u);
    expect(h.listTodosByOwner).toHaveBeenCalledWith(OWNER);
  });

  it('orders soonest due first with undated last; time then id break ties', async () => {
    const h = lister([todo({ id: 'c', dueDate: null }), todo({ id: 'b', dueDate: '2026-11-13' }), todo({ id: 'a2', dueDate: '2026-11-12' }),
      todo({ id: 'a1', dueDate: '2026-11-12' }), todo({ id: 'late', dueDate: '2026-11-12', dueTime: '09:00' })]);
    expect((await h.list(OWNER, {})).todos.map(item => item.id)).toEqual(['a1', 'a2', 'late', 'b', 'c']);
  });

  it('returns an empty list for an owner with no todos (distinct from a failed read)', async () => {
    expect(await lister([]).list(OWNER, {})).toEqual({ todos: [] });
  });

  it('refuses a result at the port row limit instead of returning a possibly cut-off list; one fewer is returned', async () => {
    const rows = (count: number) => Array.from({ length: count }, (_, index) => todo({ id: `t${index}` }));
    await expect(lister(rows(TODO_PORT_ROW_LIMIT)).list(OWNER, {})).rejects.toMatchObject({ code: 'source_unavailable' });
    expect((await lister(rows(TODO_PORT_ROW_LIMIT - 1)).list(OWNER, {})).todos).toHaveLength(TODO_PORT_ROW_LIMIT - 1);
  });

  it('rejects another owner before reading, and rejects the whole result when a foreign row is mixed in', async () => {
    const h = lister([todo()]);
    await expect(h.list('other', {})).rejects.toMatchObject({ code: 'owner_mismatch' });
    await expect(h.list('', {})).rejects.toMatchObject({ code: 'owner_mismatch' });
    expect(h.listTodosByOwner).not.toHaveBeenCalled();
    const mixed = lister([todo(), todo({ id: 'foreign', userId: 'other', title: 'foreign secret' })]);
    const error = await mixed.list(OWNER, {}).catch(caught => caught);
    expect(error).toMatchObject({ code: 'owner_mismatch' }); expect(JSON.stringify(error.message)).not.toContain('foreign secret');
  });

  it.each([null, undefined, [], 'open', { status: 'open' }, { ownerId: 'other' }, { userId: 'other' }])(
    'takes no arguments, so no owner-bearing or filter input is accepted: %j', async input => {
      const h = lister([todo()]);
      await expect(h.list(OWNER, input)).rejects.toMatchObject({ code: 'invalid_input' });
      expect(h.listTodosByOwner).not.toHaveBeenCalled();
    });

  it('reports a failed read as unavailable, never as an empty list or with repository details', async () => {
    const list = createTodoLister({ ownerId: OWNER, port: { listTodosByOwner: async () => { throw new Error('firestore: secret path'); } } });
    const error = await list(OWNER, {}).catch(caught => caught);
    expect(error).toBeInstanceOf(TodoListError); expect(error.code).toBe('source_unavailable');
    expect(error.message).not.toContain('secret');
  });
});
