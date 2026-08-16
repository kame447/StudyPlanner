import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createOpenAiCompatibleClient,
  resetOpenAiCompatibleClientRequestBudgetForTest,
} from './openAiCompatibleClient';
import {
  getCloudflareAiProxyUrl,
  usesCloudflareOpenAiProxy,
} from '../../lib/aiConfig';
import { getFirebaseAuth } from '../../lib/firebaseClient';

vi.mock('../../lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: vi.fn(),
  usesCloudflareOpenAiProxy: vi.fn(),
}));

vi.mock('../../lib/firebaseClient', () => ({
  getFirebaseAuth: vi.fn(),
}));

const config = {
  provider: 'openai' as const,
  baseUrl: 'https://api.openai.test/v1',
  model: 'gpt-5.4-mini',
  apiKey: 'sk-test',
};

function mockFetchOnce(response: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stalledJsonResponse(signal: AbortSignal | null | undefined): Response {
  if (!(signal instanceof AbortSignal)) {
    throw new Error('AI request did not include an AbortSignal.');
  }
  return {
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  } as Response;
}

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  resetOpenAiCompatibleClientRequestBudgetForTest();
});

describe('openAiCompatibleClient model routing', () => {
  it('sends purpose (and no model) to the proxy for purpose-based calls', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(true);
    vi.mocked(getCloudflareAiProxyUrl).mockReturnValue('https://proxy.example/chat/completions');
    vi.mocked(getFirebaseAuth).mockReturnValue({
      currentUser: { getIdToken: async () => 'id-token' },
    } as unknown as ReturnType<typeof getFirebaseAuth>);
    const fetchMock = mockFetchOnce({ content: 'ok' });

    const client = createOpenAiCompatibleClient(config);
    await client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      purpose: 'weekly_planning_interpreter',
    });

    const body = lastRequestBody(fetchMock);
    expect(body.purpose).toBe('weekly_planning_interpreter');
    expect(body).not.toHaveProperty('model');
  });

  it('sends config.model (and no purpose) to the proxy for general NL calls', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(true);
    vi.mocked(getCloudflareAiProxyUrl).mockReturnValue('https://proxy.example/chat/completions');
    vi.mocked(getFirebaseAuth).mockReturnValue({
      currentUser: { getIdToken: async () => 'id-token' },
    } as unknown as ReturnType<typeof getFirebaseAuth>);
    const fetchMock = mockFetchOnce({ content: 'ok' });

    const client = createOpenAiCompatibleClient(config);
    await client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    const body = lastRequestBody(fetchMock);
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body).not.toHaveProperty('purpose');
  });

  it('uses config.model on the direct (dev) path and never sends purpose to OpenAI', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: 'ok' } }] });

    const client = createOpenAiCompatibleClient(config);
    await client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      purpose: 'weekly_planning_renderer',
    });

    const body = lastRequestBody(fetchMock);
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body).not.toHaveProperty('purpose');
  });

  it('omits temperature on the direct Luna path while preserving it for other models', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: 'ok' } }] });

    const lunaClient = createOpenAiCompatibleClient({
      ...config,
      model: 'gpt-5.6-luna',
    });
    await lunaClient.createChatCompletion({
      messages: [{ role: 'user', content: 'luna' }],
      temperature: 0,
    });
    expect(lastRequestBody(fetchMock)).not.toHaveProperty('temperature');

    const miniClient = createOpenAiCompatibleClient(config);
    await miniClient.createChatCompletion({
      messages: [{ role: 'user', content: 'mini' }],
      temperature: 0,
    });
    expect(lastRequestBody(fetchMock).temperature).toBe(0);
  });

  it('preserves bounded structured provider diagnostics for a rejected direct request', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: {
          type: 'invalid_request_error',
          code: 'unsupported_value',
          param: 'temperature',
          message: 'Unsupported value for temperature.',
        },
      }),
    })));

    const client = createOpenAiCompatibleClient(config);
    await expect(client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(
      'AI request failed with status 400. type=invalid_request_error; code=unsupported_value; param=temperature; message=Unsupported value for temperature.',
    );
  });

  it('does not persist an arbitrary non-JSON provider error body', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => 'unstructured upstream body that must not enter diagnostics',
    })));

    const client = createOpenAiCompatibleClient(config);
    await expect(client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toThrow(/^AI request failed with status 502\.$/);
  });

  it('overrides only the direct semantic model when the eval override is explicitly enabled', async () => {
    vi.stubEnv('VITE_AI_EVAL_ENABLE_PURPOSE_MODEL_OVERRIDE', '1');
    vi.stubEnv('VITE_AI_EVAL_SEMANTIC_MODEL', 'gpt-5.4-nano');
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: 'ok' } }] });
    const client = createOpenAiCompatibleClient(config);

    await client.createChatCompletion({
      messages: [{ role: 'user', content: 'semantic' }],
      purpose: 'weekly_planning_semantic_normalizer',
    });
    expect(lastRequestBody(fetchMock).model).toBe('gpt-5.4-nano');

    await client.createChatCompletion({
      messages: [{ role: 'user', content: 'renderer' }],
      purpose: 'weekly_planning_renderer',
    });
    expect(lastRequestBody(fetchMock).model).toBe('gpt-5.4-mini');
  });

  it('aborts a direct provider connection after the configured timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAiCompatibleClient({
      ...config,
      requestTimeoutMs: 25,
    });
    const request = client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });
    const rejection = expect(request).rejects.toThrow(
      'AI request timed out after 25 ms.',
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal).toMatchObject({ aborted: true });
  });

  it('keeps the direct provider timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      stalledJsonResponse(init?.signal));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAiCompatibleClient({
      ...config,
      requestTimeoutMs: 25,
    });
    const request = client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });
    const rejection = expect(request).rejects.toThrow(
      'AI request timed out after 25 ms.',
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the proxy timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(true);
    vi.mocked(getCloudflareAiProxyUrl).mockReturnValue('https://proxy.example/chat/completions');
    vi.mocked(getFirebaseAuth).mockReturnValue({
      currentUser: { getIdToken: async () => 'id-token' },
    } as unknown as ReturnType<typeof getFirebaseAuth>);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      stalledJsonResponse(init?.signal));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAiCompatibleClient({
      ...config,
      requestTimeoutMs: 25,
    });
    const request = client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      purpose: 'weekly_planning_interpreter',
    });
    const rejection = expect(request).rejects.toThrow(
      'AI request timed out after 25 ms.',
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops before fetch when the process request budget is exhausted', async () => {
    vi.stubEnv('VITE_AI_MAX_PROCESS_REQUESTS', '2');
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: 'ok' } }] });
    const client = createOpenAiCompatibleClient(config);

    await client.createChatCompletion({ messages: [{ role: 'user', content: 'one' }] });
    await client.createChatCompletion({ messages: [{ role: 'user', content: 'two' }] });
    await expect(client.createChatCompletion({
      messages: [{ role: 'user', content: 'three' }],
    })).rejects.toThrow('AI process request budget exceeded: 2.');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores invalid process request limits instead of creating an accidental zero budget', async () => {
    vi.stubEnv('VITE_AI_MAX_PROCESS_REQUESTS', 'invalid');
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: 'ok' } }] });
    const client = createOpenAiCompatibleClient(config);

    await client.createChatCompletion({ messages: [{ role: 'user', content: 'one' }] });
    await client.createChatCompletion({ messages: [{ role: 'user', content: 'two' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the bounded default timeout for invalid configuration', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const fetchMock = mockFetchOnce({ choices: [{ message: { content: 'ok' } }] });

    const client = createOpenAiCompatibleClient({
      ...config,
      requestTimeoutMs: Number.NaN,
    });
    await client.createChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).toMatchObject({ aborted: false });
  });
});
