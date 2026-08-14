import { useCallback } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { useAdminDataLoader } from './useAdminData';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
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
