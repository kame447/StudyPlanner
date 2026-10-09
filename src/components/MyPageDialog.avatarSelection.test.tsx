import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import { MyPageDialog } from './MyPageDialog';
import { UserAvatar } from './UserAvatar';
import type { User } from '../types/domain';

const convert = vi.hoisted(() => vi.fn());
vi.mock('../lib/avatarImage', async importOriginal => ({ ...await importOriginal<typeof import('../lib/avatarImage')>(), createAvatarDataUrl: convert }));
vi.mock('../hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false, status: 'denied' }) }));
const user: User = { id: 'owner', email: 'owner@example.test', username: 'Owner', avatar: '📚', createdAt: '' };
let renderer: ReactTestRenderer;
const save = vi.fn().mockImplementation(async draft => ({ ...user, ...draft }));
const close = vi.fn();
function render(open = true, owner = user) {
  return <MyPageDialog open={open} user={owner} onSaveProfile={save} onSignOut={vi.fn()} onClose={close} />;
}
function button(text: string) { return renderer.root.findAllByType('button').find(node => node.props.children === text)!; }
function expand() { act(() => renderer.root.findByProps({ className: 'collapsible-toggle' }).props.onClick()); }
function photo() {
  const target = { files: [{ name: 'photo.png', type: 'image/png' }], value: 'photo.png' };
  let done!: Promise<void>;
  act(() => { done = renderer.root.findByProps({ type: 'file' }).props.onChange({ target }); });
  return { done, target };
}
function avatar() { return renderer.root.findByType(UserAvatar).props.user.avatar; }
beforeEach(() => { vi.clearAllMocks(); act(() => { renderer = create(render()); }); expand(); });
afterEach(() => act(() => renderer.unmount()));

it.each(['success', 'failure'] as const)('keeps a newer emoji when an old photo ends in %s', async outcome => {
  const gate = deferred<string>(); convert.mockReturnValueOnce(gate.promise);
  const pending = photo();
  act(() => button('🚀').props.onClick());
  await act(async () => { if (outcome === 'success') gate.resolve('data:image/jpeg;base64,old'); else gate.reject(new Error('old conversion error')); await pending.done; });
  expect(avatar()).toBe('🚀');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('old conversion error');
});

it('blocks a captured Save handler while the current photo is unresolved', async () => {
  const gate = deferred<string>(); convert.mockReturnValueOnce(gate.promise);
  const submit = button('プロフィールを保存').props.onClick;
  const pending = photo();
  await act(async () => { submit(); });
  expect(save).not.toHaveBeenCalled();
  expect(button('プロフィールを保存').props.disabled).toBe(true);
  await act(async () => { gate.resolve('data:image/jpeg;base64,new'); await pending.done; });
  await act(async () => { button('プロフィールを保存').props.onClick(); });
  expect(save).toHaveBeenCalledWith({ username: 'Owner', avatar: 'data:image/jpeg;base64,new' });
});

it.each(['old-first', 'new-first'] as const)('keeps newest photo and pending ownership: %s', async order => {
  const old = deferred<string>(); const next = deferred<string>();
  convert.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const first = photo(); const second = photo();
  expect(first.target.value).toBe(''); expect(second.target.value).toBe('');
  second.target.value = 'new input';
  if (order === 'old-first') {
    await act(async () => { old.resolve('data:image/jpeg;base64,old'); await first.done; });
    expect(button('プロフィールを保存').props.disabled).toBe(true);
    await act(async () => { next.resolve('data:image/jpeg;base64,new'); await second.done; });
  } else {
    await act(async () => { next.resolve('data:image/jpeg;base64,new'); await second.done; });
    await act(async () => { old.reject(new Error('old conversion error')); await first.done; });
  }
  expect(avatar()).toBe('data:image/jpeg;base64,new');
  expect(second.target.value).toBe('new input');
  expect(button('プロフィールを保存').props.disabled).toBe(false);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('old conversion error');
});

it.each(['close', 'owner', 'unmount'] as const)('invalidates old conversion at %s boundary', async boundary => {
  const old = deferred<string>(); const next = deferred<string>();
  convert.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const first = photo();
  if (boundary === 'close') {
    act(() => button('閉じる').props.onClick());
    act(() => renderer.update(render(false)));
    act(() => renderer.update(render()));
  } else if (boundary === 'owner') {
    act(() => renderer.update(render(true, { ...user, id: 'another-owner' })));
    act(() => renderer.update(render()));
  } else {
    act(() => renderer.unmount());
    act(() => { renderer = create(render()); });
  }
  expand();
  const second = photo();
  await act(async () => { old.resolve('data:image/jpeg;base64,old'); await first.done; });
  expect(avatar()).toBe('📚');
  expect(button('プロフィールを保存').props.disabled).toBe(true);
  await act(async () => { next.resolve('data:image/jpeg;base64,new'); await second.done; });
  expect(avatar()).toBe('data:image/jpeg;base64,new');
});

it('allows a current conversion error to be retried without losing username edits', async () => {
  const failed = deferred<string>(); convert.mockReturnValueOnce(failed.promise).mockResolvedValueOnce('data:image/jpeg;base64,retry');
  const pending = photo();
  act(() => renderer.root.findByProps({ placeholder: '未入力ならメールアドレスを使います' }).props.onChange({ target: { value: 'Edited username' } }));
  await act(async () => { failed.reject(new Error('current conversion error')); await pending.done; });
  expect(JSON.stringify(renderer.toJSON())).toContain('current conversion error');
  expect(avatar()).toBe('📚'); expect(button('プロフィールを保存').props.disabled).toBe(false);
  await act(async () => { await photo().done; });
  await act(async () => { button('プロフィールを保存').props.onClick(); });
  expect(save).toHaveBeenCalledWith({ username: 'Edited username', avatar: 'data:image/jpeg;base64,retry' });
});

it.each(['文字', '写真を外す'] as const)('honors %s while an old conversion is pending', async choice => {
  act(() => renderer.update(render(true, { ...user, avatar: 'data:image/jpeg;base64,initial' })));
  const gate = deferred<string>(); convert.mockReturnValueOnce(gate.promise);
  const pending = photo(); act(() => button(choice).props.onClick());
  expect(button('プロフィールを保存').props.disabled).toBe(false);
  await act(async () => { gate.resolve('data:image/jpeg;base64,old'); await pending.done; });
  expect(avatar()).toBe('');
});

it('invalidates conversion immediately when Close is requested before parent rerender', async () => {
  const gate = deferred<string>(); convert.mockReturnValueOnce(gate.promise);
  const pending = photo(); act(() => button('閉じる').props.onClick());
  expect(close).toHaveBeenCalledOnce();
  await act(async () => { gate.resolve('data:image/jpeg;base64,old'); await pending.done; });
  expect(avatar()).toBe('📚');
});

it('keeps the current conversion error when an older photo later succeeds', async () => {
  const old = deferred<string>(); const next = deferred<string>();
  convert.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const first = photo(); const second = photo();
  await act(async () => { next.reject(new Error('current error')); await second.done; });
  await act(async () => { old.resolve('data:image/jpeg;base64,old'); await first.done; });
  expect(avatar()).toBe('📚');
  expect(JSON.stringify(renderer.toJSON())).toContain('current error');
  expect(button('プロフィールを保存').props.disabled).toBe(false);
});

it('does not replace current photo-processing feedback with an older save completion', async () => {
  const saving = deferred<User>(); const gate = deferred<string>();
  save.mockReturnValueOnce(saving.promise); convert.mockReturnValueOnce(gate.promise);
  act(() => button('プロフィールを保存').props.onClick());
  const pending = photo();
  await act(async () => { saving.resolve(user); await saving.promise; });
  expect(JSON.stringify(renderer.toJSON())).toContain('画像を処理しています...');
  expect(button('プロフィールを保存').props.disabled).toBe(true);
  await act(async () => { gate.resolve('data:image/jpeg;base64,new'); await pending.done; });
});

it('keeps a newer photo conversion alive across an older same-owner profile refresh', async () => {
  const gate = deferred<string>(); convert.mockReturnValueOnce(gate.promise);
  const pending = photo();
  act(() => renderer.update(render(true, { ...user, username: 'Older saved name', avatar: '🌱' })));
  expect(button('プロフィールを保存').props.disabled).toBe(true);
  await act(async () => { gate.resolve('data:image/jpeg;base64,new'); await pending.done; });
  expect(avatar()).toBe('data:image/jpeg;base64,new');
  expect(button('プロフィールを保存').props.disabled).toBe(false);
});

it('keeps photo processing alive and visible while the username is edited', async () => {
  const gate = deferred<string>(); convert.mockReturnValueOnce(gate.promise);
  const pending = photo();
  act(() => renderer.root.findByProps({ placeholder: '未入力ならメールアドレスを使います' }).props.onChange({ target: { value: 'New name' } }));
  expect(JSON.stringify(renderer.toJSON())).toContain('画像を処理しています...');
  expect(button('プロフィールを保存').props.disabled).toBe(true);
  await act(async () => { gate.resolve('data:image/jpeg;base64,new'); await pending.done; });
  await act(async () => { button('プロフィールを保存').props.onClick(); });
  expect(save).toHaveBeenLastCalledWith({ username: 'New name', avatar: 'data:image/jpeg;base64,new' });
});
