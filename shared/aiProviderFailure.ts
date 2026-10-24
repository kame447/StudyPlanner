import { isProviderCompletionMetadata, type ProviderCompletionMetadata } from './aiProxyContract';

const FAILURE_KINDS = ['http_error', 'timeout', 'aborted', 'network_error', 'empty_response', 'invalid_response',
  'response_too_large', 'model_mismatch', 'context_mismatch', 'unknown'] as const;
export interface AiProviderFailure {
  kind: typeof FAILURE_KINDS[number];
  httpStatus: number | null;
  upstreamStatus: number | null;
  completion: ProviderCompletionMetadata | null;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function status(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : null;
}
/** Never copy free-form error messages, URLs, tokens, headers or extra properties into traces. */
export function projectAiProviderFailure(value: unknown): AiProviderFailure {
  const data = record(value) ? value : {};
  return {
    kind: (FAILURE_KINDS as readonly unknown[]).includes(data.kind) ? data.kind as AiProviderFailure['kind'] : 'unknown',
    httpStatus: status(data.httpStatus), upstreamStatus: status(data.upstreamStatus),
    completion: isProviderCompletionMetadata(data.completion) ? { ...data.completion } : null,
  };
}
export class AiProviderError extends Error {
  readonly providerFailure: AiProviderFailure;
  constructor(message: string, failure: Partial<AiProviderFailure>) {
    super(message);
    this.name = 'AiProviderError';
    this.providerFailure = Object.freeze(projectAiProviderFailure(failure));
  }
}
export function providerFailureFromError(error: unknown): AiProviderFailure {
  try { return projectAiProviderFailure(record(error) ? error.providerFailure : undefined); }
  catch { return projectAiProviderFailure(undefined); }
}
