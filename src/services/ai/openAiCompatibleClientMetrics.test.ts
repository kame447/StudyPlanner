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
