import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { usePlannerMutationScope, useScopedPlannerState } from './usePlannerMutationScope';

type Scope = ReturnType<typeof usePlannerMutationScope>['scope'];
type Update<T> = (current: T) => T;
type Operation<T> = {
  id: symbol;
  update: Update<T>;
  status: 'pending' | 'committed' | 'rejected';
};
type State<T> = { base: T; operations: readonly Operation<T>[] };

function project<T>(state: State<T>): T {
  return state.operations.reduce(
    (current, operation) => operation.status === 'rejected' ? current : operation.update(current),
    state.base,
  );
}

function compact<T>(state: State<T>): State<T> {
  let base = state.base;
  let index = 0;
  while (index < state.operations.length && state.operations[index].status !== 'pending') {
    const operation = state.operations[index++];
    if (operation.status === 'committed') base = operation.update(base);
  }
  return { base, operations: state.operations.slice(index) };
}

/**
 * A UI-only optimistic projection. Rejected operations are removed from the
 * projection instead of restoring an old whole-state snapshot.
 *
 * Updates must be pure: React may evaluate them repeatedly. This is neither a
 * durable queue nor a server write-order/transaction authority.
 */
export function useOptimisticPlannerState<T>(initial: T, scope: Scope) {
  const [state, setState, rawSetState] = useScopedPlannerState<State<T>>(
    () => ({ base: initial, operations: [] }),
    scope,
  );
  const actions = useMemo(() => {
    const append = (update: Update<T>, status: Operation<T>['status']) => {
      const id = Symbol('optimistic UI operation');
      setState(current => compact({
        ...current,
        operations: [...current.operations, { id, update, status }],
      }));
      return id;
    };
    const settle = (id: symbol, status: 'committed' | 'rejected') => {
      setState(current => {
        if (!current.operations.some(operation => operation.id === id)) return current;
        return compact({
          ...current,
          operations: current.operations.map(operation =>
            operation.id === id ? { ...operation, status } : operation),
        });
      });
    };
    const set: Dispatch<SetStateAction<T>> = value => {
      append(current => typeof value === 'function'
        ? (value as Update<T>)(current) : value, 'committed');
    };
    // A token-checked authoritative load/reset supersedes the local projection.
    // Late completions of operations removed by this replacement are no-ops.
    const replace: Dispatch<SetStateAction<T>> = value => {
      rawSetState(current => ({
        base: typeof value === 'function' ? (value as Update<T>)(project(current)) : value,
        operations: [],
      }));
    };
    return {
      set,
      replace,
      begin: (update: Update<T>) => append(update, 'pending'),
      commit: (id: symbol) => settle(id, 'committed'),
      reject: (id: symbol) => settle(id, 'rejected'),
    };
  }, [setState, rawSetState]);
  const value = useMemo(() => project(state), [state]);
  return { value, ...actions };
}
