import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlannerDataState, type UsePlannerDataStateResult } from '../hooks/usePlannerDataState';
import { createLocalFixture, deferred, todo } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import { TodoView } from './TodoView';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
const originalTodo = todo({ status: 'open', scheduledPlanId: null, dueDate: null, dueTime: null, pinned: false });
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() {
  state = usePlannerDataState({ userId: 'owner', showNotice: () => undefined });
  return <TodoView userId="owner" selectedDate={state.selectedDate} todos={state.todos}
    onSaveTodo={state.saveTodo} onScheduleTodo={state.scheduleTodoAsPlan} onDeleteTodo={state.deleteTodo} />;
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
function field(root: ReactTestInstance, name: string) {
  return root.findAllByType('label').find(node => node.findAllByType('span').some(span => span.children.includes(name)))!
    .find(node => ['input', 'select', 'textarea'].includes(String(node.type)));
}
function change(name: string, value: string) {
  act(() => field(renderer!.root, name).props.onChange({ target: { value } }));
}

it.each(['edit', 'schedule'] as const)('retains failed Todo %s input through real rollback and persists one explicit retry', async operation => {
  const { repository } = createLocalFixture();
  await repository.upsertTodo(originalTodo);
  boundary.repository = { ...repository };
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  act(() => renderer!.root.findByProps({ 'aria-label': operation === 'edit' ? '編集' : '予定にする' }).props.onClick());
  if (operation === 'edit') {
    change('タイトル', '失敗しても残す課題');
    change('教科', '英語');
    change('メモ', '入力した補足を保持');
    change('締切日', '2026-10-23');
    change('締切時刻', '18:45');
    change('所要時間（分）', '75');
  } else {
    change('日付', '2026-10-23');
    change('開始時刻', '18:45');
    act(() => renderer!.root.findAllByType('button').find(node => node.children.includes('自由'))!.props.onClick());
    change('自由入力（分）', '75');
  }
  const gate = deferred();
  const method = operation === 'edit' ? 'upsertTodo' : 'scheduleTodoPlan';
  const write = vi.fn(boundary.repository[method] as (...args: unknown[]) => Promise<void>);
  write.mockImplementationOnce(async () => { await gate.promise; });
  Object.assign(boundary.repository, { [method]: write });
  const submit = renderer!.root.findByType('form').props.onSubmit;
  await act(async () => { submit({ preventDefault() {} }); submit({ preventDefault() {} }); });
  expect(write).toHaveBeenCalledTimes(1);
  const stayedOpenWhilePending = renderer!.root.findAllByType('form').length === 1;
  await act(async () => { gate.reject(new Error('controlled save failure')); });
  expect(await repository.getTodos('owner')).toEqual([originalTodo]);
  expect(await repository.getPlans('owner')).toEqual([]);
  expect.soft(stayedOpenWhilePending).toBe(true);
  expect(renderer!.root.findAllByType('form')).toHaveLength(1);
  expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('controlled save failure');
  expect(field(renderer!.root, operation === 'edit' ? 'タイトル' : '開始時刻').props.value)
    .toBe(operation === 'edit' ? '失敗しても残す課題' : '18:45');
  if (operation === 'edit') {
    expect(field(renderer!.root, 'メモ').props.value).toBe('入力した補足を保持');
    expect(field(renderer!.root, '締切日').props.value).toBe('2026-10-23');
  } else {
    expect(field(renderer!.root, '日付').props.value).toBe('2026-10-23');
    expect(field(renderer!.root, '自由入力（分）').props.value).toBe('75');
  }
  await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  expect(write).toHaveBeenCalledTimes(2);
  expect(renderer!.root.findAllByType('form')).toHaveLength(0);
  const savedTodos = await repository.getTodos('owner');
  const savedPlans = await repository.getPlans('owner');
  expect(savedTodos).toHaveLength(1);
  if (operation === 'edit') {
    expect(savedTodos[0]).toMatchObject({ id: originalTodo.id, title: '失敗しても残す課題', subject: '英語',
      memo: '入力した補足を保持', dueDate: '2026-10-23', dueTime: '18:45', estimatedMinutes: 75 });
    expect(savedPlans).toEqual([]);
  } else {
    expect(savedPlans).toHaveLength(1);
    expect(savedPlans[0]).toMatchObject({ date: '2026-10-23', startTime: '18:45', endTime: '20:00', sourceId: originalTodo.id });
    expect(savedTodos[0]).toMatchObject({ status: 'scheduled', scheduledPlanId: savedPlans[0].id });
  }
  expect(state.todos).toEqual(savedTodos);
  expect(state.plans).toEqual(savedPlans);
});
