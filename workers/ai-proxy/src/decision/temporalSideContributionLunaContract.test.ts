import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5,
} from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedTaskTemporalSideContributionV5';
import worker from '../worker';

function environment() {
  const quota = { checkAndConsume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) };
  return {
    OPENAI_API_KEY: 'openai-fixture', FIREBASE_WEB_API_KEY: 'firebase-fixture',
    ALLOWED_ORIGIN: 'https://app.example', ALLOWED_CHAT_MODELS: 'gpt-5.6-luna',
    JEV_MODE: 'off', JEV_CANARY_PERCENT: '0', AI_QUOTA: { getByName: () => quota },
  };
}

function request(decisionContext?: Record<string, unknown>) {
  return new Request('https://proxy.example/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer firebase-token', Origin: 'https://app.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      purpose: 'weekly_planning_semantic_normalizer',
      messages: [
        { role: 'system', content: 'Return a structured temporal decision.' },
        { role: 'user', content: '火曜の夜にやります。' },
      ],
      response_format: FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5,
      max_completion_tokens: 640,
      decisionContext,
    }),
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('focused temporal-side Luna contract through the real Worker', () => {
  it.each([false, true])(
    'forwards the 640-token request to Luna; obsolete Jev context present: %s',
    async (obsoleteContext) => {
      const upstreamBodies: Record<string, unknown>[] = [];
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('identitytoolkit.googleapis.com')) {
          return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
        }
        if (url.endsWith('/chat/completions')) {
          upstreamBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json({ choices: [{ message: { content: JSON.stringify({
            decision: 'fallback', kind: null, constraintLevel: null,
            dateExpression: null, namedTimePeriod: null, startTime: null,
            endTime: null, precision: null,
          }) } }] });
        }
        throw new Error(`Unexpected provider: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const obsolete = obsoleteContext ? {
        purpose: 'temporal_side_contribution', requestId: 'obsolete-context',
        inputRevision: 7, state: { currentUserText: '火曜の夜にやります。' },
      } : undefined;
      const response = await worker.fetch(request(obsolete), environment() as never);

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(upstreamBodies).toHaveLength(1);
      expect(upstreamBodies[0]?.max_completion_tokens).toBe(640);
      expect(upstreamBodies[0]?.response_format).toEqual(
        FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5,
      );
      expect(upstreamBodies[0]).not.toHaveProperty('decisionContext');
    },
  );
});
