import { expect, it, vi } from 'vitest';
import { createStartupSessionScope } from './startupSessionScope';

it('revokes synchronously once, tolerates one failed disposer, and rejects late registration', () => {
  const scope = createStartupSessionScope();
  const forgotten = vi.fn(); scope.onInvalidate(forgotten)();
  const first = vi.fn(() => { expect(scope.isCurrent()).toBe(false); throw new Error('optional failure'); });
  const second = vi.fn(); scope.onInvalidate(first); scope.onInvalidate(second);
  scope.invalidate(); scope.invalidate();
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce(); expect(forgotten).not.toHaveBeenCalled();
  const late = vi.fn(); scope.onInvalidate(late)(); expect(late).toHaveBeenCalledOnce();
});
it('keeps a new same-owner lifetime independent of old callbacks', () => {
  const old = createStartupSessionScope(), next = createStartupSessionScope();
  const stop = vi.fn(); next.onInvalidate(stop); old.invalidate();
  expect(next.isCurrent()).toBe(true); expect(stop).not.toHaveBeenCalled();
  next.invalidate(); expect(stop).toHaveBeenCalledOnce();
});
