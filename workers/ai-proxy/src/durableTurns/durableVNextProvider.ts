import { AiProviderError, type AiProviderFailure } from '../../../../shared/aiProviderFailure';
import type { AiProxyWorkerEnv } from '../worker';
import type { DurableTurnExecute } from './durableTurnJob';
import { createDurableTurnProvider } from './durableTurnProvider';

function isObservedProviderFailure(error: unknown): error is AiProviderError {
  if (!(error instanceof AiProviderError)) return false;
  const failure = error.providerFailure;
  if ([failure.httpStatus, failure.upstreamStatus].some(status => status === 401 || status === 403)) return false;
  const status = failure.upstreamStatus ?? failure.httpStatus;
  return failure.kind === 'timeout' || failure.kind === 'network_error'
    || (failure.kind === 'http_error' && status !== null && status >= 500);
}

/** VNext can finish an unapplied conversation turn after an observed provider failure.
 * Journal that failure before exposing it to the interpreter, so replay never resends it.
 * Unknown completion, storage errors and access failures keep the job's existing stop rules.
 */
export function createDurableVNextTurnProvider(
  env: AiProxyWorkerEnv,
  ownerId: string,
  dispatch: Parameters<DurableTurnExecute>[1],
  sourceIp?: string,
  deadlineAt?: number,
) {
  const observedDispatch: Parameters<DurableTurnExecute>[1] = async (request, send) => {
    const raw = await dispatch(request, async () => {
      try { return await send(); }
      catch (error) {
        if (!isObservedProviderFailure(error)) throw error;
        return JSON.stringify({ kind: 'vnext_provider_failure', failure: error.providerFailure });
      }
    });
    // Healthy historical journal responses retain their original bytes and remain replayable.
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'vnext_provider_failure'
      && 'failure' in value) {
      throw new AiProviderError('Durable VNext provider request failed.', value.failure as AiProviderFailure);
    }
    return raw;
  };
  return createDurableTurnProvider(env, ownerId, observedDispatch, sourceIp, deadlineAt);
}
