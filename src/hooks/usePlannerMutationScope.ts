import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { ShowNotice } from './useNoticeState';

export class PlannerMutationScopeExpiredError extends Error {
  constructor() {
    super('操作中にアカウントまたはデータが切り替わりました。現在の画面を確認してください。');
    this.name = 'PlannerMutationScopeExpiredError';
  }
}

/** Only projects results into the UI that started the operation.
 * This does not cancel or roll back a repository write already in progress.
 */
export function usePlannerMutationScope(ownerId: string | null) {
  const [generation, setGeneration] = useState(0);
  const token = useMemo(() => ({ ownerId, generation }), [ownerId, generation]);
  const active = useRef<typeof token | null>(null);
  useLayoutEffect(() => {
    active.current = token;
    return () => {
      if (active.current === token) active.current = null;
    };
  }, [token]);

  const invalidate = useCallback(() => {
    active.current = null;
    setGeneration(value => value + 1);
  }, []);

  const scope = useMemo(() => {
    const isCurrent = () => active.current === token;
    return {
      isCurrent,
      bindMutation<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) {
        return async (...args: Args): Promise<Result> => {
          if (!isCurrent()) throw new PlannerMutationScopeExpiredError();
          try {
            const result = await operation(...args);
            if (!isCurrent()) throw new PlannerMutationScopeExpiredError();
            return result;
          } catch (error) {
            if (!isCurrent()) throw new PlannerMutationScopeExpiredError();
            throw error;
          }
        };
      },
      bindNotice(showNotice: ShowNotice): ShowNotice {
        return (...args) => {
          if (!isCurrent()) return;
          const options = args[2];
          const action = options?.onAction;
          if (action) args[2] = { ...options, onAction: () => isCurrent() ? action() : undefined };
          showNotice(...args);
        };
      },
    };
  }, [token]);
  return { scope, invalidate };
}

type PlannerMutationScope = ReturnType<typeof usePlannerMutationScope>['scope'];

/** The raw setter is reserved for the separately token-checked load/reset path. */
export function useScopedPlannerState<T>(
  initial: T | (() => T),
  scope: PlannerMutationScope,
): [T, Dispatch<SetStateAction<T>>, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(initial);
  const setScopedState = useMemo<Dispatch<SetStateAction<T>>>(() => (value) => {
    if (!scope.isCurrent()) return;
    setState(current => {
      if (!scope.isCurrent()) return current;
      return typeof value === 'function' ? (value as (current: T) => T)(current) : value;
    });
  }, [scope]);
  return [state, setScopedState, setState];
}
