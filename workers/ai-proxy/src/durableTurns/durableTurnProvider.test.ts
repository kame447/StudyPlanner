import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDurableTurnProvider } from './durableTurnProvider';
import type { AiProxyWorkerEnv } from '../worker';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('durable provider uses the existing proxy policy', () => {
  it('keeps per-IP/per-owner quota, purpose model, token budget and timeout', async () => {
    const checkAndConsume = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })); const getByName = vi.fn(() => ({ checkAndConsume }));
    const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna', AI_QUOTA: { getByName } } as unknown as AiProxyWorkerEnv;
    const fetch = vi.fn(async () => Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: 'reply' } }] })); vi.stubGlobal('fetch', fetch);
    const dispatch = vi.fn(async (_request: string, send: () => Promise<string>) => send());
    const client = createDurableTurnProvider(env, 'alice', dispatch, '192.0.2.10');
    expect(await client.createChatCompletion({ messages: [{ role: 'user', content: 'hello' }], purpose: 'weekly_planning_renderer' })).toBe('reply');
    expect(getByName.mock.calls.map(([name]) => name)).toEqual(['ip:192.0.2.10', 'uid:alice']);
    const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string)).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 800 });
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
    expect(dispatch).toHaveBeenCalledTimes(1); expect(dispatch.mock.calls[0][0]).not.toContain('server-key');
  });
  it('quota failure prevents the provider request', async () => {
    const env = { OPENAI_API_KEY: 'server-key', AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: false, retryAfterSeconds: 10 }) }) } } as unknown as AiProxyWorkerEnv;
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const client = createDurableTurnProvider(env, 'alice', async (_request, send) => send());
    await expect(client.createChatCompletion({ messages: [{ role: 'user', content: 'hello' }], purpose: 'weekly_planning_renderer' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('caps each dispatch by the remaining alarm execution deadline', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna', AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: 'reply' } }] })));
    const client = createDurableTurnProvider(env, 'alice', async (_request, send) => send(), 'unknown', Date.now() + 2500);
    await client.createChatCompletion({ messages: [{ role: 'user', content: 'hello' }], purpose: 'weekly_planning_renderer' });
    expect(timeout.mock.calls[0][0]).toBeGreaterThan(0);
    expect(timeout.mock.calls[0][0]).toBeLessThanOrEqual(2500);
  });

  it.each([new DOMException('private timeout details', 'TimeoutError'), new TypeError('private network details')])(
    'retains a safe transport classification instead of a generic provider_error', async error => {
      const env = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna', AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
      const fetch = vi.fn(async () => { throw error; }); vi.stubGlobal('fetch', fetch);
      const client = createDurableTurnProvider(env, 'alice', async (_request, send) => send());
      await expect(client.createChatCompletion({ messages: [{ role: 'user', content: 'hello' }], purpose: 'weekly_planning_renderer' }))
        .rejects.toMatchObject({ providerFailure: { kind: error.name === 'TimeoutError' ? 'timeout' : 'network_error', httpStatus: 502, upstreamStatus: null } });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

});
