import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlannerMutationScopeExpiredError, usePlannerMutationScope, useScopedPlannerState } from './usePlannerMutationScope';

let current!: ReturnType<typeof usePlannerMutationScope> & {
  value: number;
  setValue: ReturnType<typeof useScopedPlannerState<number>>[1];
};
let renderer: ReactTestRenderer | undefined;
function Harness({ ownerId }: { ownerId: string | null }) {
  const scopeState = usePlannerMutationScope(ownerId);
  const [value, setValue] = useScopedPlannerState(0, scopeState.scope);
  current = { ...scopeState, value, setValue };
  return null;
}
function render(ownerId: string | null) {
  act(() => { renderer = create(<StrictMode><Harness ownerId={ownerId} /></StrictMode>); });
}
function update(ownerId: string | null) {
  act(() => renderer!.update(<StrictMode><Harness ownerId={ownerId} /></StrictMode>));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

describe('planner mutation UI scope', () => {
  it('retains the same owner scope across ordinary renders', async () => {
    render('a');
    const original = current;
    update('a');
    act(() => original.setValue(value => value + 2));
    expect(current.value).toBe(2);
    await expect(original.scope.bindMutation(async (value: number) => value + 1)(4)).resolves.toBe(5);
  });

  it.each(['switch', 'reset', 'roundtrip', 'unmount'] as const)('invalidates setters, entry, return values and undo on %s', async (transition) => {
    render('a');
    const old = current;
    const write = deferred<string>();
    const underlying = vi.fn(() => write.promise);
    const saving = old.scope.bindMutation(underlying)().catch(error => error);
    const notice = vi.fn();
    const undo = vi.fn();
    old.scope.bindNotice(notice)('Saved', 'success', { actionLabel: 'Undo', onAction: undo });
    const undoCallback = notice.mock.calls[0][2].onAction;

    if (transition === 'reset') act(() => old.invalidate());
    else if (transition === 'roundtrip') { update('b'); update('a'); }
    else if (transition === 'unmount') act(() => renderer!.unmount());
    else update('b');

    act(() => old.setValue(99));
    expect(current.value).toBe(0);
    expect(old.scope.isCurrent()).toBe(false);
    const laterWrite = vi.fn(async () => 'unexpected');
    await expect(old.scope.bindMutation(laterWrite)()).rejects.toBeInstanceOf(PlannerMutationScopeExpiredError);
    expect(laterWrite).not.toHaveBeenCalled();
    undoCallback();
    expect(undo).not.toHaveBeenCalled();
    notice.mockClear();
    old.scope.bindNotice(notice)('Old error', 'error');
    expect(notice).not.toHaveBeenCalled();
    write.resolve('persisted for original owner');
    expect(await saving).toBeInstanceOf(PlannerMutationScopeExpiredError);
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('preserves a current-owner repository failure and notice arguments', async () => {
    render('a');
    const failure = new Error('write failed');
    await expect(current.scope.bindMutation(async () => { throw failure; })()).rejects.toBe(failure);
    const notice = vi.fn();
    current.scope.bindNotice(notice)('write failed', 'error');
    expect(notice).toHaveBeenCalledWith('write failed', 'error');
  });

  it('classifies late failure as expired without re-running the write', async () => {
    render('a');
    const write = deferred<void>();
    const operation = vi.fn(() => write.promise);
    const saving = current.scope.bindMutation(operation)().catch(error => error);
    update('b');
    write.reject(new Error('old failure'));
    expect(await saving).toBeInstanceOf(PlannerMutationScopeExpiredError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
