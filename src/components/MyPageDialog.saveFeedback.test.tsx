import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthSessionState } from '../hooks/useAuthSessionState';
import { MyPageDialog } from './MyPageDialog';
import { MemoryStorage, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import { createAuthRepository } from '../repositories/authRepository';
import { createLocalAuthStorageGateway } from '../repositories/localStorageGateway';
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

it.each(['same editor', 'reopened editor'] as const)('preserves newer typing in the %s after an older successful save', async boundary => {
  const gate = deferred<User>(); auth.updateUserProfile.mockReturnValueOnce(gate.promise);
  act(() => name().props.onChange({ target: { value: 'Submitted' } }));
  act(() => save().props.onClick());
  if (boundary === 'reopened editor') {
    act(() => renderer.update(<Harness open={false} />));
    act(() => renderer.update(<Harness />));
  }
  act(() => name().props.onChange({ target: { value: 'Newer unsaved draft' } }));
  await act(async () => { gate.resolve({ ...user, username: 'Submitted' }); });
  expect(state.user?.username).toBe('Submitted');
  expect(name().props.value).toBe('Newer unsaved draft');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('保存しました。');
});

it.each([['  Normalized  ', 'Normalized'], ['   ', user.email]])('applies repository normalization for %s and keeps the avatar section open', async (input, normalized) => {
  act(() => name().props.onChange({ target: { value: input } }));
  act(() => renderer.root.findByProps({ className: 'collapsible-toggle' }).props.onClick());
  const storage = new MemoryStorage();
  storage.setItem('studyplanner.users', JSON.stringify([user]));
  const repository = createAuthRepository(createLocalAuthStorageGateway(storage));
  auth.updateUserProfile.mockImplementationOnce(repository.updateUserProfile);
  await act(async () => { save().props.onClick(); });
  expect(name().props.value).toBe(normalized);
  expect(renderer.root.findAllByProps({ type: 'file' })).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).toContain('保存しました。');
});

it('does not label a newer username draft with an older save error', async () => {
  const gate = deferred<User>(); auth.updateUserProfile.mockReturnValueOnce(gate.promise);
  act(() => save().props.onClick());
  act(() => name().props.onChange({ target: { value: 'Later' } }));
  await act(async () => { gate.reject(new Error('old save failure')); });
  expect(name().props.value).toBe('Later');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('old save failure');
});

it.each(['older first', 'newer first'] as const)('keeps the latest submitted draft with %s completion', async order => {
  const older = deferred<User>(); const newer = deferred<User>();
  auth.updateUserProfile.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  act(() => name().props.onChange({ target: { value: 'First' } }));
  act(() => save().props.onClick());
  act(() => name().props.onChange({ target: { value: 'Second' } }));
  act(() => save().props.onClick());
  const completeOlder = () => act(async () => { older.resolve({ ...user, username: 'First canonical' }); });
  const completeNewer = () => act(async () => { newer.resolve({ ...user, username: 'Second canonical' }); });
  if (order === 'older first') { await completeOlder(); await completeNewer(); }
  else { await completeNewer(); await completeOlder(); }
  expect(name().props.value).toBe('Second canonical');
});

it('follows same-owner refreshes only until this dialog has local edits', async () => {
  auth.getCurrentUser.mockResolvedValueOnce({ ...user, username: 'Fresh' });
  await act(async () => { await state.bootstrapSession(async () => undefined); });
  expect(name().props.value).toBe('Fresh');
  act(() => name().props.onChange({ target: { value: 'Draft' } }));
  auth.getCurrentUser.mockResolvedValueOnce({ ...user, username: 'External' });
  await act(async () => { await state.bootstrapSession(async () => undefined); });
  expect(name().props.value).toBe('Draft');
  act(() => renderer.update(<Harness open={false} />));
  act(() => renderer.update(<Harness />));
  expect(name().props.value).toBe('External');
});

it('uses the latest save ticket even when two submissions share a draft revision', async () => {
  const older = deferred<User>(); const newer = deferred<User>();
  auth.updateUserProfile.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  act(() => save().props.onClick());
  act(() => save().props.onClick());
  await act(async () => { newer.resolve({ ...user, username: 'Latest canonical' }); });
  await act(async () => { older.resolve({ ...user, username: 'Old canonical' }); });
  expect(name().props.value).toBe('Latest canonical');
});

it('treats editing away and back as a newer intent, even if the value is unchanged', async () => {
  const gate = deferred<User>(); auth.updateUserProfile.mockReturnValueOnce(gate.promise);
  act(() => save().props.onClick());
  act(() => name().props.onChange({ target: { value: 'Intermediate' } }));
  act(() => name().props.onChange({ target: { value: user.username } }));
  await act(async () => { gate.resolve({ ...user, username: 'Server canonical' }); });
  expect(name().props.value).toBe(user.username);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('保存しました。');
});


it('suppresses an older duplicate-save error after the newer submission succeeds', async () => {
  const older = deferred<User>(); const newer = deferred<User>();
  auth.updateUserProfile.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  act(() => save().props.onClick());
  act(() => save().props.onClick());
  await act(async () => { newer.resolve(user); });
  await act(async () => { older.reject(new Error('stale duplicate error')); });
  expect(JSON.stringify(renderer.toJSON())).toContain('保存しました。');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('stale duplicate error');
});

it('adopts an old completed save in a reopened session that is still untouched', async () => {
  const gate = deferred<User>(); auth.updateUserProfile.mockReturnValueOnce(gate.promise);
  act(() => save().props.onClick());
  act(() => renderer.update(<Harness open={false} />));
  act(() => renderer.update(<Harness />));
  await act(async () => { gate.resolve({ ...user, username: 'Updated canonical' }); });
  expect(name().props.value).toBe('Updated canonical');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('保存しました。');
});
