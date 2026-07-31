import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiCompatibleClient } from './openAiCompatibleClient';
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

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

  it('aborts a direct provider request after the configured timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    let requestSignal: AbortSignal | null = null;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new Error('aborted')));
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
    expect(requestSignal?.aborted).toBe(true);
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
    expect(init.signal?.aborted).toBe(false);
  });
});
