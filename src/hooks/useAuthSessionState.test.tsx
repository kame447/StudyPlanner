import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootManagedAuthenticationProvider } from '../components/RootManagedAuthenticationContext';
import type { User } from '../types/domain';
import { useAuthSessionState } from './useAuthSessionState';
import type { ShowNotice } from './useNoticeState';

const authRepositoryMock = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  signUpWithPassword: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithGoogle: vi.fn(),
  sendPasswordReset: vi.fn(),
  updateUserProfile: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../repositories', () => ({
  authRepository: authRepositoryMock,
}));

const currentUser: User = {
  id: 'user-1',
  email: 'user@example.com',
  username: 'User',
  avatar: '',
  createdAt: '2026-08-01T00:00:00.000Z',
};

type AuthSessionState = ReturnType<typeof useAuthSessionState>;

let latestState: AuthSessionState | null = null;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function AuthSessionHarness({ showNotice }: { showNotice: ShowNotice }) {
  latestState = useAuthSessionState({ showNotice });

  return (
    <span>
      {latestState.booting ? 'booting' : 'ready'}:
      {latestState.user?.id ?? 'anonymous'}
    </span>
  );
}

function renderHarness(rootManaged = false) {
  const showNotice = vi.fn<ShowNotice>();
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      rootManaged ? (
        <RootManagedAuthenticationProvider>
          <AuthSessionHarness showNotice={showNotice} />
        </RootManagedAuthenticationProvider>
      ) : (
        <AuthSessionHarness showNotice={showNotice} />
      ),
    );
  });

  return { renderer, showNotice };
}

function renderedState(renderer: ReactTestRenderer): string {
  return renderer.root.findByType('span').children.join('');
}

describe('useAuthSessionState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestState = null;
  });

  it('keeps booting active until authenticated planner data has finished loading', async () => {
    authRepositoryMock.getCurrentUser.mockResolvedValue(currentUser);
    const plannerData = createDeferred<void>();
    const loadPlannerData = vi.fn(() => plannerData.promise);
    const { renderer } = renderHarness();
    let bootstrapPromise!: Promise<void>;

    act(() => {
      bootstrapPromise = latestState!.bootstrapSession(loadPlannerData);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadPlannerData).toHaveBeenCalledWith(currentUser.id);
    expect(renderedState(renderer)).toBe('booting:user-1');

    await act(async () => {
      plannerData.resolve();
      await bootstrapPromise;
    });

    expect(renderedState(renderer)).toBe('ready:user-1');
  });

  it('does not expose an authenticated app state before the root auth boundary takes over', async () => {
    authRepositoryMock.signInWithPassword.mockResolvedValue(currentUser);
    const { renderer } = renderHarness(true);
    let result: User | null = null;

    await act(async () => {
      result = await latestState!.signInWithPassword('user@example.com', 'password');
    });

    expect(result).toEqual(currentUser);
    expect(renderedState(renderer)).toBe('booting:anonymous');
  });

  it('preserves self-managed authentication when no root auth boundary is present', async () => {
    authRepositoryMock.signInWithGoogle.mockResolvedValue(currentUser);
    const { renderer } = renderHarness();

    await act(async () => {
      await latestState!.signInWithGoogle();
    });

    expect(renderedState(renderer)).toBe('booting:user-1');
  });
});
