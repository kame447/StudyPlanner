import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import type { TodoTask } from '../types/domain';
import { TodoView } from './TodoView';

const todo: TodoTask = {
  id: 'task', userId: 'owner', title: '研究室に進捗共有', subject: '研究', type: 'study',
  estimatedMinutes: 15, dueDate: '2026-10-15', dueTime: '23:00', memo: '今日進めた内容を共有',
  status: 'open', scheduledPlanId: null, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z',
};
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });
function mount() {
  const save = vi.fn().mockResolvedValue(undefined);
  act(() => { renderer = create(<TodoView userId="owner" selectedDate="2026-10-13" todos={[todo]}
    onSaveTodo={save} onScheduleTodo={vi.fn()} onDeleteTodo={vi.fn()} />); });
  const root = renderer!.root;
  const open = () => act(() => root.findByProps({ 'aria-label': '編集' }).props.onClick());
  open();
  return { root, save, open };
}
function field(root: ReactTestInstance, name: string) {
  return root.findAllByType('label').find(node => node.findAllByType('span').some(span => span.children.includes(name)))!
    .find(node => ['input', 'select', 'textarea'].includes(String(node.type)));
}
function change(root: ReactTestInstance, name: string, value: string) {
  act(() => field(root, name).props.onChange({ target: { value } }));
}

it('keeps all compact field values editable and submits the same Todo', async () => {
  const { root, save } = mount();
  expect(root.findByProps({ className: 'todo-edit-field-pair' }).findAllByType('label')).toHaveLength(2);
  expect(root.findByProps({ className: 'todo-edit-deadline-pair' }).findAllByType('label')).toHaveLength(2);
  change(root, 'タイトル', '更新した題名');
  change(root, '教科', '英語');
  change(root, '種別', 'other');
  change(root, '所要時間（分）', '45');
  change(root, '締切日', '2026-10-16');
  change(root, '締切時刻', '19:30');
  change(root, 'メモ', '保持するメモ');
  await act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    title: '更新した題名', subject: '英語', type: 'other', estimatedMinutes: 45,
    dueDate: '2026-10-16', dueTime: '19:30', memo: '保持するメモ', status: 'open',
  }), 'task');
});

it('keeps empty-date time disabling, title validation and cancel behavior', () => {
  const { root, save, open } = mount();
  change(root, '締切日', '');
  expect(field(root, '締切時刻').props.disabled).toBe(true);
  change(root, 'タイトル', ' ');
  expect(root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
  act(() => root.findAllByType('button').find(node => node.children.includes('キャンセル'))!.props.onClick());
  expect(root.findAllByType('form')).toHaveLength(0);
  expect(save).not.toHaveBeenCalled();
  open();
  expect(field(root, 'タイトル').props.value).toBe(todo.title);
  expect(field(root, '締切日').props.value).toBe(todo.dueDate);
  expect(field(root, '締切時刻').props.disabled).toBe(false);
  expect(field(root, '締切時刻').props.value).toBe(todo.dueTime);
});
