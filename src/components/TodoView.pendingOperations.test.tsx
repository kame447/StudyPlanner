import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodoTask } from '../types/domain';
import { TodoView } from './TodoView';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function todo(id: string, userId = 'owner'): TodoTask {
  return { id, userId, title: id, subject: '数学', type: 'study', estimatedMinutes: 30,
    dueDate: null, dueTime: null, memo: '', status: 'open', scheduledPlanId: null,
    createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z' };
}
const renderers: ReactTestRenderer[] = [];
function mount() {
  const props = { userId: 'owner', selectedDate: '2026-10-09', todos: [todo('A'), todo('B')],
    onSaveTodo: vi.fn().mockResolvedValue(undefined), onScheduleTodo: vi.fn().mockResolvedValue(undefined),
    onDeleteTodo: vi.fn().mockResolvedValue(undefined) };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<TodoView {...props} />); });
  renderers.push(renderer);
  return { props, renderer, update(userId: string, todos = [todo('A', userId), todo('B', userId)]) {
    props.userId = userId;
    props.todos = todos;
    act(() => renderer.update(<TodoView {...props} />));
  } };
}
function row(root: ReactTestInstance, id: string) {
  return root.findAllByType('article').find(node => node.findByType('strong').children.join('') === id)!;
}
function button(root: ReactTestInstance, id: string, label: string) {
  return row(root, id).findByProps({ 'aria-label': label });
}
function expectBusy(root: ReactTestInstance, id: string, expected: boolean) {
  for (const node of row(root, id).findAllByType('button')) expect(Boolean(node.props.disabled)).toBe(expected);
}
const actions = ['ピン留め', '完了', '編集', '予定にする', '削除'] as const;
type Action = typeof actions[number];
function prepare(root: ReactTestInstance, id: string, action: Action): () => unknown {
  if (action === '編集' || action === '予定にする') {
    act(() => button(root, id, action).props.onClick());
    const submit = root.findByType('form').props.onSubmit;
    return () => submit({ preventDefault() {} });
  }
  return button(root, id, action).props.onClick;
}
function callback(props: ReturnType<typeof mount>['props'], action: Action) {
  return action === '削除' ? props.onDeleteTodo : action === '予定にする' ? props.onScheduleTodo : props.onSaveTodo;
}
afterEach(() => { act(() => renderers.splice(0).forEach(renderer => renderer.unmount())); });

describe('Todo pending operations', () => {
  it.each(actions)('admits one same-tick %s operation and disables all actions until settlement', async action => {
    const { renderer, props } = mount();
    const pending = deferred();
    const mutation = callback(props, action).mockReturnValue(pending.promise);
    const invoke = prepare(renderer.root, 'A', action);
    act(() => { void invoke(); void invoke(); });
    expect(mutation).toHaveBeenCalledTimes(1);
    expectBusy(renderer.root, 'A', true);
    expectBusy(renderer.root, 'B', false);
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
    await act(async () => { pending.resolve(); await pending.promise; });
    expectBusy(renderer.root, 'A', false);
  });

  it.each(actions.flatMap(action => [false, true].flatMap(reject => [false, true].map(secondFirst => ({ action, reject, secondFirst })))))
   ('keeps independent pending state: $action, rejection=$reject, secondFirst=$secondFirst', async ({ action, reject, secondFirst }) => {
      const { renderer, props } = mount();
      const first = deferred(), second = deferred();
      callback(props, action).mockReturnValueOnce(first.promise);
      const invoke = prepare(renderer.root, 'A', action);
      act(() => { void invoke(); });
      props.onSaveTodo.mockReturnValueOnce(second.promise);
      act(() => button(renderer.root, 'B', 'ピン留め').props.onClick());
      expectBusy(renderer.root, 'A', true);
      expectBusy(renderer.root, 'B', true);
      const earlier = secondFirst ? second : first;
      const later = secondFirst ? first : second;
      await act(async () => {
        if (reject) earlier.reject(new Error('controlled failure')); else earlier.resolve();
        await earlier.promise.catch(() => undefined);
      });
      expectBusy(renderer.root, secondFirst ? 'A' : 'B', true);
      expectBusy(renderer.root, secondFirst ? 'B' : 'A', false);
      await act(async () => { later.resolve(); await later.promise; });
      expectBusy(renderer.root, 'A', false);
      expectBusy(renderer.root, 'B', false);
    });

  it.each(actions)('releases a synchronous %s failure and allows a later operation', async action => {
    const { renderer, props } = mount();
    callback(props, action).mockImplementationOnce(() => { throw new Error('sync failure'); });
    const invoke = prepare(renderer.root, 'A', action);
    await act(async () => { await invoke(); });
    expectBusy(renderer.root, 'A', false);
    await act(async () => button(renderer.root, 'A', 'ピン留め').props.onClick());
    expect(props.onSaveTodo).toHaveBeenCalled();
  });

  it('keeps completion pending after an optimistic status change and rejects stale callbacks', async () => {
    const { renderer, props, update } = mount();
    const pending = deferred();
    props.onSaveTodo.mockReturnValue(pending.promise);
    const stalePin = button(renderer.root, 'A', 'ピン留め').props.onClick;
    act(() => button(renderer.root, 'A', '完了').props.onClick());
    update('owner', [{ ...todo('A'), status: 'done' }, todo('B')]);
    act(() => renderer.root.findByProps({ className: 'todo-completed-disclosure' }).props.onClick());
    expectBusy(renderer.root, 'A', true);
    act(() => { stalePin(); button(renderer.root, 'A', '未完了に戻す').props.onClick(); });
    expect(props.onSaveTodo).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); await pending.promise; });
    await act(async () => button(renderer.root, 'A', '未完了に戻す').props.onClick());
    expect(props.onSaveTodo).toHaveBeenCalledTimes(2);
    expect(props.onSaveTodo).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'open', scheduledPlanId: null }), 'A');
  });

  it('isolates old callbacks and settlement across owner A → B → A', async () => {
    const { renderer, props, update } = mount();
    const old = deferred(), current = deferred();
    props.onSaveTodo.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const oldPin = button(renderer.root, 'A', 'ピン留め').props.onClick;
    act(() => oldPin());
    update('other');
    expectBusy(renderer.root, 'A', false);
    act(() => oldPin());
    expect(props.onSaveTodo).toHaveBeenCalledTimes(1);
    update('owner');
    act(() => button(renderer.root, 'A', 'ピン留め').props.onClick());
    await act(async () => { old.resolve(); await old.promise; });
    expectBusy(renderer.root, 'A', true);
    await act(async () => { current.resolve(); await current.promise; });
    expectBusy(renderer.root, 'A', false);
  });

  it.each(['編集', '予定にする'] as const)('dismisses an old-owner %s draft and rejects its captured submit', async action => {
    const { renderer, props, update } = mount();
    const invoke = prepare(renderer.root, 'A', action);
    update('other');
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
    await act(async () => { await invoke(); });
    expect(callback(props, action)).not.toHaveBeenCalled();
  });

  it.each(actions)('blocks cross-action stale callbacks while %s is pending', async action => {
    const { renderer, props } = mount();
    const pending = deferred();
    const staleClicks = ['ピン留め', '完了', '編集', '予定にする', '削除'].map(label =>
      button(renderer.root, 'A', label).props.onClick);
    callback(props, action).mockReturnValue(pending.promise);
    const invoke = prepare(renderer.root, 'A', action);
    act(() => { void invoke(); staleClicks.forEach(click => click()); });
    expect(props.onSaveTodo.mock.calls.length + props.onScheduleTodo.mock.calls.length +
      props.onDeleteTodo.mock.calls.length).toBe(1);
    expect(renderer.root.findAllByType('form')).toHaveLength(0);
    await act(async () => { pending.resolve(); await pending.promise; });
  });

  it('does not dismiss a newer editor when another Todo settles', async () => {
    const { renderer, props } = mount();
    const pending = deferred();
    props.onSaveTodo.mockReturnValue(pending.promise);
    const invoke = prepare(renderer.root, 'A', '編集');
    act(() => { void invoke(); });
    prepare(renderer.root, 'B', '編集');
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(renderer.root.findAllByType('form')).toHaveLength(1);
    expect(renderer.root.findAllByType('input')[0].props.value).toBe('B');
  });

  it('does not display previous-owner rows during an owner transition', () => {
    const { renderer, update } = mount();
    update('other', [todo('A'), todo('B', 'other')]);
    expect(renderer.root.findAllByType('strong').map(node => node.children.join(''))).toEqual(['B']);
  });

  it('does not accept callbacks after unmount', async () => {
    const { renderer, props } = mount();
    const invoke = button(renderer.root, 'A', 'ピン留め').props.onClick;
    act(() => renderer.unmount());
    await act(async () => invoke());
    expect(props.onSaveTodo).not.toHaveBeenCalled();
  });
});
