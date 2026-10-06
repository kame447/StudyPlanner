import { beforeEach, expect, it, vi } from 'vitest';
import type { Auth, User as FirebaseUser } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn(), setPersistence: vi.fn(),
  serverTimestamp: vi.fn(), signOut: vi.fn() }));
vi.mock('firebase/auth', () => ({ browserLocalPersistence: {}, setPersistence: mocks.setPersistence,
  createUserWithEmailAndPassword: vi.fn(), onAuthStateChanged: vi.fn(), sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(),
  signOut: mocks.signOut, updateProfile: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: mocks.getDoc, setDoc: mocks.setDoc, serverTimestamp: mocks.serverTimestamp }));
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
  mocks.getDoc.mockReset();
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
