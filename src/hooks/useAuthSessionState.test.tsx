import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootManagedAuthenticationProvider } from '../components/RootManagedAuthenticationContext';
import { RootStartupReadyProvider } from '../components/RootStartupReadyContext';
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

function AuthSessionHarness({ showNotice, onBootstrapSettled, expectedUserId }: { showNotice: ShowNotice; onBootstrapSettled?: () => void; expectedUserId?: string }) {
  latestState = useAuthSessionState({ showNotice, onBootstrapSettled, expectedUserId });

  return (
    <span>
      {latestState.booting ? 'booting' : 'ready'}:
      {latestState.user?.id ?? 'anonymous'}
    </span>
  );
}

function renderHarness(
  rootManaged = false,
  onStartupReady?: () => void,
  onBootstrapSettled?: () => void,
  expectedUserId?: string,
) {
  const showNotice = vi.fn<ShowNotice>();
  let renderer!: ReactTestRenderer;
  let content = <AuthSessionHarness showNotice={showNotice} onBootstrapSettled={onBootstrapSettled} expectedUserId={expectedUserId} />;

  if (rootManaged) {
    content = (
      <RootManagedAuthenticationProvider>
        {content}
      </RootManagedAuthenticationProvider>
    );
  }

  if (onStartupReady) {
    content = (
      <RootStartupReadyProvider onReady={onStartupReady}>
        {content}
      </RootStartupReadyProvider>
    );
  }

  act(() => {
    renderer = create(content);
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

  it.each(['old-success', 'old-failure'])('ignores %s from an obsolete bootstrap attempt', async outcome => {
    const first = createDeferred<User | null>(), second = createDeferred<User | null>();
    authRepositoryMock.getCurrentUser.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const ready = vi.fn(), settled = vi.fn(), load = vi.fn(async () => undefined);
    const { renderer, showNotice } = renderHarness(false, ready, settled);
    let old!: Promise<void>, current!: Promise<void>;
    act(() => { old = latestState!.bootstrapSession(load); current = latestState!.bootstrapSession(load); });
    await act(async () => {
      if (outcome === 'old-success') first.resolve(currentUser); else first.reject(new Error('old'));
      await old;
    });
    expect(load).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled(); expect(renderedState(renderer)).toBe('booting:anonymous');
    await act(async () => { second.resolve(currentUser); await current; });
    expect(load).toHaveBeenCalledExactlyOnceWith(currentUser.id); expect(ready).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledOnce();
    expect(renderedState(renderer)).toBe('ready:user-1'); act(() => renderer.unmount());
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

  it('releases the persistent root splash only after planner bootstrap completes', async () => {
    authRepositoryMock.getCurrentUser.mockResolvedValue(currentUser);
    const plannerData = createDeferred<void>();
    const loadPlannerData = vi.fn(() => plannerData.promise);
    const onStartupReady = vi.fn();
    renderHarness(false, onStartupReady);
    let bootstrapPromise!: Promise<void>;

    act(() => {
      bootstrapPromise = latestState!.bootstrapSession(loadPlannerData);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onStartupReady).not.toHaveBeenCalled();

    await act(async () => {
      plannerData.resolve();
      await bootstrapPromise;
    });

    expect(onStartupReady).toHaveBeenCalledOnce();
  });

  it('releases the persistent root splash when planner bootstrap fails', async () => {
    authRepositoryMock.getCurrentUser.mockResolvedValue(currentUser);
    const loadPlannerData = vi.fn().mockRejectedValue(new Error('load failed'));
    const onStartupReady = vi.fn();
    renderHarness(false, onStartupReady);

    await act(async () => {
      await latestState!.bootstrapSession(loadPlannerData);
    });

    expect(onStartupReady).toHaveBeenCalledOnce();
  });

  it('hands a successful password sign-in back to the root without starting local hydration', async () => {
    authRepositoryMock.signInWithPassword.mockResolvedValue(currentUser);
    const { renderer } = renderHarness(true);
    let result: User | null | undefined = null;

    await act(async () => {
      result = await latestState!.signInWithPassword('user@example.com', 'password');
    });

    expect(authRepositoryMock.signInWithPassword).toHaveBeenCalledWith(
      'user@example.com',
      'password',
    );
    expect(result).toBeUndefined();
    expect(renderedState(renderer)).toBe('booting:anonymous');
  });

  it('hands a successful Google sign-in back to the root without starting local hydration', async () => {
    authRepositoryMock.signInWithGoogle.mockResolvedValue(currentUser);
    const { renderer } = renderHarness(true);
    let result: User | null | undefined = null;

    await act(async () => {
      result = await latestState!.signInWithGoogle();
    });

    expect(authRepositoryMock.signInWithGoogle).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
    expect(renderedState(renderer)).toBe('booting:anonymous');
  });

  it('preserves self-managed authentication when no root auth boundary is present', async () => {
    authRepositoryMock.signInWithGoogle.mockResolvedValue(currentUser);
    const { renderer } = renderHarness();
    let result: User | null | undefined = null;

    await act(async () => {
      result = await latestState!.signInWithGoogle();
    });

    expect(result).toEqual(currentUser);
    expect(renderedState(renderer)).toBe('booting:user-1');
  });
});

it('settles optional cleanup on mismatched identity without needing another auth event', async () => {
  authRepositoryMock.getCurrentUser.mockResolvedValue({ ...currentUser, id: 'different-owner' });
  const settled = vi.fn(), load = vi.fn(async () => {});
  const { renderer } = renderHarness(false, undefined, settled, 'user-1');
  await act(async () => { await latestState!.bootstrapSession(load); });
  expect(settled).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled();
  expect(renderedState(renderer)).toBe('booting:anonymous'); act(() => renderer.unmount());
});
it('optional settlement callback failures cannot alter successful bootstrap', async () => {
  authRepositoryMock.getCurrentUser.mockResolvedValue(currentUser);
  const settled = vi.fn(() => { throw new Error('optional cleanup'); });
  const { renderer, showNotice } = renderHarness(false, undefined, settled);
  await act(async () => { await latestState!.bootstrapSession(async () => {}); });
  expect(settled).toHaveBeenCalledOnce(); expect(showNotice).not.toHaveBeenCalled();
  expect(renderedState(renderer)).toBe('ready:user-1'); act(() => renderer.unmount());
});
