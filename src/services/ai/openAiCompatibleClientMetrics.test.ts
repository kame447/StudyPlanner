import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOpenAiCompatibleClient,
  resetOpenAiCompatibleClientRequestBudgetForTest,
} from './openAiCompatibleClient';
import {
  recordOpenAiCompatibleRequestMetric,
  resetOpenAiCompatibleRequestMetricsForTest,
  takeOpenAiCompatibleRequestMetrics,
} from './openAiCompatibleClientMetrics';
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
  model: 'gpt-5.6-luna',
  apiKey: 'sk-test',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  resetOpenAiCompatibleClientRequestBudgetForTest();
  resetOpenAiCompatibleRequestMetricsForTest();
});

describe('openAiCompatibleClient evaluation metrics', () => {
  it('captures request/response volume, provider usage, route and latency without storing content', async () => {
    vi.stubEnv('VITE_AI_EVAL_CAPTURE_METRICS', '1');
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'structured-result' } }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
        },
      }),
    })));

    const client = createOpenAiCompatibleClient(config);
    await client.createChatCompletion({
      messages: [{ role: 'user', content: 'semantic input' }],
      purpose: 'weekly_planning_semantic_normalizer',
    });

    const metrics = takeOpenAiCompatibleRequestMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      sequence: 1,
      purpose: 'weekly_planning_semantic_normalizer',
      phase: 'initial',
      model: 'gpt-5.6-luna',
      transport: 'direct',
      status: 'success',
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });
    expect(metrics[0]?.requestBytes).toBeGreaterThan(0);
    expect(metrics[0]?.responseBytes).toBeGreaterThan(0);
    expect(metrics[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(metrics[0]).not.toHaveProperty('messages');
    expect(metrics[0]).not.toHaveProperty('content');
  });

  it('records a failed provider request without provider text payloads', async () => {
    vi.stubEnv('VITE_AI_EVAL_CAPTURE_METRICS', '1');
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'arbitrary upstream payload',
    })));

    const client = createOpenAiCompatibleClient(config);
    await expect(client.createChatCompletion({
      messages: [{ role: 'user', content: 'private user text' }],
      purpose: 'weekly_planning_renderer',
    })).rejects.toThrow('AI request failed with status 500.');

    expect(takeOpenAiCompatibleRequestMetrics()).toEqual([
      expect.objectContaining({
        purpose: 'weekly_planning_renderer',
        phase: 'single',
        transport: 'direct',
        status: 'failure',
        responseBytes: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        providerCompletion: {
          finishReason: null, refusalPresent: null,
          requestedMaxCompletionTokens: null, effectiveMaxCompletionTokens: null,
          reasoningTokens: null, textTokens: null,
        },
      }),
    ]);
  });

  it('records exactly one metric for one failed proxy request', async () => {
    vi.stubEnv('VITE_AI_EVAL_CAPTURE_METRICS', '1');
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(true);
    vi.mocked(getCloudflareAiProxyUrl).mockReturnValue('https://proxy.test');
    vi.mocked(getFirebaseAuth).mockReturnValue({
      currentUser: {
        getIdToken: vi.fn().mockResolvedValue('firebase-token'),
      },
    } as never);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 502,
      json: async () => ({ error: 'proxy unavailable' }),
    })));

    const client = createOpenAiCompatibleClient(config);
    await expect(client.createChatCompletion({
      messages: [{ role: 'user', content: 'private proxy input' }],
      purpose: 'weekly_planning_renderer',
    })).rejects.toThrow('proxy unavailable');

    const metrics = takeOpenAiCompatibleRequestMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      purpose: 'weekly_planning_renderer',
      transport: 'proxy',
      status: 'failure',
      responseBytes: null,
    });
  });

  it('bounds retained evaluation metrics to the most recent 100 requests', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    for (let index = 0; index < 105; index += 1) {
      recordOpenAiCompatibleRequestMetric({
        purpose: 'weekly_planning_renderer',
        phase: 'single',
        model: 'gpt-5.6-luna',
        transport: 'direct',
        status: 'success',
        requestBytes: 100 + index,
        responseBytes: 10,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        durationMs: 1,
      });
    }

    const metrics = takeOpenAiCompatibleRequestMetrics();
    expect(metrics).toHaveLength(100);
    expect(metrics[0]?.sequence).toBe(6);
    expect(metrics[99]?.sequence).toBe(105);
    consoleSpy.mockRestore();
  });

  it('does not retain metrics unless evaluation capture is explicitly enabled', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    })));

    const client = createOpenAiCompatibleClient(config);
    await client.createChatCompletion({
      messages: [{ role: 'user', content: 'ordinary call' }],
    });

    expect(takeOpenAiCompatibleRequestMetrics()).toEqual([]);
  });
});

describe('direct completion observation without acceptance changes', () => {
  it.each([
    {
      label: 'stop with an omitted direct output limit',
      finishReason: 'stop', refusal: null, maxCompletionTokens: undefined,
      content: '{"reply":"private-response-sentinel"}', completionTokens: 30, reasoningTokens: 12, textTokens: 18,
      expected: { finishReason: 'stop', refusalPresent: false,
        requestedMaxCompletionTokens: null, effectiveMaxCompletionTokens: null,
        reasoningTokens: 12, textTokens: 18 },
    },
    {
      label: 'nonempty length with the unchanged 6400 direct limit',
      finishReason: 'length', refusal: null, maxCompletionTokens: 6400,
      content: '{"private-response-sentinel":', completionTokens: 6400, reasoningTokens: 6390, textTokens: 10,
      expected: { finishReason: 'length', refusalPresent: false,
        requestedMaxCompletionTokens: 6400, effectiveMaxCompletionTokens: 6400,
        reasoningTokens: 6390, textTokens: 10 },
    },
    {
      label: 'unknown finish and missing refusal without fabricated details',
      finishReason: 'private-finish-sentinel', refusal: undefined, maxCompletionTokens: 3200,
      content: '{"reply":"private-response-sentinel"}', completionTokens: 30, reasoningTokens: -1, textTokens: undefined,
      expected: { finishReason: null, refusalPresent: null,
        requestedMaxCompletionTokens: 3200, effectiveMaxCompletionTokens: 3200,
        reasoningTokens: null, textTokens: null },
    },
  ])('records $label using only bounded metadata', async (row) => {
    vi.stubEnv('VITE_AI_EVAL_CAPTURE_METRICS', '1');
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ finish_reason: row.finishReason,
          message: { content: row.content, ...(row.refusal === undefined ? {} : { refusal: row.refusal }) } }],
        usage: { prompt_tokens: 120, completion_tokens: row.completionTokens, total_tokens: 120 + row.completionTokens,
          completion_tokens_details: { reasoning_tokens: row.reasoningTokens, text_tokens: row.textTokens } },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await createOpenAiCompatibleClient(config).createChatCompletion({
        messages: [{ role: 'user', content: 'private-input-sentinel' }],
        purpose: 'weekly_planning_semantic_normalizer',
        ...(row.maxCompletionTokens === undefined ? {} : { maxCompletionTokens: row.maxCompletionTokens }),
      });
      // Observation must not turn a nonempty length response into a rejection or retry.
      expect(result).toBe(row.content);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      if (row.maxCompletionTokens === undefined) expect(sent).not.toHaveProperty('max_completion_tokens');
      else expect(sent.max_completion_tokens).toBe(row.maxCompletionTokens);
      const metrics = takeOpenAiCompatibleRequestMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({ status: 'success', transport: 'direct' });
      const observed = JSON.stringify({ metrics, logs: log.mock.calls });
      expect(observed).not.toContain('private-input-sentinel');
      expect(observed).not.toContain('private-finish-sentinel');
      expect(observed).not.toContain('private-response-sentinel');
      expect(metrics[0]).toHaveProperty('providerCompletion', row.expected);
    } finally {
      log.mockRestore();
    }
  });

  it('retains safe empty-response evidence without changing the existing error', async () => {
    vi.stubEnv('VITE_AI_EVAL_CAPTURE_METRICS', '1');
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ finish_reason: 'length', message: { content: null, refusal: 'private-refusal-sentinel' } }],
        usage: { prompt_tokens: 120, completion_tokens: 6400, total_tokens: 6520,
          completion_tokens_details: { reasoning_tokens: 6400, text_tokens: 0 } },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(createOpenAiCompatibleClient(config).createChatCompletion({
        messages: [{ role: 'user', content: 'private-input-sentinel' }],
        purpose: 'weekly_planning_renderer', maxCompletionTokens: 6400,
      })).rejects.toThrow('AI response was empty. finish_reason=length refusal=present completion_tokens=6400 reasoning_tokens=6400');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const metrics = takeOpenAiCompatibleRequestMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({ status: 'failure', transport: 'direct' });
      expect(JSON.stringify({ metrics, logs: log.mock.calls })).not.toMatch(/private-refusal-sentinel|private-input-sentinel/);
      expect(metrics[0]).toHaveProperty('providerCompletion', {
        finishReason: 'length', refusalPresent: true,
        requestedMaxCompletionTokens: 6400, effectiveMaxCompletionTokens: 6400,
        reasoningTokens: 6400, textTokens: 0,
      });
    } finally {
      log.mockRestore();
    }
  });
});

describe('direct completion evidence after an interrupted attempt', () => {
  it.each(['provider_abort', 'timeout'] as const)(
    'keeps provider facts unknown after %s without reusing an earlier success',
    async (failureKind) => {
      vi.stubEnv('VITE_AI_EVAL_CAPTURE_METRICS', '1');
      vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
      vi.useFakeTimers();
      const log = vi.spyOn(console, 'info').mockImplementation(() => {});
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({
          choices: [{ finish_reason: 'length', message: {
            content: 'private-prior-response', refusal: 'private-prior-refusal',
          } }],
          usage: { completion_tokens_details: { reasoning_tokens: 7, text_tokens: 3 } },
        }))
        .mockImplementationOnce(async (_input, init) => {
          if (failureKind === 'provider_abort') {
            throw new DOMException('Provider cancelled this attempt.', 'AbortError');
          }
          const signal = init?.signal;
          if (!signal) throw new Error('Expected the client timeout signal.');
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        });
      vi.stubGlobal('fetch', fetchMock);
      try {
        const client = createOpenAiCompatibleClient({ ...config, requestTimeoutMs: 25 });
        const input = { messages: [{ role: 'user' as const, content: 'private-input-sentinel' }] };
        await expect(client.createChatCompletion({ ...input, maxCompletionTokens: 6400 }))
          .resolves.toBe('private-prior-response');
        expect(takeOpenAiCompatibleRequestMetrics()[0].providerCompletion).toEqual({
          finishReason: 'length', refusalPresent: true,
          requestedMaxCompletionTokens: 6400, effectiveMaxCompletionTokens: 6400,
          reasoningTokens: 7, textTokens: 3,
        });

        const failure = expect(client.createChatCompletion({ ...input, maxCompletionTokens: 3200 }))
          .rejects.toThrow(failureKind === 'timeout'
            ? 'AI request timed out after 25 ms.' : 'Provider cancelled this attempt.');
        if (failureKind === 'timeout') await vi.advanceTimersByTimeAsync(25);
        await failure;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).max_completion_tokens).toBe(3200);
        const metrics = takeOpenAiCompatibleRequestMetrics();
        expect(metrics).toHaveLength(1);
        expect(metrics[0]).toMatchObject({
          sequence: 2, status: 'failure', transport: 'direct', responseBytes: null,
          promptTokens: null, completionTokens: null, totalTokens: null,
          providerCompletion: {
            finishReason: null, refusalPresent: null,
            requestedMaxCompletionTokens: 3200, effectiveMaxCompletionTokens: 3200,
            reasoningTokens: null, textTokens: null,
          },
        });
        expect(JSON.stringify({ metrics, logs: log.mock.calls })).not.toMatch(/private-/);
      } finally {
        vi.useRealTimers();
        log.mockRestore();
      }
    },
  );
});
