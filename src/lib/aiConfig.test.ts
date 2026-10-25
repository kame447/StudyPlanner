import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAiConfig, resetAiConfig } from './aiConfig';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
    },
  });
  vi.stubEnv('PROD', false);
  vi.stubEnv('VITE_AI_PROVIDER', 'openai');
  vi.stubEnv('VITE_AI_MODEL', '');
  vi.stubEnv('VITE_AI_BASE_URL', '');
  vi.stubEnv('VITE_AI_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AI model configuration', () => {
  it('uses GPT-6 Luna when no model is configured and after resetting a tab override', () => {
    expect(getAiConfig()).toMatchObject({ provider: 'openai', model: 'gpt-6-luna' });
    storage.set('studyplanner.ai.runtime.v1', JSON.stringify({ model: 'gpt-custom' }));
    expect(getAiConfig().model).toBe('gpt-custom');
    expect(resetAiConfig().model).toBe('gpt-6-luna');
    expect(getAiConfig().model).toBe('gpt-6-luna');
  });

  it('preserves explicit environment and saved model choices', () => {
    vi.stubEnv('VITE_AI_MODEL', '  gpt-eval-model  ');
    expect(getAiConfig().model).toBe('gpt-eval-model');
    storage.set('studyplanner.ai.runtime.v1', JSON.stringify({ model: 'gpt-5.6-luna' }));
    expect(getAiConfig().model).toBe('gpt-5.6-luna');
    expect(resetAiConfig().model).toBe('gpt-eval-model');
  });

  it.each(['openai', 'rules'] as const)('preserves the validated stored %s provider', (provider) => {
    storage.set('studyplanner.ai.runtime.v1', JSON.stringify({ provider }));
    expect(getAiConfig().provider).toBe(provider);
  });

  it.each(['unsupported', '', null, 42, {}])('rejects an invalid stored provider %j at the storage boundary', (provider) => {
    vi.stubEnv('VITE_AI_PROVIDER', 'rules');
    storage.set('studyplanner.ai.runtime.v1', JSON.stringify({ provider }));
    expect(getAiConfig().provider).toBe('rules');
  });

  it('falls back to the default provider when the environment provider is invalid', () => {
    vi.stubEnv('VITE_AI_PROVIDER', 'unsupported');
    expect(getAiConfig().provider).toBe('openai');
  });

  it('keeps rules-only configuration free of a provider model', () => {
    vi.stubEnv('VITE_AI_PROVIDER', 'rules');
    expect(getAiConfig()).toEqual({ provider: 'rules', baseUrl: '', model: '', apiKey: '' });
  });
});
