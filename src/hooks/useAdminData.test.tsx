import { useCallback, useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useAdminDataLoader, type AdminDataLoadResult } from './useAdminData';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function LoadProbe({ loader }: { loader: () => Promise<string> }) {
  const stableLoader = useCallback(loader, [loader]);
  const result = useAdminDataLoader(stableLoader, 'initial', 'fallback');

  return <span>{`${result.loadState}:${result.data}:${result.errorMessage}`}</span>;
}

describe('useAdminDataLoader', () => {
  it('publishes loading and ready states for the active loader', async () => {
    const deferred = createDeferred<string>();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(<LoadProbe loader={() => deferred.promise} />);
    });
    expect(renderer.root.findByType('span').children).toEqual(['loading:initial:']);

    await act(async () => {
      deferred.resolve('ready');
      await deferred.promise;
    });

    expect(renderer.root.findByType('span').children).toEqual(['ready:ready:']);
  });

  it('ignores a stale request after the loader changes', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const firstLoader = vi.fn(() => first.promise);
    const secondLoader = vi.fn(() => second.promise);
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(<LoadProbe loader={firstLoader} />);
    });
    act(() => {
      renderer.update(<LoadProbe loader={secondLoader} />);
    });

    await act(async () => {
      second.resolve('second');
      await second.promise;
    });
    await act(async () => {
      first.resolve('first');
      await first.promise;
    });

    expect(renderer.root.findByType('span').children).toEqual(['ready:second:']);
  });
});


describe('useAdminDataLoader snapshot ownership', () => {
  function SnapshotProbe({ loader, onCommit }: {
    loader: () => Promise<string>;
    onCommit: (result: AdminDataLoadResult<string>) => void;
  }) {
    const result = useAdminDataLoader(loader, 'initial', 'fallback');
    useLayoutEffect(() => { onCommit(result); });
    return null;
  }

  it('does not commit the prior ready snapshot before the new load effect runs', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const firstLoader = () => first.promise;
    const secondLoader = () => second.promise;
    const onCommit = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<SnapshotProbe loader={firstLoader} onCommit={onCommit} />); });
    await act(async () => { first.resolve('first'); });
    expect(onCommit.mock.lastCall?.[0].data).toBe('first');
    onCommit.mockClear();
    act(() => { renderer.update(<SnapshotProbe loader={secondLoader} onCommit={onCommit} />); });
    expect(onCommit.mock.calls.length).toBeGreaterThan(0);
    for (const [result] of onCommit.mock.calls) {
      expect(result).toEqual({ loadState: 'loading', data: 'initial', errorMessage: '' });
    }
    await act(async () => { second.reject('non-Error failure'); });
    expect(onCommit.mock.lastCall?.[0]).toEqual({ loadState: 'error', data: 'initial', errorMessage: 'fallback' });
    act(() => renderer.unmount());
  });

  it('clears the old error in the first commit of a retry', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const onCommit = vi.fn();
    const firstLoader = () => first.promise;
    const secondLoader = () => second.promise;
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<SnapshotProbe loader={firstLoader} onCommit={onCommit} />); });
    await act(async () => { first.reject(new Error('first failed')); });
    expect(onCommit.mock.lastCall?.[0].errorMessage).toBe('first failed');
    onCommit.mockClear();
    act(() => { renderer.update(<SnapshotProbe loader={secondLoader} onCommit={onCommit} />); });
    expect(onCommit.mock.calls.every(([result]) => result.errorMessage === '')).toBe(true);
    await act(async () => { second.resolve('recovered'); });
    expect(onCommit.mock.lastCall?.[0]).toEqual({ loadState: 'ready', data: 'recovered', errorMessage: '' });
    act(() => renderer.unmount());
  });

  it.each(['success', 'failure'] as const)('does not publish a late %s after unmount', async (outcome) => {
    const pending = createDeferred<string>();
    const onCommit = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<SnapshotProbe loader={() => pending.promise} onCommit={onCommit} />); });
    act(() => renderer.unmount());
    onCommit.mockClear();
    await act(async () => {
      if (outcome === 'success') pending.resolve('late');
      else pending.reject(new Error('late failure'));
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not reload when a caller renders an equivalent new initial object', async () => {
    const loader = vi.fn().mockResolvedValue({ count: 17 });
    let latest: AdminDataLoadResult<{ count: number }> | undefined;
    function ObjectProbe() {
      latest = useAdminDataLoader(loader, { count: 0 }, 'fallback');
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ObjectProbe />); });
    act(() => { renderer.update(<ObjectProbe />); });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(latest).toEqual({ loadState: 'ready', data: { count: 17 }, errorMessage: '' });
    act(() => renderer.unmount());
  });
});
