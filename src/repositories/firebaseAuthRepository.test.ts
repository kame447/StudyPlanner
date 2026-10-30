import { beforeEach, expect, it, vi } from 'vitest';
import type { Auth, User as FirebaseUser } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn(), setPersistence: vi.fn(),
  serverTimestamp: vi.fn(), signOut: vi.fn(), observe: vi.fn() }));
vi.mock('firebase/auth', () => ({ browserLocalPersistence: {}, setPersistence: mocks.setPersistence,
  createUserWithEmailAndPassword: vi.fn(), onAuthStateChanged: vi.fn(), sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(),
  signOut: mocks.signOut, updateProfile: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: mocks.getDoc, setDoc: mocks.setDoc, onSnapshot: mocks.observe, serverTimestamp: mocks.serverTimestamp }));
vi.mock('../lib/firebaseClient', () => ({ createGoogleProvider: vi.fn() }));

const profile = { id: 'owner', email: 'student@example.test', username: 'Student', avatar: '', createdAt: '2026-01-01T00:00:00Z' };
const authUser = { uid: 'owner', email: 'Student@Example.test ', displayName: 'Account Name', emailVerified: true,
  providerData: [{ providerId: 'password' }], metadata: { creationTime: profile.createdAt } } as FirebaseUser;
const timestamp = { fixtureServerTimestamp: true };
const setRead = (value: unknown) => mocks.getDoc.mockResolvedValue({ exists: () => value !== null, data: () => value });
async function repository(user = authUser) {
  const { createFirebaseAuthRepository } = await import('./firebaseAuthRepository');
  return createFirebaseAuthRepository({ currentUser: user } as Auth, {} as Firestore);
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.setPersistence.mockResolvedValue(undefined);
  mocks.setDoc.mockReset().mockResolvedValue(undefined);
  mocks.getDoc.mockReset(); mocks.observe.mockReset();
  mocks.serverTimestamp.mockReturnValue(timestamp);
  setRead({ ...profile, registeredAt: 'retained', extraField: 'unchanged' });
});

it('restores an unchanged existing profile with one read and no write acknowledgement', async () => {
  mocks.setDoc.mockRejectedValue(new Error('writes must not be needed for unchanged startup'));
  expect(await (await repository()).getCurrentUser()).toEqual(profile);
  expect(mocks.getDoc).toHaveBeenCalledOnce();
  expect(mocks.getDoc).toHaveBeenCalledWith({ collection: 'profiles', id: 'owner' });
  expect(mocks.setDoc).not.toHaveBeenCalled();
  expect(mocks.serverTimestamp).not.toHaveBeenCalled();
});

it('still repairs every normalized field and persists changed authentication email', async () => {
  const cases = [
    { ...profile, id: 'incorrect-id' }, { ...profile, email: 'old@example.test' },
    { ...profile, username: ' Student ' }, { ...profile, avatar: undefined }, { ...profile, createdAt: '' },
  ];
  const repo = await repository();
  for (const existing of cases) {
    setRead(existing); mocks.setDoc.mockClear();
    expect(await repo.getCurrentUser()).toEqual(profile);
    expect(mocks.setDoc).toHaveBeenCalledExactlyOnceWith({ collection: 'profiles', id: 'owner' }, profile, { merge: true });
  }
  expect(mocks.serverTimestamp).not.toHaveBeenCalled();
});

it('creates a missing profile with the registration timestamp and existing fallbacks', async () => {
  setRead(null);
  const expected = { ...profile, username: 'Account Name' };
  expect(await (await repository()).getCurrentUser()).toEqual(expected);
  expect(mocks.setDoc).toHaveBeenCalledExactlyOnceWith({ collection: 'profiles', id: 'owner' },
    { ...expected, registeredAt: timestamp }, { merge: true });
  expect(mocks.serverTimestamp).toHaveBeenCalledOnce();
});

it('retains read and required-write failures and the unverified-account boundary', async () => {
  const repo = await repository();
  mocks.getDoc.mockRejectedValueOnce(new Error('read unavailable'));
  await expect(repo.getCurrentUser()).rejects.toThrow('ログイン状態を確認できませんでした。');
  expect(mocks.setDoc).not.toHaveBeenCalled();
  setRead({ ...profile, username: ' Student ' });
  mocks.setDoc.mockRejectedValueOnce(new Error('required write unavailable'));
  await expect(repo.getCurrentUser()).rejects.toThrow('ログイン状態を確認できませんでした。');
  mocks.getDoc.mockClear(); mocks.setDoc.mockClear();
  expect(await (await repository({ ...authUser, emailVerified: false } as FirebaseUser)).getCurrentUser()).toBeNull();
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(mocks.getDoc).not.toHaveBeenCalled(); expect(mocks.setDoc).not.toHaveBeenCalled();
});

it('observes only metadata, keeps ordinary restoration intact, and releases synchronously', async () => {
  const { createStartupSessionScope } = await import('../lib/startupSessionScope');
  const { createStartupTimingRecorder, startupTiming } = await import('../lib/startupTiming');
  const recorder = createStartupTimingRecorder(true, () => 1);
  const timing = vi.spyOn(startupTiming, 'begin').mockImplementation(recorder.begin);
  const stop = vi.fn(); mocks.observe.mockReturnValue(stop);
  const repo = await repository(), scope = createStartupSessionScope();
  const release = repo.observeStartupProfile!('owner', scope);
  expect(mocks.observe).toHaveBeenCalledExactlyOnceWith({ collection: 'profiles', id: 'owner' },
    { includeMetadataChanges: true }, expect.any(Function), expect.any(Function));
  expect(mocks.getDoc).not.toHaveBeenCalled(); expect(mocks.setDoc).not.toHaveBeenCalled();
  expect(mocks.setPersistence).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled();
  const data = vi.fn(() => { throw new Error('profile body must not be extracted'); });
  const next = mocks.observe.mock.calls[0][2];
  for (const metadata of [{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }, {}]) next({ metadata, data });
  expect(recorder.getSnapshot()[0].outcome).toBe('pending');
  next({ metadata: { fromCache: false, hasPendingWrites: false }, data });
  expect(recorder.getSnapshot()[0].outcome).toBe('success'); expect(stop).not.toHaveBeenCalled();
  expect(await repo.getCurrentUser()).toEqual(profile);
  expect(mocks.getDoc).toHaveBeenCalledOnce(); expect(mocks.setDoc).not.toHaveBeenCalled();
  scope.invalidate(); expect(stop).toHaveBeenCalledOnce(); release();
  next({ metadata: { fromCache: false, hasPendingWrites: false }, data });
  expect(stop).toHaveBeenCalledOnce(); expect(data).not.toHaveBeenCalled(); timing.mockRestore();
});
it('does not observe another owner, an expired scope, or an unverified account', async () => {
  const { createStartupSessionScope } = await import('../lib/startupSessionScope');
  const scope = createStartupSessionScope(); const repo = await repository();
  repo.observeStartupProfile!('other', scope)(); scope.invalidate(); repo.observeStartupProfile!('owner', scope)();
  const unverified = await repository({ ...authUser, emailVerified: false } as FirebaseUser);
  unverified.observeStartupProfile!('owner', createStartupSessionScope())();
  expect(mocks.observe).not.toHaveBeenCalled(); expect(mocks.signOut).not.toHaveBeenCalled(); expect(mocks.setPersistence).not.toHaveBeenCalled();
});
it('handles observer errors without replacing later profile errors or required repair', async () => {
  const { createStartupSessionScope } = await import('../lib/startupSessionScope');
  const stop = vi.fn(); mocks.observe.mockReturnValue(stop); const repo = await repository();
  const release = repo.observeStartupProfile!('owner', createStartupSessionScope());
  expect(() => mocks.observe.mock.calls[0][3](new Error('observation unavailable'))).not.toThrow();
  expect(stop).toHaveBeenCalledOnce();
  setRead({ ...profile, username: ' Student ' }); await repo.getCurrentUser();
  expect(mocks.setDoc).toHaveBeenCalledOnce(); release(); expect(stop).toHaveBeenCalledOnce();
  mocks.getDoc.mockRejectedValueOnce(new Error('ordinary read unavailable'));
  await expect(repo.getCurrentUser()).rejects.toThrow('ログイン状態を確認できませんでした。');
});
it('releases a subscription when revocation happens during registration or live identity changes', async () => {
  const { createStartupSessionScope } = await import('../lib/startupSessionScope');
  const scope = createStartupSessionScope(), stop = vi.fn();
  mocks.observe.mockImplementationOnce(() => { scope.invalidate(); return stop; });
  (await repository()).observeStartupProfile!('owner', scope)(); expect(stop).toHaveBeenCalledOnce();
  const live = { currentUser: authUser }; const nextStop = vi.fn(); mocks.observe.mockReturnValue(nextStop);
  const { createFirebaseAuthRepository } = await import('./firebaseAuthRepository');
  const repo = createFirebaseAuthRepository(live as Auth, {} as Firestore);
  repo.observeStartupProfile!('owner', createStartupSessionScope());
  live.currentUser = { ...authUser, uid: 'other' } as FirebaseUser;
  mocks.observe.mock.lastCall![2]({ metadata: { fromCache: false, hasPendingWrites: false } });
  expect(nextStop).toHaveBeenCalledOnce(); expect(mocks.setDoc).not.toHaveBeenCalled();
});

it('a throwing optional disposer cannot escape asynchronous observer callbacks', async () => {
  const { createStartupSessionScope } = await import('../lib/startupSessionScope');
  mocks.observe.mockReturnValue(() => { throw new Error('unsubscribe failure'); });
  const repo = await repository(), scope = createStartupSessionScope();
  repo.observeStartupProfile!('owner', scope);
  expect(() => mocks.observe.mock.calls[0][3](new Error('observer failed'))).not.toThrow();
  expect(await repo.getCurrentUser()).toEqual(profile);
});


it.each([
  ['auth/email-already-in-use', 'すでに登録されています'],
  ['auth/invalid-email', '形式を確認'],
  ['auth/weak-password', '6文字以上'],
  ['auth/invalid-credential', 'メールアドレスまたはパスワード'],
  ['auth/user-not-found', 'メールアドレスまたはパスワード'],
  ['auth/wrong-password', 'メールアドレスまたはパスワード'],
  ['auth/user-disabled', '管理者にお問い合わせ'],
  ['auth/too-many-requests', 'しばらく待って'],
  ['auth/network-request-failed', '通信状況を確認'],
  ['auth/popup-blocked', 'ポップアップを許可'],
  ['auth/popup-closed-by-user', 'キャンセル'],
  ['auth/requires-recent-login', 'ログインし直して'],
  ['auth/unknown-provider-code', 'ログインを完了できませんでした'],
])('translates %s without exposing provider message', async (code, guidance) => {
  const repo = await repository();
  const sdk = await import('firebase/auth');
  vi.mocked(sdk.signInWithEmailAndPassword).mockRejectedValueOnce(
    Object.assign(new Error('Firebase RAW_SECRET https://private.invalid/ stack'), { code }));
  const error = await repo.signInWithPassword('synthetic@example.test', 'synthetic-only').catch(error => error);
  const { UserFacingError } = await import('../lib/userFacingError');
  expect(error).toBeInstanceOf(UserFacingError);
  expect(error.message).toContain(guidance);
  expect(error.message).not.toMatch(/Firebase|auth\/|RAW_SECRET|private\.invalid|stack/);
  expect(sdk.signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
});

it.each(['signUpWithPassword', 'signInWithPassword', 'signInWithGoogle', 'sendPasswordReset', 'getCurrentUser', 'updateUserProfile', 'signOut'] as const)(
  'contains persistence failure at the %s boundary without issuing the operation', async operation => {
    const repo = await repository();
    mocks.setPersistence.mockRejectedValueOnce(Object.assign(new Error('RAW_SECRET'), { code: 'auth/network-request-failed' }));
    const calls = {
      signUpWithPassword: () => repo.signUpWithPassword('synthetic@example.test', 'synthetic-only', 'Synthetic'),
      signInWithPassword: () => repo.signInWithPassword('synthetic@example.test', 'synthetic-only'),
      signInWithGoogle: () => repo.signInWithGoogle(), sendPasswordReset: () => repo.sendPasswordReset('synthetic@example.test'),
      getCurrentUser: () => repo.getCurrentUser(), updateUserProfile: () => repo.updateUserProfile('owner', { username: 'Synthetic', avatar: '' }),
      signOut: () => repo.signOut(),
    };
    const error = await calls[operation]().catch(error => error);
    expect(error.message).toContain('通信状況を確認'); expect(error.message).not.toContain('RAW_SECRET');
    expect(mocks.getDoc).not.toHaveBeenCalled(); expect(mocks.setDoc).not.toHaveBeenCalled();
    const sdk = await import('firebase/auth');
    expect(sdk.signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(sdk.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

it('preserves verification guidance and contains asynchronous profile failure after login', async () => {
  const repo = await repository(); const sdk = await import('firebase/auth');
  vi.mocked(sdk.signInWithEmailAndPassword).mockResolvedValueOnce({ user: { ...authUser, emailVerified: false } } as never);
  await expect(repo.signInWithPassword('synthetic@example.test', 'synthetic-only')).rejects.toThrow('確認メールを再送しました');
  expect(sdk.sendEmailVerification).toHaveBeenCalledOnce();
  expect(mocks.signOut).toHaveBeenCalledOnce();
  vi.mocked(sdk.signInWithEmailAndPassword).mockResolvedValueOnce({ user: { ...authUser, emailVerified: false } } as never);
  vi.mocked(sdk.sendEmailVerification).mockRejectedValueOnce(Object.assign(new Error('RAW_SECRET'), { code: 'auth/too-many-requests' }));
  const throttled = await repo.signInWithPassword('synthetic@example.test', 'synthetic-only').catch(error => error);
  expect(throttled.message).toContain('しばらく待ってからもう一度ログインすると確認メールを再送');
  expect(throttled.message).not.toContain('RAW_SECRET');
  expect(mocks.signOut).toHaveBeenCalledTimes(2);
  vi.mocked(sdk.signInWithEmailAndPassword).mockResolvedValueOnce({ user: authUser } as never);
  mocks.getDoc.mockRejectedValueOnce(new Error('RAW_PROFILE_SECRET'));
  await expect(repo.signInWithPassword('synthetic@example.test', 'synthetic-only')).rejects.toThrow('ログインを完了できませんでした');
});

it('does not describe partial registration as an absent account or encourage blind resubmission', async () => {
  const repo = await repository(); const sdk = await import('firebase/auth');
  vi.mocked(sdk.createUserWithEmailAndPassword).mockResolvedValueOnce({ user: authUser } as never);
  vi.mocked(sdk.sendEmailVerification).mockRejectedValueOnce(Object.assign(new Error('RAW_SECRET'), { code: 'auth/network-request-failed' }));
  const error = await repo.signUpWithPassword('synthetic@example.test', 'synthetic-only', 'Synthetic').catch(error => error);
  expect(error.message).toContain('確認メールの受信状況やログイン状態を確認');
  expect(error.message).not.toContain('RAW_SECRET');
  expect(sdk.createUserWithEmailAndPassword).toHaveBeenCalledOnce();
});


it.each([null, 17, 'RAW_SECRET', new Error('RAW_SECRET')])('uses operation guidance for an unknown reset failure (%s)', async failure => {
  const repo = await repository(); const sdk = await import('firebase/auth');
  vi.mocked(sdk.sendPasswordResetEmail).mockRejectedValueOnce(failure);
  const error = await repo.sendPasswordReset('synthetic@example.test').catch(error => error);
  expect(error.message).toBe('パスワード再設定メールを送信できませんでした。');
  expect(error.message).not.toContain('RAW_SECRET');
});
