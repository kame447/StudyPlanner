import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlanDraftFromPlan } from '../domain/planner';
import * as ids from '../lib/id';
import { createLocalFixture, deferred, plan, todo } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const showNotice = vi.fn();
const T = todo({ status: 'open', scheduledPlanId: null, dueTime: null, pinned: false });
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness({ owner = 'owner' }: { owner?: string | null }) {
  state = usePlannerDataState({ userId: owner, showNotice }); return null;
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); showNotice.mockClear(); });
async function mount() {
  const fixture = createLocalFixture();
  await fixture.repository.upsertTodo(T);
  boundary.repository = { ...fixture.repository };
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}
const operations = ['edit', 'schedule', 'delete'] as const;
type Operation = typeof operations[number];
function run(target: UsePlannerDataStateResult, operation: Operation) {
  if (operation === 'edit') return target.saveTodo({ ...T, title: 'edited' }, T.id);
  if (operation === 'schedule') return target.scheduleTodoAsPlan(T, createPlanDraftFromPlan(plan()));
  return target.deleteTodo(T);
}

it.each(operations.flatMap(operation => [false, true].map(retained => ({ operation, retained }))))(
  'rejects a deleted Todo $operation with retained callback=$retained', async ({ operation, retained }) => {
    const { repository, storage } = await mount();
    const captured = state;
    await repository.deleteTodo('owner', T.id);
    await act(async () => { await state.loadPlannerData('owner'); });
    expect(state.todos).toEqual([]);
    const writes = vi.spyOn(storage, 'setItem');
    let error: unknown;
    await act(async () => { try { await run(retained ? captured : state, operation); } catch (caught) { error = caught; } });
    // Check the real persisted result even when the missing-target error fails.
    const durable = { todos: await repository.getTodos('owner'), plans: await repository.getPlans('owner') };
    expect.soft(durable).toEqual({ todos: [], plans: [] });
    expect.soft(writes).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(Error);
    expect(showNotice).toHaveBeenLastCalledWith(expect.stringContaining('Todo'), 'error');
  },
);

it.each(['edit', 'schedule'] as const)('rejects Todo %s while its delete is awaiting persistence', async operation => {
  const { repository } = await mount();
  const entered = deferred(), release = deferred();
  const original = boundary.repository.deleteTodo;
  boundary.repository.deleteTodo = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const captured = state;
  let deleting!: Promise<void>;
  await act(async () => { deleting = state.deleteTodo(T); await entered.promise; });
  let error: unknown;
  await act(async () => { try { await run(captured, operation); } catch (caught) { error = caught; } });
  await act(async () => { release.resolve(); await deleting; });
  expect.soft(await repository.getPlans('owner')).toEqual([]);
  expect.soft(await repository.getTodos('owner')).toEqual([]);
  expect(error).toBeInstanceOf(Error);
});


it('keeps new creation without an edit ID and valid edits/scheduling available', async () => {
  const { repository } = await mount();
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = T;
  await act(async () => { await state.saveTodo({ ...draft, title: 'new Todo' }); });
  const created = (await repository.getTodos('owner')).find(row => row.id !== T.id)!;
  expect(created).toMatchObject({ title: 'new Todo', userId: 'owner' });
  expect(created.id).not.toBe(T.id);
  await act(async () => { await state.saveTodo({ ...draft, title: 'edited existing' }, T.id); });
  expect((await repository.getTodos('owner')).find(row => row.id === T.id)?.title).toBe('edited existing');
  await act(async () => { await state.scheduleTodoAsPlan(state.todos.find(row => row.id === T.id)!, createPlanDraftFromPlan(plan())); });
  const plans = await repository.getPlans('owner');
  expect(plans).toHaveLength(1);
  expect((await repository.getTodos('owner')).find(row => row.id === T.id)).toMatchObject({
    status: 'scheduled', scheduledPlanId: plans[0].id, title: 'edited existing',
  });
});

it.each(operations.flatMap(first => operations.map(second => ({ first, second }))))(
  'blocks a second $second while $first is pending, without blocking another Todo', async ({ first, second }) => {
    const { repository } = await mount();
    const other = { ...T, id: 'other', title: 'Other Todo' };
    await repository.upsertTodo(other);
    await act(async () => { await state.loadPlannerData('owner'); });
    const method = ({ edit: 'upsertTodo', schedule: 'scheduleTodoPlan', delete: 'deleteTodo' } as const)[first];
    const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
    const entered = deferred(), release = deferred();
    let firstCall = true;
    Object.assign(boundary.repository, { [method]: async (...args: Parameters<typeof original>) => {
      if (firstCall) { firstCall = false; entered.resolve(); await release.promise; }
      return original(...args);
    } });
    const captured = state;
    let pending!: Promise<unknown>;
    await act(async () => { pending = run(captured, first); await entered.promise; });
    await act(async () => { await expect(run(captured, second)).rejects.toThrow('保存・更新中'); });
    await act(async () => { await state.saveTodo({ ...other, title: 'Independent edit' }, other.id); });
    expect((await repository.getTodos('owner')).find(row => row.id === other.id)?.title).toBe('Independent edit');
    await act(async () => { release.resolve(); await pending; });
    expect(state.todos).toEqual(await repository.getTodos('owner'));
    expect(state.plans).toEqual(await repository.getPlans('owner'));
  },
);

it.each(operations)('releases a rejected %s only after rollback publication and permits an explicit retry', async operation => {
  const { repository } = await mount();
  const method = ({ edit: 'upsertTodo', schedule: 'scheduleTodoPlan', delete: 'deleteTodo' } as const)[operation];
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  Object.assign(boundary.repository, { [method]: vi.fn(original).mockRejectedValueOnce(new Error('Controlled no-write failure')) });
  await act(async () => { await expect(run(state, operation)).rejects.toThrow('Controlled no-write failure'); });
  expect(state.todos).toEqual([T]);
  expect(await repository.getTodos('owner')).toEqual([T]);
  await act(async () => { await run(state, operation); });
  expect(state.todos).toEqual(await repository.getTodos('owner'));
  expect(state.plans).toEqual(await repository.getPlans('owner'));
});

it.each(['signout', 'owner-switch', 'reset'] as const)('revokes retained Todo commands across %s', async transition => {
  const { repository, storage } = await mount();
  const captured = state;
  await act(async () => {
    if (transition === 'reset') state.resetPlannerData();
    else renderer!.update(<Harness owner={transition === 'signout' ? null : 'other-owner'} />);
  });
  const writes = vi.spyOn(storage, 'setItem');
  for (const operation of operations) await act(async () => { await expect(run(captured, operation)).rejects.toThrow('アカウントまたはデータ'); });
  expect(writes).not.toHaveBeenCalled();
  expect(await repository.getTodos('owner')).toEqual([T]);
  expect(await repository.getPlans('owner')).toEqual([]);
  expect(await repository.getTodos('other-owner')).toEqual([]);
});

it('rejects another owner payload even when it carries an existing Todo ID', async () => {
  const { repository, storage } = await mount();
  const writes = vi.spyOn(storage, 'setItem');
  await act(async () => { await expect(state.saveTodo({ ...T, userId: 'other' }, T.id)).rejects.toThrow(); });
  await act(async () => { await expect(state.saveTodo({ ...T, userId: 'other' })).rejects.toThrow(); });
  await act(async () => { await expect(state.deleteTodo({ ...T, userId: 'other' })).rejects.toThrow(); });
  await act(async () => { await expect(state.scheduleTodoAsPlan({ ...T, userId: 'other' }, createPlanDraftFromPlan(plan()))).rejects.toThrow(); });
  await act(async () => { await expect(state.scheduleTodoAsPlan(T, createPlanDraftFromPlan(plan({ userId: 'other' })))).rejects.toThrow(); });
  expect(writes).not.toHaveBeenCalled();
  expect(await repository.getTodos('owner')).toEqual([T]);
});


it.each(['schedule', 'delete'] as const)('uses current Todo metadata for retained %s, including Undo', async operation => {
  const { repository } = await mount();
  const captured = state;
  const current = { ...T, title: 'Latest canonical title', memo: 'Latest memo', pinned: true };
  await repository.upsertTodo(current);
  await act(async () => { await state.loadPlannerData('owner'); });
  await act(async () => { await run(captured, operation); });
  if (operation === 'delete') {
    const undo = showNotice.mock.calls.find(call => call[0] === '削除しました')?.[2]?.onAction;
    expect(undo).toBeTypeOf('function');
    await act(async () => { await undo(); });
  }
  expect((await repository.getTodos('owner'))[0]).toMatchObject({ title: current.title, memo: current.memo, pinned: true });
  expect(state.todos).toEqual(await repository.getTodos('owner'));
});

it('keeps a new owner admission independent of an old pending Todo completion', async () => {
  const { repository } = await mount();
  const other = { ...T, id: 'other-owner-todo', userId: 'other-owner' };
  await repository.upsertTodo(other);
  const release = deferred();
  const original = boundary.repository.upsertTodo;
  boundary.repository.upsertTodo = async row => { if (row.userId === 'owner') await release.promise; return original(row); };
  let old!: Promise<unknown>;
  await act(async () => { old = state.saveTodo({ ...T, title: 'old completion' }, T.id).catch(error => error); });
  await act(async () => { renderer!.update(<Harness owner="other-owner" />); });
  await act(async () => { await state.loadPlannerData('other-owner'); });
  await act(async () => { await state.saveTodo({ ...other, title: 'new owner' }, other.id); });
  await act(async () => { release.resolve(); expect(await old).toBeInstanceOf(Error); });
  expect(state.todos).toEqual(await repository.getTodos('other-owner'));
  expect(state.todos[0].title).toBe('new owner');
  expect((await repository.getTodos('owner'))[0].title).toBe('old completion');
});


it('releases Todo admission when Plan ID generation fails before repository dispatch', async () => {
  const { repository } = await mount();
  const writes = vi.spyOn(boundary.repository, 'scheduleTodoPlan');
  vi.spyOn(ids, 'createId').mockImplementationOnce(() => { throw new Error('ID generation unavailable'); });
  await act(async () => { await expect(run(state, 'schedule')).rejects.toThrow('ID generation unavailable'); });
  expect(writes).not.toHaveBeenCalled();
  expect(state.todos).toEqual(await repository.getTodos('owner'));
  await act(async () => { await run(state, 'schedule'); });
  expect(writes).toHaveBeenCalledTimes(1);
  expect(await repository.getPlans('owner')).toHaveLength(1);
  expect(state.todos).toEqual(await repository.getTodos('owner'));
});


const cases = (['pending', 'failed'] as const).flatMap(repair => (['edit', 'schedule', 'delete'] as const).flatMap(operation => [false, true].map(retained => ({ repair, operation, retained }))));
it.each(cases)('blocks $operation while crossing-read repair is $repair, retained=$retained', async ({ repair, operation, retained }) => {
 const { repository, storage } = await mount();
 const captured = state;
 const deleteRelease = deferred();
 const originalDelete = boundary.repository.deleteTodo;
 boundary.repository.deleteTodo = async (...args) => { await deleteRelease.promise; return originalDelete(...args); };
 let deleting!: Promise<void>;
 await act(async () => { deleting = state.deleteTodo(T); });
 expect(state.todos).toEqual([]);
 await act(async () => { await state.loadPlannerData('owner'); });
 expect(state.todos).toEqual([T]);
 const repairRelease = deferred();
 const originalGet = boundary.repository.getTodos;
 boundary.repository.getTodos = async owner => {
   if (repair === 'failed') throw new Error('controlled repair offline');
   await repairRelease.promise;
   return originalGet(owner);
 };
 await act(async () => { deleteRelease.resolve(); await deleting; });
 expect(await repository.getTodos('owner')).toEqual([]);
 expect(state.todos).toEqual([T]);
 expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
 const writes = vi.spyOn(storage, 'setItem');
 let error: unknown;
 await act(async () => { try { const target = retained ? captured : state; if (operation === 'edit') await target.saveTodo({ ...T, title: 'resurrected' }, T.id); else if (operation === 'schedule') await target.scheduleTodoAsPlan(T, createPlanDraftFromPlan(plan())); else await target.deleteTodo(T); } catch (caught) { error = caught; } });
 expect.soft(error).toBeInstanceOf(Error);
 expect.soft(writes).not.toHaveBeenCalled();
 expect.soft(await repository.getTodos('owner')).toEqual([]);
 expect.soft(await repository.getPlans('owner')).toEqual([]);
 boundary.repository.getTodos = originalGet;
 await act(async () => { repairRelease.resolve(); });
});

it.each((['edit', 'schedule', 'delete'] as const).flatMap(operation => [false, true].map(retained => ({ operation, retained }))))('allows $operation on an accepted baseline during an ordinary refresh, retained=$retained', async ({ operation, retained }) => {
 const { repository } = await mount();
 const captured = state;
 const release = deferred(), entered = deferred();
 const originalGet = boundary.repository.getTodos;
 let first = true;
 boundary.repository.getTodos = async owner => {
  const rows = await originalGet(owner);
  if (first) { first = false; entered.resolve(); await release.promise; }
  return rows;
 };
 let loading!: Promise<void>;
 await act(async () => { loading = state.loadPlannerData('owner'); await entered.promise; });
 expect(state.plannerDataAvailability.status).toBe('loading');
 const target = retained ? captured : state;
 let error: unknown;
 await act(async () => { try {
  if (operation === 'edit') await target.saveTodo({ ...T, title: 'allowed during ordinary refresh' }, T.id);
  else if (operation === 'schedule') await target.scheduleTodoAsPlan(T, createPlanDraftFromPlan(plan()));
  else await target.deleteTodo(T);
 } catch (caught) { error = caught; } });
 expect.soft(error).toBeUndefined();
 await act(async () => { release.resolve(); await loading; });
 const storedTodos = await repository.getTodos('owner');
 if (operation === 'edit') expect(storedTodos[0].title).toBe('allowed during ordinary refresh');
 else if (operation === 'delete') expect(storedTodos).toEqual([]);
 else expect((await repository.getPlans('owner'))).toHaveLength(1);
 expect(state.todos).toEqual(storedTodos);
 expect(state.plannerDataAvailability.status).toBe('ready');
});

it('reopens a retained command after failed repair is retried and committed', async () => {
 const { repository } = await mount();
 const captured = state;
 const release = deferred();
 const originalWrite = boundary.repository.upsertTodo;
 boundary.repository.upsertTodo = async row => { await release.promise; return originalWrite(row); };
 let editing!: Promise<void>;
 await act(async () => { editing = state.saveTodo({ ...T, title: 'latest persisted title' }, T.id); });
 await act(async () => { await state.loadPlannerData('owner'); });
 const originalGet = boundary.repository.getTodos;
 boundary.repository.getTodos = async () => { throw new Error('controlled repair failure'); };
 await act(async () => { release.resolve(); await editing; });
 expect(state.plannerDataRecovery?.phase).toBe('failed');
 boundary.repository.getTodos = originalGet;
 await act(async () => { await state.retryPlannerData(); });
 expect(state.plannerDataAvailability.status).toBe('ready');
 await act(async () => { await captured.scheduleTodoAsPlan(T, createPlanDraftFromPlan(plan())); });
 expect((await repository.getTodos('owner'))[0]).toMatchObject({ title: 'latest persisted title', status: 'scheduled' });
 expect(state.todos).toEqual(await repository.getTodos('owner'));
});


it.each(operations.flatMap(operation => [false, true].map(retained => ({ operation, retained }))))(
  'keeps $operation blocked during retry after full-read failure, retained=$retained', async ({ operation, retained }) => {
    const { repository, storage } = await mount();
    const captured = state;
    await repository.deleteTodo('owner', T.id);
    const originalGet = boundary.repository.getTodos;
    boundary.repository.getTodos = vi.fn(originalGet).mockRejectedValueOnce(new Error('full read offline'));
    await act(async () => { await state.loadPlannerData('owner').catch(() => undefined); });
    expect(state.plannerDataAvailability.status).toBe('stale');
    expect(state.todos).toEqual([T]);
    const release = deferred(), entered = deferred();
    boundary.repository.getTodos = async owner => { entered.resolve(); await release.promise; return originalGet(owner); };
    let retry!: Promise<void>;
    await act(async () => { retry = state.retryPlannerData(); await entered.promise; });
    expect(state.plannerDataAvailability.status).toBe('loading');
    const writes = vi.spyOn(storage, 'setItem');
    await act(async () => { await expect(run(retained ? captured : state, operation)).rejects.toThrow('再読み込み'); });
    expect(writes).not.toHaveBeenCalled();
    expect(await repository.getTodos('owner')).toEqual([]);
    expect(await repository.getPlans('owner')).toEqual([]);
    await act(async () => { release.resolve(); await retry; });
    expect(state.plannerDataAvailability.status).toBe('ready');
    expect(state.todos).toEqual([]);
  },
);
