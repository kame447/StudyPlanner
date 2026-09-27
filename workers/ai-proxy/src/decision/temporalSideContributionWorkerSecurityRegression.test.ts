import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS,
} from '../../../../src/features/weeklyPlanning/security/weeklyPlanningIssue152AdversarialCorpus';
import worker from '../worker';

function environment() {
  const quota = { checkAndConsume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) };
  return {
    OPENAI_API_KEY: 'openai-fixture', OPENROUTER_API_KEY: 'openrouter-fixture',
    FIREBASE_WEB_API_KEY: 'firebase-fixture', ALLOWED_ORIGIN: 'https://app.example',
    ALLOWED_CHAT_MODELS: 'gpt-5.6-luna', JEV_MODE: 'canary',
    JEV_CANARY_PERCENT: '100', AI_QUOTA: { getByName: () => quota },
  };
}

function request(id: string, text: string, contextOverrides = {}): Request {
  return new Request('https://proxy.example/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer firebase-token', Origin: 'https://app.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      purpose: 'weekly_planning_semantic_normalizer',
      messages: [
        { role: 'system', content: 'Return only the requested structured decision.' },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 640,
      decisionContext: {
        purpose: 'temporal_side_contribution',
        requestId: `temporal-side-worker-${id}`, inputRevision: 7,
        state: {
          currentUserText: text,
          knownTask: { title: '数学の問題集', category: 'study' },
          pendingQuestion: { questionCode: 'missing_schedulable_work' },
        },
        ...contextOverrides,
      },
    }),
  });
}

function jevResponse(confidence = 0.999) {
  return Response.json({
    model: 'typesafe/jev-1.13',
    answers: {
      temporal_side_contribution: {
        type: 'choice', choice: 'no_temporal_side_contribution', confidence,
        probabilities: {
          no_temporal_side_contribution: confidence,
          temporal_constraint_present: 1 - confidence,
          uncertain: 0, other: 0,
        },
      },
      temporal_possibility: { type: 'noul', noul: 0.001 },
      target_ambiguity: { type: 'noul', noul: 0.001 },
    },
    usage: { input_tokens: 10, output_tokens: 2, cost: 0.000001 },
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Issue #335 temporal-side Worker routing and response containment', () => {
  it.each(WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS)(
    'contains high-confidence Jev output for attack $id',
    async ({ id, text }) => {
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('identitytoolkit.googleapis.com')) {
          return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
        }
        if (url === 'https://openrouter.ai/api/alpha/decisions') {
          const body = JSON.parse(String(init?.body)) as { state: Record<string, unknown> };
          expect(Object.keys(body.state).sort()).toEqual([
            'currentUserText', 'knownTask', 'pendingQuestion',
          ]);
          return jevResponse();
        }
        throw new Error(`Unexpected paid provider: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const response = await worker.fetch(request(id, text), environment() as never);
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['content', 'decisionContext']);
      expect(body.decisionContext).toEqual({
        requestId: `temporal-side-worker-${id}`, inputRevision: 7,
      });
      const content = JSON.parse(String(body.content)) as Record<string, unknown>;
      expect(content).toEqual({ decision: 'no_temporal_side_contribution' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects malformed known purpose before a paid provider', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
      }
      throw new Error('Paid provider must not be called.');
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request('invalid', 'test', {
      state: { currentUserText: 'missing typed fields' },
    }), environment() as never);
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores an unknown future purpose and sends it to Luna without decision context', async () => {
    const upstreamBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
      }
      if (url.endsWith('/chat/completions')) {
        upstreamBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ choices: [{ message: { content: '{"decision":"fallback"}' } }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    const response = await worker.fetch(request('future', 'test', {
      purpose: 'temporal_side_contribution_future', futureField: true,
    }), environment() as never);
    expect(response.status).toBe(200);
    expect(upstreamBodies).toHaveLength(1);
    expect(upstreamBodies[0]).not.toHaveProperty('decisionContext');
  });

  it('sends no decision context to Luna after a low-confidence Jev result', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const upstreamBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
      }
      if (url === 'https://openrouter.ai/api/alpha/decisions') return jevResponse(0.5);
      if (url.endsWith('/chat/completions')) {
        upstreamBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({
          choices: [{ message: { content: JSON.stringify({
            decision: 'fallback', kind: null, constraintLevel: null,
            dateExpression: null, namedTimePeriod: null, startTime: null,
            endTime: null, precision: null,
          }) } }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    const response = await worker.fetch(request('fallback', '火曜の夜にやります。'), environment() as never);
    expect(response.status).toBe(200);
    expect(upstreamBodies).toHaveLength(1);
    expect(upstreamBodies[0]).not.toHaveProperty('decisionContext');
    expect(upstreamBodies[0]?.max_completion_tokens).toBe(640);
  });
});
