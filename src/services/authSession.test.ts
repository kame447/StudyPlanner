import type { User } from 'firebase/auth';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFirebaseAuth } from '../lib/firebaseClient';
import { createAuthSessionService } from './authSession';

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn(), signOut: vi.fn() }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: vi.fn() }));

function firebaseUser(emailVerified: boolean, providerIds: string[]): User {
  return {
    uid: 'user-1', emailVerified,
    providerData: providerIds.map((providerId) => ({ providerId })),
  } as User;
}

function installAuth(currentUser: User | null) {
  const auth = { currentUser };
  vi.mocked(getFirebaseAuth).mockReturnValue(auth as NonNullable<ReturnType<typeof getFirebaseAuth>>);
  return auth;
}

describe('auth session Firebase adapter', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    { verified: false, providers: ['password'], pending: true },
    { verified: true, providers: ['password'], pending: false },
    { verified: false, providers: ['google.com'], pending: false },
    { verified: false, providers: ['google.com', 'password'], pending: true },
    { verified: false, providers: [], pending: false },
  ])('maps verification for $providers (verified: $verified)', ({ verified, providers, pending }) => {
    installAuth(firebaseUser(verified, providers));
    const service = createAuthSessionService();
    expect(service.available).toBe(true);
    expect(service.getCurrentUser()).toEqual({ id: 'user-1', requiresEmailVerification: pending });
  });

  it('reads fresh snapshots and forwards notifications and unsubscribe without extra events', () => {
    const auth = installAuth(null);
    const unsubscribe = vi.fn();
    vi.mocked(onAuthStateChanged).mockReturnValue(unsubscribe);
    const service = createAuthSessionService();
    const listener = vi.fn();
    expect(service.getCurrentUser()).toBeNull();
    expect(service.subscribe(listener)).toBe(unsubscribe);
    expect(onAuthStateChanged).toHaveBeenCalledWith(auth, expect.any(Function));
    expect(listener).not.toHaveBeenCalled();
    const notify = vi.mocked(onAuthStateChanged).mock.calls[0][1] as (user: User | null) => void;
    auth.currentUser = firebaseUser(true, ['password']);
    expect(service.getCurrentUser()?.id).toBe('user-1');
    notify(auth.currentUser);
    expect(listener).toHaveBeenLastCalledWith({ id: 'user-1', requiresEmailVerification: false });
    notify(null);
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it('signs out the same session and preserves errors', async () => {
    const auth = installAuth(null);
    const service = createAuthSessionService();
    await service.signOut();
    expect(signOut).toHaveBeenCalledWith(auth);
    const failure = new Error('sign-out failed');
    vi.mocked(signOut).mockRejectedValueOnce(failure);
    await expect(service.signOut()).rejects.toBe(failure);
  });

  it('provides a safe unavailable service when Firebase is not configured', async () => {
    vi.mocked(getFirebaseAuth).mockReturnValue(null);
    const service = createAuthSessionService();
    expect(service.available).toBe(false);
    expect(service.getCurrentUser()).toBeNull();
    const listener = vi.fn();
    service.subscribe(listener)();
    expect(listener).toHaveBeenCalledExactlyOnceWith(null);
    await service.signOut();
    expect(signOut).not.toHaveBeenCalled();
    expect(onAuthStateChanged).not.toHaveBeenCalled();
  });
});
