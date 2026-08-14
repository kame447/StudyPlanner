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
  const [loadState, setLoadState] = useState<AdminDataLoadState>('loading');
  const [data, setData] = useState<T>(initialData);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    setLoadState('loading');
    setErrorMessage('');

    load()
      .then((nextData) => {
        if (!active) {
          return;
        }

        setData(nextData);
        setLoadState('ready');
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : fallbackErrorMessage,
        );
        setLoadState('error');
      });

    return () => {
      active = false;
    };
  }, [fallbackErrorMessage, load]);

  return {
    loadState,
    data,
    errorMessage,
  };
}
