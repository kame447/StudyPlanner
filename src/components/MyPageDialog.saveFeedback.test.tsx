import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthSessionState } from '../hooks/useAuthSessionState';
import { MyPageDialog } from './MyPageDialog';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { User } from '../types/domain';

const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn(), updateUserProfile: vi.fn(), signOut: vi.fn() }));
vi.mock('../repositories', () => ({ authRepository: auth }));
vi.mock('../hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false, status: 'denied' }) }));
const user: User = { id: 'owner', email: 'owner@example.test', username: 'Initial', avatar: '📚', createdAt: '' };
const notice = vi.fn();
let state: ReturnType<typeof useAuthSessionState>;
let renderer: ReactTestRenderer;
function Harness({ open = true }: { open?: boolean }) {
  state = useAuthSessionState({ showNotice: notice });
  return state.user ? <MyPageDialog open={open} user={state.user} onSaveProfile={state.saveUserProfile}
    onSignOut={state.signOut} onClose={() => undefined} /> : null;
}
const save = () => renderer.root.findAllByType('button').find(node => node.props.children === 'プロフィールを保存')!;
const name = () => renderer.root.findByProps({ placeholder: '未入力ならメールアドレスを使います' });
beforeEach(async () => {
  vi.clearAllMocks(); auth.getCurrentUser.mockResolvedValue(user);
  act(() => { renderer = create(<Harness />); });
  await act(async () => { await state.bootstrapSession(async () => undefined); });
});
afterEach(() => act(() => renderer.unmount()));

it('shows failure instead of saved feedback and preserves the draft for an explicit retry', async () => {
  act(() => name().props.onChange({ target: { value: 'Edited' } }));
  auth.updateUserProfile.mockRejectedValueOnce(new Error('profile storage unavailable'));
  await act(async () => { save().props.onClick(); });
  expect(notice).toHaveBeenCalledWith('profile storage unavailable', 'error');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('保存しました。');
  expect(JSON.stringify(renderer.toJSON())).toContain('profile storage unavailable');
  expect(name().props.value).toBe('Edited');
  auth.updateUserProfile.mockResolvedValueOnce({ ...user, username: 'Edited' });
  await act(async () => { save().props.onClick(); });
  expect(auth.updateUserProfile).toHaveBeenCalledTimes(2);
  expect(state.user?.username).toBe('Edited');
  expect(notice).toHaveBeenCalledWith('プロフィールを更新しました。', 'success');
});

it.each(['close', 'choice'] as const)('does not put a late save error into a newer %s context', async boundary => {
  const gate = deferred<User>(); auth.updateUserProfile.mockReturnValueOnce(gate.promise);
  act(() => save().props.onClick());
  if (boundary === 'close') {
    act(() => renderer.update(<Harness open={false} />));
    act(() => renderer.update(<Harness />));
  } else {
    act(() => renderer.root.findByProps({ className: 'collapsible-toggle' }).props.onClick());
    act(() => renderer.root.findAllByType('button').find(button => button.props.children === '🚀')!.props.onClick());
  }
  await act(async () => { gate.reject(new Error('old save error')); });
  expect(JSON.stringify(renderer.toJSON())).not.toContain('old save error');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('保存しました。');
});

it('handles a non-Error failure and rejects a save without an authenticated user', async () => {
  auth.updateUserProfile.mockRejectedValueOnce('unavailable');
  await act(async () => { save().props.onClick(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('プロフィールを更新できませんでした。');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('保存しました。');
  auth.getCurrentUser.mockResolvedValueOnce(null);
  await act(async () => { await state.bootstrapSession(async () => undefined); });
  await act(async () => {
    await expect(state.saveUserProfile({ username: 'Ignored', avatar: '' })).rejects.toThrow('ログイン状態を確認できませんでした。');
  });
  expect(auth.updateUserProfile).toHaveBeenCalledOnce();
});
