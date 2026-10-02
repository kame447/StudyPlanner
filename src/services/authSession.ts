import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { getFirebaseAuth } from '../lib/firebaseClient';

export interface AuthSessionUser {
  id: string;
  requiresEmailVerification: boolean;
}

export interface AuthSessionService {
  readonly available: boolean;
  // A cached snapshot can be null while the first subscription event is pending.
  getCurrentUser(): AuthSessionUser | null;
  subscribe(listener: (user: AuthSessionUser | null) => void): () => void;
  signOut(): Promise<void>;
}

function toSessionUser(user: User | null): AuthSessionUser | null {
  return user ? {
    id: user.uid,
    requiresEmailVerification: !user.emailVerified
      && user.providerData.some((provider) => provider.providerId === 'password'),
  } : null;
}

export function createAuthSessionService(): AuthSessionService {
  const auth = getFirebaseAuth();

  return {
    available: auth !== null,
    getCurrentUser: () => toSessionUser(auth?.currentUser ?? null),
    subscribe(listener) {
      if (!auth) {
        listener(null);
        return () => {};
      }
      return onAuthStateChanged(auth, (user) => listener(toSessionUser(user)));
    },
    async signOut() {
      if (auth) await signOut(auth);
    },
  };
}
