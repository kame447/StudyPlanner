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
