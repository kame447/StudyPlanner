import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createOpenAiCompatibleClient,
  resetOpenAiCompatibleClientRequestBudgetForTest,
} from './openAiCompatibleClient';
import { usesCloudflareOpenAiProxy } from '../../lib/aiConfig';

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

function mockDirectResponse(response: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetOpenAiCompatibleClientRequestBudgetForTest();
});

describe('openAiCompatibleClient empty direct responses', () => {
  it('reports bounded finish and token diagnostics without leaking refusal text', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    mockDirectResponse({
      choices: [{
        finish_reason: 'length',
        message: {
          content: null,
          refusal: 'private provider refusal text that must never be persisted',
        },
      }],
      usage: {
        prompt_tokens: 2100,
        completion_tokens: 4800,
        total_tokens: 6900,
        completion_tokens_details: {
          reasoning_tokens: 4790,
          text_tokens: 10,
        },
      },
    });

    const client = createOpenAiCompatibleClient(config);
    let message = '';
    try {
      await client.createChatCompletion({
        messages: [{ role: 'user', content: 'test' }],
        maxCompletionTokens: 4800,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe(
      'AI response was empty. finish_reason=length refusal=present completion_tokens=4800 reasoning_tokens=4790',
    );
    expect(message).not.toContain('private provider refusal text');
  });

  it('uses explicit unknown markers when an empty response omits diagnostics', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    mockDirectResponse({
      choices: [{ message: { content: null } }],
    });

    const client = createOpenAiCompatibleClient(config);
    await expect(client.createChatCompletion({
      messages: [{ role: 'user', content: 'test' }],
    })).rejects.toThrow(
      'AI response was empty. finish_reason=unknown refusal=absent completion_tokens=unknown reasoning_tokens=unknown',
    );
  });
});
