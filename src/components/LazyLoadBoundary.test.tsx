import { lazy, Suspense } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { LazyLoadBoundary } from './LazyLoadBoundary';

const Failing = lazy(() => Promise.reject(new Error('simulated chunk delivery failure')));
let renderer: ReactTestRenderer | undefined;
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });

it('shows a closable alert instead of unmounting the tree when a lazy chunk fails to load', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const onClose = vi.fn();
  await act(async () => {
    renderer = create(<main><LazyLoadBoundary message="読み込めませんでした。再読み込みしてください。" onClose={onClose}>
      <Suspense fallback={null}><Failing /></Suspense>
    </LazyLoadBoundary></main>);
  });
  expect(renderer!.toJSON()).not.toBeNull();
  expect(renderer!.root.findByProps({ role: 'alert' }).findByType('p').children.join('')).toBe('読み込めませんでした。再読み込みしてください。');
  act(() => renderer!.root.findByType('button').props.onClick());
  expect(onClose).toHaveBeenCalledTimes(1);
});
