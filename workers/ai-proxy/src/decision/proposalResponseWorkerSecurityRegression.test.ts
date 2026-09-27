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

function focusedRequest(id: string, userText: string, contextOverrides = {}): Request {
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
        { role: 'system', content: 'Return the weekly planning semantic document.' },
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096,
      decisionContext: {
        purpose: 'proposal_response',
        requestId: `worker-proposal-security-${id}`,
        inputRevision: 7,
        state: {
          currentUserText: userText.slice(0, 180) || 'いいえ',
          presentedAssistantText: '英単語は1回15〜30分の分散学習にしますか？',
          proposal: {
            kind: 'spaced_memory_practice',
            taskTitle: '英単語',
            sessionMinutes: { min: 15, max: 30 },
          },
        },
        ...contextOverrides,
      },
    }),
  });
}

const LUNA_DOCUMENT = '{"schemaVersion":"generic-luna-document","decisions":[]}';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Issue #335 proposal-response Worker routing / response-envelope containment', () => {
  it.each(WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS)(
    'keeps high-confidence attack $id inside the closed decision or the generic Luna document',
    async ({ id, text }) => {
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('identitytoolkit.googleapis.com')) {
          return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
        }
        if (url === 'https://openrouter.ai/api/alpha/decisions') {
          const body = JSON.parse(String(init?.body)) as {
            state: { currentUserText: string };
          };
          expect(Object.keys(body.state).sort()).toEqual([
            'currentUserText',
            'presentedAssistantText',
            'proposal',
          ]);
          const decision = body.state.currentUserText.length % 2 === 0 ? 'reject_only' : 'other';
          return Response.json({
            model: 'typesafe/jev-1.13',
            answers: {
              proposal_response: {
                type: 'choice',
                choice: decision,
                confidence: 0.999,
                probabilities: decision === 'reject_only'
                  ? { reject_only: 0.999, other: 0.001 }
                  : { reject_only: 0.001, other: 0.999 },
              },
              condition_change: { type: 'noul', noul: 0.001 },
              independent_meaning: { type: 'noul', noul: 0.001 },
            },
            usage: { input_tokens: 10, output_tokens: 2, cost: 0.000001 },
          });
        }
        if (url.endsWith('/chat/completions')) {
          const upstream = JSON.parse(String(init?.body)) as Record<string, unknown>;
          expect(upstream).not.toHaveProperty('decisionContext');
          return Response.json({ choices: [{ message: { content: LUNA_DOCUMENT } }] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }));

      const response = await worker.fetch(
        focusedRequest(id, text),
        environment() as never,
      );
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      const content = JSON.parse(String(body.content)) as Record<string, unknown>;
      if ('proposalResponse' in content) {
        expect(Object.keys(body).sort()).toEqual(['content', 'decisionContext']);
        expect(body.decisionContext).toEqual({
          requestId: `worker-proposal-security-${id}`,
          inputRevision: 7,
        });
        expect(content).toEqual({
          proposalResponse: {
            decision: 'reject_only',
            requestId: `worker-proposal-security-${id}`,
            inputRevision: 7,
          },
        });
      } else {
        // Abstained: the unchanged generic Luna document, with no decision authority added.
        expect(body.content).toBe(LUNA_DOCUMENT);
        expect(body).not.toHaveProperty('decisionContext');
      }
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
      focusedRequest('invalid-known', 'いいえ', { state: { currentUserText: 'いいえ' } }),
      environment() as never,
    );
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects the purpose on a non-semantic request before either paid provider', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
      }
      throw new Error(`Paid provider should not be called: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const request = focusedRequest('wrong-purpose', 'いいえ');
    const payload = JSON.parse(await request.text()) as Record<string, unknown>;
    const response = await worker.fetch(new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ ...payload, purpose: 'weekly_planning_renderer' }),
    }), environment() as never);
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the unchanged generic request, without decision context, to Luna in off mode', async () => {
    const upstreamBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
      }
      if (url.endsWith('/chat/completions')) {
        upstreamBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ choices: [{ message: { content: LUNA_DOCUMENT } }] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    const response = await worker.fetch(
      focusedRequest('off', 'いいえ'),
      { ...environment(), JEV_MODE: 'off', JEV_CANARY_PERCENT: '0' } as never,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content: LUNA_DOCUMENT });
    expect(upstreamBodies).toHaveLength(1);
    expect(upstreamBodies[0]).not.toHaveProperty('decisionContext');
    expect(upstreamBodies[0]?.max_completion_tokens).toBe(4096);
  });
});
