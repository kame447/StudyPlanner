import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ provider: vi.fn(), remove: vi.fn(), clear: vi.fn() }));
vi.mock('../services/accountDeletionService', () => ({ accountDeletionProvider: mocks.provider, deleteAccount: mocks.remove }));
vi.mock('../services/accountDeletionLocalData', () => ({ clearAccountLocalData: mocks.clear }));
import { AccountDeletionDialog } from './AccountDeletionDialog';
let renderer: ReactTestRenderer;
beforeEach(() => { vi.clearAllMocks(); mocks.provider.mockResolvedValue('password'); mocks.clear.mockResolvedValue(undefined); });
afterEach(() => { act(() => renderer?.unmount()); });
async function mount(retry = false) {
  const completed = vi.fn().mockResolvedValue(undefined), close = vi.fn();
  await act(async () => { renderer = create(<AccountDeletionDialog uid="A" retry={retry} onCompleted={completed} onClose={close} />); });
  return { completed, close, root: renderer.root };
}
async function submit() {
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
}
it('uses one confirmation, requires current password and clears only after server completion', async () => {
  const { root, completed } = await mount();
  expect(root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
  expect(root.findByType('input').props).toMatchObject({ type: 'password', autoComplete: 'current-password', required: true });
  act(() => root.findByType('input').props.onChange({ target: { value: 'password' } }));
  mocks.remove.mockResolvedValue({ status: 'completed' });
  await submit();
  expect(mocks.remove).toHaveBeenCalledWith('A', 'password');
  expect(mocks.clear).toHaveBeenCalledWith('A');
  expect(completed).toHaveBeenCalledOnce();
  expect(JSON.stringify(renderer.toJSON())).toContain('退会が完了しました');
});
it('reuses the dialog in locked retry state after pending sign-in and never clears on failure', async () => {
  const { root } = await mount(true);
  mocks.remove.mockResolvedValue({ status: 'reauth_required' });
  expect(root.findAllByType('button').some(button => button.children.includes('キャンセル'))).toBe(false);
  await submit();
  expect(root.findByProps({ role: 'alert' }).children.join('')).toContain('本人確認');
  expect(mocks.clear).not.toHaveBeenCalled();
});
it('offers Google verification without a password field and stays busy through the request', async () => {
  mocks.provider.mockResolvedValue('google');
  const { root } = await mount();
  expect(root.findAllByType('input')).toHaveLength(0);
  let settle!: (value: { status: 'in_progress' }) => void;
  mocks.remove.mockReturnValue(new Promise(resolve => { settle = resolve; }));
  act(() => root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(root.findByProps({ role: 'status' }).children.join('')).toBe('削除しています…');
  expect(root.findAllByType('button').every(button => button.props.disabled)).toBe(true);
  await act(async () => settle({ status: 'in_progress' }));
  expect(root.findByProps({ role: 'alert' }).children.join('')).toContain('もう一度');
});
it('retries local cleanup without repeating remote deletion once completion is known', async () => {
  const { completed } = await mount();
  mocks.remove.mockResolvedValue({ status: 'completed' }); mocks.clear.mockRejectedValueOnce(new Error('blocked storage'));
  await submit(); expect(completed).not.toHaveBeenCalled();
  await submit(); expect(mocks.remove).toHaveBeenCalledOnce(); expect(completed).toHaveBeenCalledOnce();
});
