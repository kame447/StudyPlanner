import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS,
} from '../../../../src/features/weeklyPlanning/security/weeklyPlanningIssue152AdversarialCorpus';
import worker from '../worker';

function environment() {
  const quotaStub = {
    checkAndConsume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  };
  return {
    OPENAI_API_KEY: 'openai-fixture',
    OPENROUTER_API_KEY: 'openrouter-fixture',
    FIREBASE_WEB_API_KEY: 'firebase-fixture',
    ALLOWED_ORIGIN: 'https://app.example',
    ALLOWED_CHAT_MODELS: 'gpt-5.6-luna',
    JEV_MODE: 'canary',
    JEV_CANARY_PERCENT: '100',
    AI_QUOTA: { getByName: () => quotaStub },
  };
}

function focusedRequest(id: string, sourceText: string, contextOverrides = {}): Request {
  return new Request('https://proxy.example/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer firebase-token',
      Origin: 'https://app.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      purpose: 'weekly_planning_semantic_normalizer',
      messages: [
        { role: 'system', content: 'Return the requested JSON decision.' },
        { role: 'user', content: sourceText },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 60,
      decisionContext: {
        purpose: 'temporal_scope_repair',
        requestId: `worker-temporal-security-${id}`,
        inputRevision: 7,
        state: {
          sourceText,
          currentAttachedTask: { title: '数学の問題集' },
          interpretedTime: {
            dateExpression: 'weekday:tuesday',
            namedTimePeriod: null,
            startTime: '18:00',
            endTime: '20:00',
          },
        },
        ...contextOverrides,
      },
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Issue #335 temporal-scope Worker response containment', () => {
  it.each(WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS)(
    'keeps high-confidence attack $id inside the real handler decision envelope',
    async ({ id, text }) => {
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('identitytoolkit.googleapis.com')) {
          return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
        }
        if (url === 'https://openrouter.ai/api/alpha/decisions') {
          const body = JSON.parse(String(init?.body)) as {
            state: { sourceText: string };
          };
          expect(Object.keys(body.state).sort()).toEqual([
            'currentAttachedTask',
            'interpretedTime',
            'sourceText',
          ]);
          const decision = body.state.sourceText.length % 2 === 0
            ? 'plan_unavailable'
            : 'uncertain';
          return Response.json({
            model: 'typesafe/jev-1.13',
            answers: {
              temporal_scope: {
                type: 'choice',
                choice: decision,
                confidence: 0.999,
                probabilities: decision === 'plan_unavailable'
                  ? { plan_unavailable: 0.999, uncertain: 0.001 }
                  : { plan_unavailable: 0.001, uncertain: 0.999 },
              },
              condition_change: { type: 'noul', noul: 0.001 },
              independent_meaning: { type: 'noul', noul: 0.001 },
            },
            usage: { input_tokens: 10, output_tokens: 2, cost: 0.000001 },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }));

      const response = await worker.fetch(
        focusedRequest(id, text),
        environment() as never,
      );
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['content', 'decisionContext']);
      expect(body.decisionContext).toEqual({
        requestId: `worker-temporal-security-${id}`,
        inputRevision: 7,
      });
      const content = JSON.parse(String(body.content)) as Record<string, unknown>;
      expect(Object.keys(content)).toEqual(['decision']);
      expect(['plan_unavailable', 'uncertain']).toContain(content.decision);
    },
  );

  it('rejects a malformed known purpose before either paid provider', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
      }
      throw new Error(`Paid provider should not be called: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(
      focusedRequest('invalid-known', 'test', { state: { sourceText: 'missing typed fields' } }),
      environment() as never,
    );
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores an unknown future purpose and sends no decision context to Luna', async () => {
    const upstreamBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
      }
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        upstreamBodies.push(body);
        return Response.json({ choices: [{ message: { content: '{"decision":"uncertain"}' } }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    const request = focusedRequest('future', 'test', {
      purpose: 'temporal_scope_repair_future',
      futureField: true,
    });
    const response = await worker.fetch(request, environment() as never);

    expect(response.status).toBe(200);
    expect(upstreamBodies).toHaveLength(1);
    expect(upstreamBodies[0]).not.toHaveProperty('decisionContext');
  });

  it('omits decision context from the real Luna repair fallback', async () => {
    const upstreamBodies: Record<string, unknown>[] = [];
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
      }
      if (url === 'https://openrouter.ai/api/alpha/decisions') {
        return Response.json({
          model: 'typesafe/jev-1.13',
          answers: {
            temporal_scope: {
              type: 'choice',
              choice: 'plan_unavailable',
              confidence: 0.5,
              probabilities: { plan_unavailable: 0.5, uncertain: 0.5 },
            },
            condition_change: { type: 'noul', noul: 0.2 },
            independent_meaning: { type: 'noul', noul: 0.2 },
          },
          usage: { input_tokens: 10, output_tokens: 2 },
        });
      }
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        upstreamBodies.push(body);
        return Response.json({
          choices: [{ message: { content: '{"decision":"uncertain"}' } }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const response = await worker.fetch(
      focusedRequest('luna-fallback', 'この数学だけ火曜の夜を避けてください。'),
      environment() as never,
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as { content: string };
    expect(JSON.parse(payload.content)).toEqual({ decision: 'uncertain' });
    expect(upstreamBodies).toHaveLength(1);
    expect(upstreamBodies[0]).not.toHaveProperty('decisionContext');
  });
});
