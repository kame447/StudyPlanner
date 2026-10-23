import { describe, expect, it } from 'vitest';
import { AI_PROXY_CHAT_REQUEST_LIMITS } from '../../../../shared/aiProxyContract';
import { FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS } from './weeklyPlanningFocusedAuthorizationV5';

describe('focused authorization completion budget', () => {
  it('leaves room for Luna reasoning tokens rather than only the visible enum answer', () => {
    // GPT-6 Luna spent 142-338 reasoning tokens per call in the #305b DEV run; 80 failed upstream.
    expect(FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS).toBe(AI_PROXY_CHAT_REQUEST_LIMITS.defaultOutputTokens);
    expect(FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS).toBeLessThanOrEqual(AI_PROXY_CHAT_REQUEST_LIMITS.maxOutputTokens);
  });
});
