import { vi } from 'vitest';
import type { AuthSessionService, AuthSessionUser } from '../services/authSession';

export function createFakeAuthSession({
  available = true,
  currentUser = null,
}: {
  available?: boolean;
  currentUser?: AuthSessionUser | null;
} = {}) {
  const listeners = new Set<(user: AuthSessionUser | null) => void>();
  const unsubscribe = vi.fn();
  const session = {
    available,
    getCurrentUser: () => currentUser,
    subscribe: vi.fn((listener: (user: AuthSessionUser | null) => void) => {
      listeners.add(listener);
      return () => {
        unsubscribe();
        listeners.delete(listener);
      };
    }),
    signOut: vi.fn(async () => undefined),
  } satisfies AuthSessionService;

  return {
    session,
    unsubscribe,
    emit(user: AuthSessionUser | null) {
      currentUser = user;
      listeners.forEach((listener) => listener(user));
    },
  };
}
