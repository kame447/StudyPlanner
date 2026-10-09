import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuthSessionState } from './useAuthSessionState';
import { createAuthRepository } from '../repositories/authRepository';
import { createLocalAuthStorageGateway } from '../repositories/localStorageGateway';
import { MemoryStorage, deferred } from '../repositories/localPersistenceConcurrency.testUtils';
import type { AuthRepository } from '../repositories/repositoryContracts';
import type { User } from '../types/domain';
import { RootStartupReadyProvider } from '../components/RootStartupReadyContext';
const boundary = vi.hoisted(() => ({ repository: null as unknown as AuthRepository }));
vi.mock('../repositories', () => ({ authRepository: new Proxy({}, { get: (_target, key) => boundary.repository[key as keyof AuthRepository] }) }));
const A: User = { id: 'a', email: 'a@example.test', username: 'A', avatar: '', createdAt: '' };
let state: ReturnType<typeof useAuthSessionState>;
let renderer: ReactTestRenderer;
const notice = vi.fn();
const settled = vi.fn(); const ready = vi.fn();
function Harness({ expectedUserId }: { expectedUserId?: string }) { state = useAuthSessionState({ showNotice: notice, onBootstrapSettled: settled, expectedUserId }); return null; }
async function mount() {
  const storage = new MemoryStorage();
  storage.setItem('studyplanner.users', JSON.stringify([A])); storage.setItem('studyplanner.session', A.id);
  const repository = createAuthRepository(createLocalAuthStorageGateway(storage)); boundary.repository = repository;
  act(() => { renderer = create(<RootStartupReadyProvider onReady={ready}><Harness /></RootStartupReadyProvider>); });
  await act(async () => { await state.bootstrapSession(async () => undefined); }); notice.mockClear(); settled.mockClear(); ready.mockClear();
  return { repository, storage };
}
afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); });
async function holdSave(afterPersist: boolean) {
  const gate = deferred(); const entered = deferred();
  const original = boundary.repository.updateUserProfile;
  const write = vi.fn(async (...args: Parameters<typeof original>) => {
    const result = afterPersist ? await original(...args) : null;
    entered.resolve(); await gate.promise;
    return result ?? original(...args);
  });
  boundary.repository = { ...boundary.repository, updateUserProfile: write };
  let done!: Promise<unknown>;
  await act(async () => { done = state.saveUserProfile({ username: 'Saved A', avatar: '📚' }).then(() => null, error => error); await entered.promise; });
  return { gate, done, write };
}
it.each([false, true])('does not restore a signed-out user after profile save, afterPersist=%s', async afterPersist => {
  const fixture = await mount(); const pending = await holdSave(afterPersist);
  await act(async () => { await state.signOut(); });
  expect(state.user).toBeNull(); notice.mockClear();
  let outcome: unknown;
  await act(async () => { pending.gate.resolve(); outcome = await pending.done; });
  expect(state.user).toBeNull();
  expect(fixture.storage.getItem('studyplanner.session')).toBeNull();
  expect(notice).not.toHaveBeenCalled();
  expect(outcome).toMatchObject({ name: 'ProfileSaveScopeExpiredError' });
  expect(pending.write).toHaveBeenCalledOnce();
  expect((await fixture.repository.getCurrentUser())).toBeNull();
});

it('retires saves admitted while sign-out is pending when sign-out succeeds', async () => {
  const fixture = await mount(); const logout = deferred();
  boundary.repository = { ...boundary.repository, signOut: async () => { await logout.promise; await fixture.repository.signOut(); } };
  let done!: Promise<void>; act(() => { done = state.signOut(); });
  const pending = await holdSave(true);
  await act(async () => { logout.resolve(); await done; }); notice.mockClear();
  await act(async () => { pending.gate.resolve(); expect(await pending.done).toMatchObject({ name: 'ProfileSaveScopeExpiredError' }); });
  expect(state.user).toBeNull(); expect(notice).not.toHaveBeenCalled();
});

it('expires prior saves on failed sign-out but permits a fresh explicit save', async () => {
  const fixture = await mount(); const pending = await holdSave(false);
  boundary.repository = { ...boundary.repository, signOut: async () => { throw new Error('signout unavailable'); } };
  await act(async () => { await expect(state.signOut()).rejects.toThrow('signout unavailable'); });
  await act(async () => { pending.gate.resolve(); expect(await pending.done).toMatchObject({ name: 'ProfileSaveScopeExpiredError' }); });
  expect(state.user?.id).toBe(A.id);
  boundary.repository = fixture.repository;
  await act(async () => { await state.saveUserProfile({ username: 'Fresh save', avatar: '' }); });
  expect(state.user?.username).toBe('Fresh save');
});

it.each((['password', 'google'] as const).flatMap(method => (['same', 'different', 'aba', 'failure'] as const).map(mode => ({ method, mode }))))
 ('$method login $mode preserves only applicable save completion', async ({ method, mode }) => {
    await mount(); const pending = await holdSave(false);
    const login = vi.fn(async () => { if (mode === 'failure') throw new Error('login unavailable'); return mode === 'same' ? A : { ...A, id: 'b', username: 'B' }; });
    boundary.repository = { ...boundary.repository, signInWithPassword: login, signInWithGoogle: login };
    await act(async () => {
      if (method === 'google') await state.signInWithGoogle(); else await state.signInWithPassword('synthetic@example.test', 'synthetic');
      if (mode === 'aba') {
        login.mockResolvedValueOnce(A);
        if (method === 'google') await state.signInWithGoogle(); else await state.signInWithPassword('synthetic@example.test', 'synthetic');
      }
    });
    notice.mockClear();
    await act(async () => {
      pending.gate.resolve();
      const outcome = await pending.done;
      if (mode === 'failure') expect(outcome).toBeNull(); else expect(outcome).toMatchObject({ name: 'ProfileSaveScopeExpiredError' });
    });
    if (mode === 'failure') expect(state.user?.username).toBe('Saved A');
    else { expect(state.user?.username).toBe(mode === 'different' ? 'B' : 'A'); expect(notice).not.toHaveBeenCalled(); }
  });

it.each([false, true])('retires success/rejection after unmount, rejected=%s', async rejected => {
  await mount(); const pending = await holdSave(false);
  act(() => renderer.unmount()); notice.mockClear();
  await act(async () => {
    if (rejected) pending.gate.reject(new Error('old write failed')); else pending.gate.resolve();
    expect(await pending.done).toMatchObject({ name: 'ProfileSaveScopeExpiredError' });
  });
  expect(notice).not.toHaveBeenCalled();
});

it('does not impose first-completion-wins on saves within an unchanged owner lifetime', async () => {
  const fixture = await mount(); const old = await holdSave(false);
  boundary.repository = fixture.repository;
  await act(async () => { await state.saveUserProfile({ username: 'Second save', avatar: '' }); });
  await act(async () => { old.gate.resolve(); expect(await old.done).toBeNull(); });
  expect(state.user?.username).toBe('Saved A');
});

it.each(['profile', 'planner'] as const)('save invalidation on sign-in does not orphan bootstrap settlement while waiting for %s', async phase => {
  await mount(); const pending = await holdSave(false);
  const profile = deferred<User>(); const planner = deferred();
  boundary.repository = { ...boundary.repository, getCurrentUser: () => profile.promise, signInWithGoogle: async () => A };
  let bootstrap!: Promise<void>;
  act(() => { bootstrap = state.bootstrapSession(() => planner.promise); });
  if (phase === 'planner') await act(async () => { profile.resolve(A); });
  await act(async () => { await state.signInWithGoogle(); });
  expect(state.booting).toBe(true);
  await act(async () => { profile.resolve(A); planner.resolve(); await bootstrap; });
  expect(state.booting).toBe(false); expect(settled).toHaveBeenCalledOnce(); expect(ready).toHaveBeenCalledOnce();
  await act(async () => { pending.gate.resolve(); expect(await pending.done).toMatchObject({ name: 'ProfileSaveScopeExpiredError' }); });
});

it('retires a save admitted during the profile read when that bootstrap result is accepted', async () => {
  await mount(); const profile = deferred<User>();
  boundary.repository = { ...boundary.repository, getCurrentUser: () => profile.promise };
  let bootstrap!: Promise<void>; act(() => { bootstrap = state.bootstrapSession(async () => undefined); });
  const pending = await holdSave(true);
  await act(async () => { profile.resolve(A); await bootstrap; });
  notice.mockClear();
  await act(async () => { pending.gate.resolve(); expect(await pending.done).toMatchObject({ name: 'ProfileSaveScopeExpiredError' }); });
  expect(state.user?.username).toBe('A'); expect(notice).not.toHaveBeenCalled();
  expect(state.booting).toBe(false);
});

it('retires in-flight results and rejects new admission under a mismatched expected owner', async () => {
  await mount(); const pending = await holdSave(false);
  act(() => renderer.update(<RootStartupReadyProvider onReady={ready}><Harness expectedUserId="b" /></RootStartupReadyProvider>));
  await act(async () => { await expect(state.saveUserProfile({ username: 'Wrong owner', avatar: '' })).rejects.toMatchObject({ name: 'ProfileSaveScopeExpiredError' }); });
  await act(async () => { pending.gate.resolve(); expect(await pending.done).toMatchObject({ name: 'ProfileSaveScopeExpiredError' }); });
  expect(pending.write).toHaveBeenCalledOnce(); expect(state.user?.username).toBe('A');
});

it('expires a prior save on bootstrap restart even if the profile refresh fails', async () => {
  await mount(); const pending = await holdSave(false);
  boundary.repository = { ...boundary.repository, getCurrentUser: async () => { throw new Error('profile read unavailable'); } };
  await act(async () => { await state.bootstrapSession(async () => undefined); }); notice.mockClear();
  await act(async () => { pending.gate.resolve(); expect(await pending.done).toMatchObject({ name: 'ProfileSaveScopeExpiredError' }); });
  expect(state.user?.username).toBe('A'); expect(state.booting).toBe(false);
  expect(settled).toHaveBeenCalledOnce(); expect(ready).toHaveBeenCalledOnce(); expect(notice).not.toHaveBeenCalled();
});
