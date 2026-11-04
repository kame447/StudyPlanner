import { afterEach, expect, it, vi } from 'vitest';
import { AiProviderError } from '../../../../shared/aiProviderFailure';
import { DurableTurnJob, type DurableTurnExecute, type DurableTurnRecord } from './durableTurnJob';
import { createDurableVNextTurnProvider } from './durableVNextProvider';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) },
} as unknown as AiProxyWorkerEnv;
const request = { messages: [{ role: 'user' as const, content: 'hello' }], purpose: 'weekly_planning_renderer' as const };

function harness(interruptCompletion = false) {
  let record: DurableTurnRecord | undefined;
  const storage = { read: async () => structuredClone(record), write: async (next: DurableTurnRecord) => {
    if (interruptCompletion && next.status === 'completed') throw new Error('interrupted before result publication');
    record = structuredClone(next);
  }, alarmAt: async () => {} };
  const identity = { ownerId: 'alice', conversationId: 'chat', requestId: 'request', baseRevision: 0, startedAt: Date.now() };
  const execute: DurableTurnExecute = async (_raw, dispatch) => {
    try {
      await createDurableVNextTurnProvider(env, 'alice', dispatch).createChatCompletion(request);
      return JSON.stringify({ applied: true });
    } catch (error) {
      if (!(error instanceof AiProviderError)) throw error;
      return JSON.stringify({ applied: false, failure: error.providerFailure });
    }
  };
  return { identity, execute, create: () => new DurableTurnJob(storage), read: () => structuredClone(record),
    resume: () => { interruptCompletion = false; } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('replays an observed failed provider attempt after interruption without resending or losing its safe failure details', async () => {
  const provider = vi.fn(async () => Response.json({ error: { message: 'private upstream details' } }, { status: 500 }));
  vi.stubGlobal('fetch', provider);
  const h = harness(true);
  const first = h.create();
  await first.accept({ ...h.identity, payload: '{}' });
  await expect(first.run(h.execute)).rejects.toThrow('Durable turn storage operation failed.');
  expect(h.read()?.status).toBe('running');
  const receipt = h.read()?.journal?.[0];
  expect(receipt).toMatchObject({ status: 'completed' });
  if (receipt?.status !== 'completed') throw new Error('Missing observed failure receipt');
  expect(JSON.parse(receipt.response)).toMatchObject({ kind: 'vnext_provider_failure',
    failure: { kind: 'http_error', httpStatus: 502, upstreamStatus: 500 } });
  expect(receipt.response).not.toContain('private upstream details');
  expect(receipt.response).not.toContain('synthetic-key');
  h.resume();
  await h.create().run(h.execute);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(h.read()).toMatchObject({ status: 'completed' });
  expect(JSON.parse(h.read()!.result!)).toMatchObject({ applied: false,
    failure: { kind: 'http_error', httpStatus: 502, upstreamStatus: 500 } });
});

it.each([401, 403, 429])('keeps upstream access/quota failure %s terminal without another send or an accepted fallback', async status => {
  const provider = vi.fn(async () => Response.json({ error: { message: 'refused' } }, { status }));
  vi.stubGlobal('fetch', provider);
  const h = harness();
  const job = h.create();
  await job.accept({ ...h.identity, payload: '{}' });
  await job.run(h.execute);
  expect(h.read()).toMatchObject({ status: 'failed', failure: 'provider_failure' });
  expect(h.read()?.result).toBeUndefined();
  await h.create().run(h.execute);
  expect(provider).toHaveBeenCalledTimes(1);
});
