import { describe, expect, it } from 'vitest';
import { AiProviderError, projectAiProviderFailure, providerFailureFromError } from './aiProviderFailure';

describe('safe provider failure evidence', () => {
  it('does not persist arbitrary exception messages or properties', () => {
    expect(providerFailureFromError(new Error('sk-private-exception'))).toEqual({ kind: 'unknown', httpStatus: null, upstreamStatus: null, completion: null });
    const error = new AiProviderError('private provider body', { kind: 'http_error', httpStatus: 502, upstreamStatus: 429 });
    expect(JSON.stringify(providerFailureFromError(error))).not.toContain('private');
    expect(projectAiProviderFailure({ ...error.providerFailure, token: 'sk-private', url: 'private.example' })).toEqual(error.providerFailure);
  });
  it('rejects invalid enum/status and malformed completion evidence', () => {
    expect(projectAiProviderFailure({ kind: 'provider-private-value', httpStatus: 999, upstreamStatus: '429', completion: { token: 'private' } })).toEqual({
      kind: 'unknown', httpStatus: null, upstreamStatus: null, completion: null,
    });
  });
});
