import { authRepository } from '../repositories';
import { startupProfileObservation } from '../lib/startupProfileObservation';
import { useStartupObservation } from './useStartupObservation';

export function useStartupProfileObservation({ enabled = startupProfileObservation === 'observe', preferenceStatus, ...options
}: Omit<Parameters<typeof useStartupObservation>[0], 'observe' | 'enabled' | 'status'> & { enabled?: boolean; preferenceStatus: Parameters<typeof useStartupObservation>[0]['status'] }) {
  return useStartupObservation({ ...options, status: preferenceStatus, enabled, observe: authRepository.observeStartupProfile });
}
