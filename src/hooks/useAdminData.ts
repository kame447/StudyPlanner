import { useEffect, useState } from 'react';

export type AdminDataLoadState = 'loading' | 'ready' | 'error';

export interface AdminDataLoadResult<T> {
  loadState: AdminDataLoadState;
  data: T;
  errorMessage: string;
}

export function useAdminDataLoader<T>(
  load: () => Promise<T>,
  initialData: T,
  fallbackErrorMessage: string,
): AdminDataLoadResult<T> {
  const [snapshot, setSnapshot] = useState<{
    owner: typeof load;
    result: AdminDataLoadResult<T>;
  }>(() => ({
    owner: load,
    result: { loadState: 'loading', data: initialData, errorMessage: '' },
  }));

  useEffect(() => {
    let active = true;
    setSnapshot({
      owner: load,
      result: { loadState: 'loading', data: initialData, errorMessage: '' },
    });

    load()
      .then((data) => {
        if (!active) return;
        setSnapshot({ owner: load, result: { loadState: 'ready', data, errorMessage: '' } });
      })
      .catch((error) => {
        if (!active) return;
        setSnapshot({
          owner: load,
          result: {
            loadState: 'error',
            data: initialData,
            errorMessage: error instanceof Error ? error.message : fallbackErrorMessage,
          },
        });
      });

    return () => {
      active = false;
    };
    // initialData is the empty snapshot for this load, not a request dependency.
    // Callers may construct an equivalent initial object on every render.
  }, [fallbackErrorMessage, load]);

  // Hide the previous query's snapshot in the new query's first render,
  // before the passive effect resets its loading state.
  return snapshot.owner === load
    ? snapshot.result
    : { loadState: 'loading', data: initialData, errorMessage: '' };
}
