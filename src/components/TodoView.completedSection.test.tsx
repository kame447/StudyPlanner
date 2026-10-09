import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodoTask, TodoTaskDraft } from '../types/domain';
import { TodoView } from './TodoView';

const renderers: ReactTestRenderer[] = [];

function todo(id: string, overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    id,
    userId: 'owner',
    title: id,
    subject: '数学',
    type: 'study',
    estimatedMinutes: 30,
    dueDate: null,
    dueTime: null,
    memo: '保持するメモ',
    status: 'open',
    scheduledPlanId: null,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
    ...overrides,
  };
}

function mount(todos: TodoTask[]) {
  const props = {
    userId: 'owner',
    selectedDate: '2026-10-08',
    todos,
    onSaveTodo: vi.fn<(draft: TodoTaskDraft, id?: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    onScheduleTodo: vi.fn().mockResolvedValue(undefined),
    onDeleteTodo: vi.fn().mockResolvedValue(undefined),
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<TodoView {...props} />); });
  renderers.push(renderer);
  return {
    props,
    root: renderer.root,
    update(nextTodos: TodoTask[]) {
      act(() => { renderer.update(<TodoView {...props} todos={nextTodos} />); });
    },
  };
}

function disclosure(root: ReactTestInstance) {
  return root.findByProps({ className: 'todo-completed-disclosure' });
}

function completedPanel(root: ReactTestInstance) {
  return root.findByProps({ id: disclosure(root).props['aria-controls'] });
}

function titles(root: ReactTestInstance) {
  return root.findAllByType('strong').map((node) => node.children.join(''));
}

function section(root: ReactTestInstance, index: number) {
  return root.findAllByProps({ className: 'todo-status-section' })[index];
}

function toggleCompleted(root: ReactTestInstance) {
  act(() => { disclosure(root).props.onClick(); });
}

afterEach(() => {
  act(() => { renderers.splice(0).forEach((renderer) => renderer.unmount()); });
});

describe('Todo completed-section disclosure', () => {
  it.each([0, 1, 7])('starts closed with an accurate count for %i completed Todos', (count) => {
    const completed = Array.from({ length: count }, (_, index) => todo(`完了-${index}`, { status: 'done' }));
    const { root } = mount([
      todo('締切あり', { dueDate: '2026-10-10' }), todo('締切なし'),
      ...completed, todo('アーカイブ済み', { status: 'archived' }),
    ]);

    expect(disclosure(root).type).toBe('button');
    expect(disclosure(root).props.type).toBe('button');
    expect(disclosure(root).props['aria-expanded']).toBe(false);
    expect(completedPanel(root).props.hidden).toBe(true);
    expect(disclosure(root).findByProps({ className: 'todo-section-count' }).children).toEqual([String(count)]);
    expect(titles(root)).toEqual(['締切あり', '締切なし']);
    expect(section(root, 2).findAllByProps({ className: 'empty-copy todo-empty' })).toHaveLength(0);
  });

  it('opens every completed Todo, closes again, and never writes data just to toggle', () => {
    const completed = Array.from({ length: 7 }, (_, index) => todo(`完了-${index}`, { status: 'done' }));
    const original = structuredClone(completed);
    const { root, props } = mount(completed);
    const controls = disclosure(root).props['aria-controls'];

    toggleCompleted(root);
    expect(disclosure(root).props['aria-expanded']).toBe(true);
    expect(disclosure(root).props['aria-controls']).toBe(controls);
    expect(completedPanel(root).props.hidden).toBe(false);
    expect(titles(completedPanel(root))).toEqual(completed.map((item) => item.title));
    expect(section(root, 2).findAllByProps({ className: 'ghost-button todo-section-toggle' })).toHaveLength(0);

    toggleCompleted(root);
    expect(disclosure(root).props['aria-expanded']).toBe(false);
    expect(completedPanel(root).props.hidden).toBe(true);
    expect(titles(root)).toEqual([]);
    expect(completed).toEqual(original);
    expect(props.onSaveTodo).not.toHaveBeenCalled();
    expect(props.onScheduleTodo).not.toHaveBeenCalled();
    expect(props.onDeleteTodo).not.toHaveBeenCalled();
  });

  it('shows the empty state only when the empty completed section is opened', () => {
    const { root } = mount([]);
    toggleCompleted(root);
    expect(completedPanel(root).findByType('p').children).toEqual(['Todoはありません。']);
    toggleCompleted(root);
    expect(completedPanel(root).findAllByType('p')).toHaveLength(0);
  });

  it('keeps active-section pinning, initial five-item limits, show-more, and due-date sorting', () => {
    const regular = Array.from({ length: 6 }, (_, index) => todo(`締切-${index}`, { dueDate: `2026-10-${10 + index}` }));
    const unset = Array.from({ length: 6 }, (_, index) => todo(`未設定-${index}`));
    const { root } = mount([
      ...regular, ...unset,
      todo('ピン留め', { dueDate: '2026-10-20', pinned: true }),
      todo('完了済み', { status: 'done' }),
    ]);
    expect(titles(section(root, 0))).toEqual(['ピン留め', ...regular.slice(0, 5).map((item) => item.title)]);
    expect(titles(section(root, 1))).toEqual(unset.slice(0, 5).map((item) => item.title));

    act(() => { section(root, 0).findByProps({ className: 'ghost-button todo-section-toggle' }).props.onClick(); });
    toggleCompleted(root);
    toggleCompleted(root);
    expect(titles(section(root, 0))).toHaveLength(7);
    expect(titles(section(root, 1))).toHaveLength(5);

    act(() => {
      root.findAllByType('button').find((button) => button.children.join('') === '締切が遅い順')!.props.onClick();
    });
    expect(titles(section(root, 0))).toEqual(['ピン留め', ...[...regular].reverse().map((item) => item.title)]);
    act(() => { section(root, 0).findByProps({ className: 'ghost-button todo-section-toggle' }).props.onClick(); });
    expect(titles(section(root, 0))).toHaveLength(6);
    expect(disclosure(root).props['aria-expanded']).toBe(false);
  });

  it('preserves completion and restore actions, their data, and a closed section during updates', async () => {
    const active = todo('期限のある課題', { dueDate: '2026-10-10', dueTime: '18:00', pinned: true });
    const { root, props, update } = mount([active]);

    await act(async () => { root.findByProps({ 'aria-label': '完了' }).props.onClick(); });
    expect(props.onSaveTodo).toHaveBeenLastCalledWith({
      userId: active.userId, title: active.title, subject: active.subject, type: active.type,
      estimatedMinutes: active.estimatedMinutes, dueDate: active.dueDate, dueTime: active.dueTime,
      memo: active.memo, status: 'done', scheduledPlanId: null, pinned: false,
    }, active.id);
    const completed = { ...active, status: 'done' as const, pinned: false };
    update([completed]);
    expect(disclosure(root).props['aria-expanded']).toBe(false);
    expect(disclosure(root).findByProps({ className: 'todo-section-count' }).children).toEqual(['1']);
    expect(titles(root)).toEqual([]);

    toggleCompleted(root);
    await act(async () => { root.findByProps({ 'aria-label': '未完了に戻す' }).props.onClick(); });
    expect(props.onSaveTodo).toHaveBeenLastCalledWith(expect.objectContaining({
      title: active.title, dueDate: active.dueDate, dueTime: active.dueTime,
      memo: active.memo, status: 'open', scheduledPlanId: null, pinned: false,
    }), active.id);
    update([{ ...completed, status: 'open' }]);
    expect(titles(section(root, 0))).toEqual([active.title]);
    expect(disclosure(root).props['aria-expanded']).toBe(true);
    expect(disclosure(root).findByProps({ className: 'todo-section-count' }).children).toEqual(['0']);
    expect(completedPanel(root).findByType('p').children).toEqual(['Todoはありません。']);
  });

  it('keeps completed-item editing and deletion available after expansion', async () => {
    const completed = todo('完了した課題', { status: 'done' });
    const { root, props } = mount([completed]);
    toggleCompleted(root);
    act(() => { root.findByProps({ 'aria-label': '編集' }).props.onClick(); });
    expect(root.findByProps({ className: 'modal-card todo-edit-modal' })).toBeTruthy();
    expect(root.findAllByType('input').some((input) => input.props.value === completed.title)).toBe(true);
    act(() => { root.findAllByType('button').find((button) => button.children.join('') === 'キャンセル')!.props.onClick(); });
    await act(async () => { root.findByProps({ 'aria-label': '削除' }).props.onClick(); });
    expect(props.onDeleteTodo).toHaveBeenCalledWith(completed);
  });

  it('uses instance-specific disclosure targets and defaults to closed on a fresh view', () => {
    const completed = [todo('完了済み', { status: 'done' })];
    const first = mount(completed);
    toggleCompleted(first.root);
    const second = mount(completed);
    expect(disclosure(first.root).props['aria-controls']).not.toBe(disclosure(second.root).props['aria-controls']);
    expect(disclosure(first.root).props['aria-expanded']).toBe(true);
    expect(disclosure(second.root).props['aria-expanded']).toBe(false);
  });
});
