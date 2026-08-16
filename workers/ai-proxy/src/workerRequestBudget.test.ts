import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PROXY_CHAT_REQUEST_LIMITS,
  measureJsonUtf8Bytes,
} from '../../../shared/aiProxyContract';
import worker from './worker';

function createEnv(allowedChatModels = 'gpt-test') {
  const quotaCalls: unknown[] = [];
  const quotaStub = {
    async checkAndConsume(input: unknown) {
      quotaCalls.push(input);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };

  return {
    env: {
      OPENAI_API_KEY: 'openai-key',
      FIREBASE_WEB_API_KEY: 'firebase-key',
      ALLOWED_ORIGIN: 'https://app.example',
      ALLOWED_CHAT_MODELS: allowedChatModels,
      AI_QUOTA: {
        getByName() {
          return quotaStub;
        },
      },
    },
    quotaCalls,
  };
}

function createHeaders(): HeadersInit {
  return {
    Authorization: 'Bearer firebase-token',
    Origin: 'https://app.example',
    'Content-Type': 'application/json',
  };
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: 'gpt-test',
    temperature: 0,
    messages: [
      { role: 'system', content: 'Return JSON.' },
      { role: 'user', content: '今日の予定を作って' },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'weekly_planning_semantic_document_v5',
        strict: true,
        schema: { type: 'object' },
      },
    },
    max_completion_tokens: 3_200,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI proxy deployed worker request budget', () => {
  it('accepts a schema-heavy request above the former 32 KiB limit and preserves 3,200 output tokens', async () => {
    const upstreamBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return new Response(JSON.stringify({
          users: [{ localId: 'user-1', emailVerified: true }],
        }), { status: 200 });
      }
      if (url.endsWith('/chat/completions')) {
        upstreamBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const payload = createPayload({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'weekly_planning_semantic_document_v5',
          strict: true,
          schema: {
            type: 'object',
            description: 'x'.repeat(40_000),
          },
        },
      },
    });
    const requestBytes = measureJsonUtf8Bytes(payload);
    expect(requestBytes).toBeGreaterThan(32 * 1024);
    expect(requestBytes).toBeLessThan(AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes);

    const { env, quotaCalls } = createEnv();
    const response = await worker.fetch(
      new Request('https://proxy.example/chat/completions', {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify(payload),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content: '{"ok":true}' });
    expect(upstreamBodies).toHaveLength(1);
    expect(upstreamBodies[0]).toMatchObject({
      model: 'gpt-test',
      temperature: 0,
      max_completion_tokens: 3_200,
    });
    expect(quotaCalls).toHaveLength(2);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('omits an unsupported custom temperature from Luna upstream requests', async () => {
    const upstreamBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return new Response(JSON.stringify({
          users: [{ localId: 'user-1', emailVerified: true }],
        }), { status: 200 });
      }
      if (url.endsWith('/chat/completions')) {
        upstreamBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const { env } = createEnv('gpt-5.6-luna');
    const response = await worker.fetch(
      new Request('https://proxy.example/chat/completions', {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify(createPayload({
          model: 'gpt-5.6-luna',
          temperature: 0,
        })),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(upstreamBodies).toHaveLength(1);
    expect(upstreamBodies[0]).toMatchObject({ model: 'gpt-5.6-luna' });
    expect(upstreamBodies[0]).not.toHaveProperty('temperature');
  });

  it('returns a typed 413 response with the actual and allowed byte counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return new Response(JSON.stringify({
          users: [{ localId: 'user-1', emailVerified: true }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const payload = createPayload({
      messages: [{
        role: 'user',
        content: 'x'.repeat(AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes),
      }],
    });
    const actualBytes = measureJsonUtf8Bytes(payload);
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request('https://proxy.example/chat/completions', {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify(payload),
      }),
      env as never,
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: 'Request body was too large.',
      errorCode: 'chat_request_body_too_large',
      limitBytes: AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes,
      actualBytes,
    });
  });

  it('keeps the per-message validation inside the expanded body budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return new Response(JSON.stringify({
          users: [{ localId: 'user-1', emailVerified: true }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const payload = createPayload({
      messages: [{
        role: 'user',
        content: 'x'.repeat(AI_PROXY_CHAT_REQUEST_LIMITS.maxMessageContentLength + 1),
      }],
    });
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request('https://proxy.example/chat/completions', {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify(payload),
      }),
      env as never,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'A message was too long.' });
  });
});
