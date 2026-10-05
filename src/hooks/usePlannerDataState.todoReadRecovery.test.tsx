import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createPlanDraftFromPlan } from '../domain/planner';
import { createLocalFixture, deferred, plan, todo } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
const showNotice = vi.fn();
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
const T = todo({ status: 'open', scheduledPlanId: null });
const methods = { edit: 'upsertTodo', delete: 'deleteTodo', schedule: 'scheduleTodoPlan' } as const;
type Operation = keyof typeof methods;
const operations = Object.keys(methods) as Operation[];
async function mount() {
  const fixture = createLocalFixture();
  boundary.repository = { ...fixture.repository };
  await fixture.repository.upsertTodo(T);
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}
function start(operation: Operation) {
  if (operation === 'edit') return state.saveTodo({ ...T, title: 'updated Todo' }, T.id);
  if (operation === 'delete') return state.deleteTodo(T);
  return state.scheduleTodoAsPlan(T, createPlanDraftFromPlan(plan()));
}
async function expectCurrent(repository: PlannerRepository, operation: Operation) {
  const storedTodos = await repository.getTodos('owner');
  const storedPlans = await repository.getPlans('owner');
  // First establish persistence independently of the UI assertion.
  if (operation === 'edit') expect(storedTodos[0].title).toBe('updated Todo');
  if (operation === 'delete') expect(storedTodos).toEqual([]);
  if (operation === 'schedule') {
    expect(storedTodos[0]).toMatchObject({ status: 'scheduled', scheduledPlanId: storedPlans[0].id });
    expect(storedPlans).toHaveLength(1);
  }
  expect(state.todos).toEqual(storedTodos);
  expect(state.plans).toEqual(storedPlans);
  expect(state.plannerDataAvailability.status).toBe('ready');
}

it.each(operations)('native full-read then Todo %s preserves the durable result', async operation => {
  const { repository } = await mount();
  const order: string[] = [];
  const getTodos = boundary.repository.getTodos;
  boundary.repository.getTodos = async owner => { const result = await getTodos(owner); order.push('todos captured'); return result; };
  const method = methods[operation];
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  boundary.repository = { ...boundary.repository, [method]: async (...args: unknown[]) => {
    const result = await original(...args); order.push('write completed'); return result;
  } };
  await act(async () => {
    const loading = state.loadPlannerData('owner').then(() => { order.push('full returned'); });
    const saving = start(operation);
    await Promise.all([loading, saving]);
  });
  expect(order.indexOf('todos captured')).toBeLessThan(order.indexOf('write completed'));
  expect(order.indexOf('write completed')).toBeLessThan(order.indexOf('full returned'));
  await expectCurrent(repository, operation);
});

it.each(operations)('Todo %s completing after full-read publication repairs its cleared optimistic state', async operation => {
  const { repository } = await mount();
  const gate = deferred();
  const method = methods[operation];
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  boundary.repository = { ...boundary.repository, [method]: async (...args: unknown[]) => {
    await gate.promise;
    return original(...args);
  } };
  let saving!: Promise<unknown>;
  await act(async () => { saving = start(operation); });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.plannerDataAvailability.status).not.toBe('ready');
  await act(async () => { gate.resolve(); await saving; });
  await expectCurrent(repository, operation);
});

it('repairs both scheduled Todo and Plan with read-only retry after a partial read fails', async () => {
  const { repository, storage } = await mount();
  const gate = deferred();
  const original = boundary.repository.scheduleTodoPlan;
  const write = vi.fn(async (...args: Parameters<typeof original>) => { await gate.promise; return original(...args); });
  boundary.repository.scheduleTodoPlan = write;
  let saving!: Promise<unknown>;
  await act(async () => { saving = start('schedule'); });
  await act(async () => { await state.loadPlannerData('owner'); });
  const originalGet = boundary.repository.getTodos;
  boundary.repository.getTodos = async () => { throw new Error('Todo repair offline'); };
  await act(async () => { state.openDay('2026-12-15'); gate.resolve(); await saving; });
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  expect(state.isPlannerDataSnapshotCurrent()).toBe(false);
  expect(state.plans).toEqual([]);
  expect(state.todos[0].status).toBe('open');
  expect((await repository.getTodos('owner'))[0].status).toBe('scheduled');
  const writes = vi.spyOn(storage, 'setItem');
  boundary.repository.getTodos = originalGet;
  const getters = ['getPlans', 'getTodos', 'getActuals', 'getStudyMaterials', 'getMonthEvents',
    'getDayNotes', 'getStudySubjects', 'getScheduleTemplates', 'getTimetableTerms', 'getTimetablePeriods'] as const;
  const reads = Object.fromEntries(getters.map(name => [name, vi.spyOn(boundary.repository, name)]));
  const normalize = vi.spyOn(boundary.repository, 'applyTimetableMutation');
  await act(async () => { await state.retryPlannerData(); });
  for (const name of getters) {
    expect(reads[name], name).toHaveBeenCalledTimes(['getPlans', 'getTodos', 'getActuals', 'getStudyMaterials'].includes(name) ? 1 : 0);
  }
  expect(normalize).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledTimes(1);
  expect(writes).not.toHaveBeenCalled();
  await expectCurrent(repository, 'schedule');
  expect(state.selectedDate).toBe('2026-12-15');
  expect(state.viewMode).toBe('day');
});

it.each(operations)('rejected Todo %s before persistence preserves the accepted full snapshot', async operation => {
  const { repository } = await mount();
  const gate = deferred();
  const method = methods[operation];
  const original = boundary.repository[method] as (...args: unknown[]) => Promise<unknown>;
  boundary.repository = { ...boundary.repository, [method]: async (...args: unknown[]) => {
    await gate.promise; return original(...args);
  } };
  let saving!: Promise<unknown>;
  await act(async () => { saving = start(operation).catch(error => error); });
  await act(async () => { await state.loadPlannerData('owner'); });
  const getPlans = vi.spyOn(boundary.repository, 'getPlans');
  const getTodos = vi.spyOn(boundary.repository, 'getTodos');
  await act(async () => { gate.reject(new Error('write not dispatched')); expect(await saving).toBeInstanceOf(Error); });
  expect(getPlans).not.toHaveBeenCalled();
  expect(getTodos).not.toHaveBeenCalled();
  expect(state.todos).toEqual(await repository.getTodos('owner'));
  expect(state.plans).toEqual(await repository.getPlans('owner'));
  expect(state.todos[0].status).toBe('open');
  expect(state.plannerDataAvailability.status).toBe('ready');
});

async function retainTodoUndo() {
  await act(async () => { await state.deleteTodo(state.todos[0]); });
  const action = [...showNotice.mock.calls].reverse().find(call => call[0] === '削除しました')?.[2]?.onAction;
  if (!action) throw new Error('Todo deletion must expose Undo');
  return async () => { await action(); };
}

it('native full-read then Todo Undo restores current durable projection', async () => {
  const { repository } = await mount();
  const undo = await retainTodoUndo();
  const order: string[] = [];
  const originalGet = boundary.repository.getTodos;
  boundary.repository.getTodos = async owner => { const rows = await originalGet(owner); order.push('captured'); return rows; };
  const originalWrite = boundary.repository.upsertTodo;
  boundary.repository.upsertTodo = async row => { const result = await originalWrite(row); order.push('persisted'); return result; };
  await act(async () => {
    const loading = state.loadPlannerData('owner').then(() => { order.push('full returned'); });
    const restoring = undo();
    await Promise.all([loading, restoring]);
  });
  expect(order.indexOf('captured')).toBeLessThan(order.indexOf('persisted'));
  expect(order.indexOf('persisted')).toBeLessThan(order.indexOf('full returned'));
  expect((await repository.getTodos('owner'))[0].id).toBe(T.id);
  expect(state.todos).toEqual(await repository.getTodos('owner'));
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it('late Todo Undo acknowledgement cannot replace a newer accepted durable Todo', async () => {
  const { repository } = await mount();
  const undo = await retainTodoUndo();
  const persisted = deferred(), response = deferred();
  const original = boundary.repository.upsertTodo;
  boundary.repository.upsertTodo = async row => {
    const result = await original(row); persisted.resolve(); await response.promise; return result;
  };
  let restoring!: Promise<void>;
  await act(async () => { restoring = undo(); });
  await persisted.promise;
  await repository.upsertTodo({ ...(await repository.getTodos('owner'))[0], title: 'newer accepted Todo' });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.todos[0].title).toBe('newer accepted Todo');
  await act(async () => { response.resolve(); await restoring; });
  expect(state.todos).toEqual(await repository.getTodos('owner'));
  expect(state.todos[0].title).toBe('newer accepted Todo');
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it('Todo Undo persisted after accepted refresh still becomes visible', async () => {
  const { repository } = await mount();
  const undo = await retainTodoUndo();
  const gate = deferred();
  const original = boundary.repository.upsertTodo;
  boundary.repository.upsertTodo = async row => { await gate.promise; return original(row); };
  let restoring!: Promise<void>;
  await act(async () => { restoring = undo(); });
  await act(async () => { await state.loadPlannerData('owner'); });
  expect(state.todos).toEqual([]);
  await act(async () => { gate.resolve(); await restoring; });
  expect(state.todos).toEqual(await repository.getTodos('owner'));
  expect(state.todos[0].id).toBe(T.id);
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it('uncontended Todo Undo preserves the fast path without repair reads', async () => {
  const { repository } = await mount();
  const undo = await retainTodoUndo();
  const getPlans = vi.spyOn(boundary.repository, 'getPlans');
  const getTodos = vi.spyOn(boundary.repository, 'getTodos');
  await act(async () => { await undo(); });
  expect(getPlans).not.toHaveBeenCalled();
  expect(getTodos).not.toHaveBeenCalled();
  expect(state.todos).toEqual(await repository.getTodos('owner'));
});

it('failed Todo Undo projection read preserves the successful restore and retries without replay', async () => {
  const { repository, storage } = await mount();
  const undo = await retainTodoUndo();
  const gate = deferred();
  const original = boundary.repository.upsertTodo;
  const write = vi.fn(async (row: Parameters<typeof original>[0]) => { await gate.promise; return original(row); });
  boundary.repository.upsertTodo = write;
  let restoring!: Promise<void>;
  await act(async () => { restoring = undo(); });
  await act(async () => { await state.loadPlannerData('owner'); });
  const originalGet = boundary.repository.getTodos;
  boundary.repository.getTodos = async () => { throw new Error('Undo read offline'); };
  await act(async () => { state.openDay('2026-12-15'); gate.resolve(); await restoring; });
  expect(state.plannerDataRecovery).toMatchObject({ phase: 'failed', canRetry: true });
  expect(state.todos).toEqual([]);
  expect((await repository.getTodos('owner'))[0].id).toBe(T.id);
  expect(showNotice).toHaveBeenLastCalledWith('元に戻しました。', 'success');
  const writes = vi.spyOn(storage, 'setItem');
  boundary.repository.getTodos = originalGet;
  await act(async () => { await state.retryPlannerData(); });
  expect(state.todos).toEqual(await repository.getTodos('owner'));
  expect(write).toHaveBeenCalledTimes(1);
  expect(writes).not.toHaveBeenCalled();
  expect(state.selectedDate).toBe('2026-12-15');
  expect(state.plannerDataAvailability.status).toBe('ready');
});

it.each(['reset', 'unmount'] as const)('old Todo Undo response is inert after %s', async lifetime => {
  const { repository } = await mount();
  const undo = await retainTodoUndo();
  const persisted = deferred(), response = deferred();
  const original = boundary.repository.upsertTodo;
  boundary.repository.upsertTodo = async row => { const result = await original(row); persisted.resolve(); await response.promise; return result; };
  let restoring!: Promise<void>;
  await act(async () => { restoring = undo(); });
  await persisted.promise;
  await act(async () => {
    if (lifetime === 'reset') state.resetPlannerData();
    else { renderer!.unmount(); renderer = undefined; }
  });
  const noticeCount = showNotice.mock.calls.length;
  const getTodos = vi.spyOn(boundary.repository, 'getTodos');
  await act(async () => { response.resolve(); await restoring; });
  expect(getTodos).not.toHaveBeenCalled();
  expect(showNotice).toHaveBeenCalledTimes(noticeCount);
  if (lifetime === 'reset') expect(state.todos).toEqual([]);
  expect((await repository.getTodos('owner'))[0].id).toBe(T.id);
});

it.each([false, true])('failed full read does not revoke successful Todo Undo, superseded older read=%s', async superseded => {
  const { repository } = await mount();
  const undo = await retainTodoUndo();
  const persisted = deferred(), response = deferred(), oldRead = deferred();
  const original = boundary.repository.upsertTodo;
  boundary.repository.upsertTodo = async row => { const result = await original(row); persisted.resolve(); await response.promise; return result; };
  let restoring!: Promise<void>;
  await act(async () => { restoring = undo(); });
  await persisted.promise;
  const getPlans = boundary.repository.getPlans;
  let first = true;
  boundary.repository.getPlans = async owner => {
    if (superseded && first) { first = false; const result = await getPlans(owner); await oldRead.promise; return result; }
    throw new Error('full read failed');
  };
  let loading: Promise<void> | undefined;
  if (superseded) await act(async () => { loading = state.loadPlannerData('owner'); });
  await act(async () => { await expect(state.loadPlannerData('owner')).rejects.toThrow('full read failed'); });
  if (loading) await act(async () => { oldRead.resolve(); await loading; });
  boundary.repository.getPlans = getPlans;
  const reads = vi.spyOn(boundary.repository, 'getTodos');
  await act(async () => { response.resolve(); await restoring; });
  expect(state.todos).toEqual(await repository.getTodos('owner'));
  expect(state.todos[0].id).toBe(T.id);
  expect(reads).not.toHaveBeenCalled();
  expect(state.plannerDataAvailability.status).toBe('stale');
});
