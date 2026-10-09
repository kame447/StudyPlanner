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
  await expect(repo.getCurrentUser()).rejects.toThrow('read unavailable');
  expect(mocks.setDoc).not.toHaveBeenCalled();
  setRead({ ...profile, username: ' Student ' });
  mocks.setDoc.mockRejectedValueOnce(new Error('required write unavailable'));
  await expect(repo.getCurrentUser()).rejects.toThrow('required write unavailable');
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
  await expect(repo.getCurrentUser()).rejects.toThrow('ordinary read unavailable');
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
