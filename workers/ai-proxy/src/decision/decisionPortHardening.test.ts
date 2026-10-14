import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import legacyWorker from '../index';
import traceWorker from '../traceWorker';
import { ProductObservabilityStore } from '../productObservabilityStore';
import { AI_CHAT_PURPOSE_MODELS } from '../modelPolicy';
import { MAX_OPENAI_RESPONSE_BYTES, readBoundedOpenAiResponse } from '../providerResponseBody';
import { safeProviderErrorMetadata } from '../providerErrorMetadata';

const env = { OPENAI_API_KEY: 'private-key-sentinel', FIREBASE_WEB_API_KEY: 'fixture-public-key',
  ALLOWED_ORIGIN: 'https://app.fixture',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } };
function request(path = '/chat/completions') {
  return new Request(`https://proxy.fixture${path}`, { method: 'POST',
    headers: { Authorization: 'Bearer fixture-session', Origin: 'https://app.fixture', 'Content-Type': 'application/json' },
    body: JSON.stringify(path === '/chat/completions'
      ? { purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: 'private-input-sentinel' }] }
      : { mimeType: path === '/planning-transcription' ? 'audio/webm' : 'image/png', base64: 'aGVsbG8=' }) });
}
function transport(provider: () => Response | Promise<Response>) {
  const mock = vi.fn<typeof fetch>(async input => String(input).includes('identitytoolkit')
    ? Response.json({ users: [{ localId: 'fixture-owner', emailVerified: true }] }) : provider());
  vi.stubGlobal('fetch', mock);
  return mock;
}
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('bounded Luna response and ordinary error-log privacy', () => {
  // Astra1's independent red oracle, strengthened with exact read counts.
  it('does not emit an unvalidated second value from a diagnostic name accessor', () => {
    const error = new Error('raw input and key in message must stay private');
    let reads = 0;
    Object.defineProperty(error, 'name', {
      get() { return ++reads === 1 ? 'Error' : 'RAW_INPUT_SECRET_SENTINEL'; },
    });
    const metadata = safeProviderErrorMetadata(error);
    expect(JSON.stringify(metadata)).not.toContain('RAW_INPUT_SECRET_SENTINEL');
    expect(metadata.name).toBe('Error');
    expect(reads).toBe(1);
  });

  it('reads a changing diagnostic code accessor once and contains throwing names', () => {
    const error = new Error('private-message');
    let reads = 0;
    Object.defineProperty(error, 'code', {
      get() { return ++reads === 1 ? 'ECONNRESET' : 'RAW_CODE_SECRET_SENTINEL'; },
    });
    expect(safeProviderErrorMetadata(error)).toEqual({ name: 'Error', code: 'ECONNRESET' });
    expect(reads).toBe(1);
    const throwing = Object.defineProperty(new Error('private-key-sentinel'), 'name', {
      get() { throw new Error('private-name-sentinel'); },
    });
    expect(safeProviderErrorMetadata(throwing)).toEqual({ name: 'unknown', code: null });
  });

  it.each([
    { path: '/planning-attachment', error: 'AI planning image analysis failed.', body: {
      model: AI_CHAT_PURPOSE_MODELS.weekly_planning_attachment,
      choices: [{ message: { content: '{"text":"bounded-baseline"}' } }],
    } },
    { path: '/planning-transcription', error: 'AI voice transcription failed.', body: { text: 'bounded-baseline' } },
  ])('$path cancels overflow and preserves its existing upstream error', async ({ path, error, body }) => {
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const atCap = new Uint8Array(MAX_OPENAI_RESPONSE_BYTES).fill(0x20); atCap.set(encoded);
    const chunks = [atCap, new Uint8Array([0x20]), new Uint8Array(4096).fill(0x20)];
    let pulled = 0; let cancelled = false;
    const mock = transport(() => new Response(new ReadableStream<Uint8Array>({
      pull(controller) { const chunk = chunks[pulled++]; if (chunk) controller.enqueue(chunk); else controller.close(); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 })));
    const response = await worker.fetch(request(path), env as never);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error });
    expect(pulled).toBe(2); expect(cancelled).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('an upstream cancellation acknowledgement cannot delay overflow rejection', async () => {
    const chunks = [new Uint8Array(MAX_OPENAI_RESPONSE_BYTES), new Uint8Array([1])];
    let pulled = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(chunks[pulled++]); },
      cancel: () => new Promise(() => undefined),
    }, { highWaterMark: 0 }));
    expect(await readBoundedOpenAiResponse(response)).toBeNull();
    expect(pulled).toBe(2);
  });

  it('an error diagnostic getter cannot replace a request result or reveal content', () => {
    const error = Object.defineProperty(new Error('private-key-sentinel'), 'code', {
      get() { throw new Error('private-input-sentinel'); },
    });
    expect(safeProviderErrorMetadata(error)).toEqual({ name: 'unknown', code: null });
  });

  it.each([worker, legacyWorker])('accepts exact cap but stops a chunked response at the first byte above it', async endpoint => {
    const encoded = new TextEncoder().encode(JSON.stringify({ model: AI_CHAT_PURPOSE_MODELS.weekly_planning_semantic_normalizer,
      choices: [{ message: { content: 'bounded-baseline' } }] }));
    const atCap = new Uint8Array(MAX_OPENAI_RESPONSE_BYTES).fill(0x20);
    atCap.set(encoded);
    for (const overflow of [false, true]) {
      let pulled = 0; let cancelled = false;
      const chunks = overflow ? [atCap, new Uint8Array([0x20]), new Uint8Array(4096).fill(0x20)] : [atCap];
      const mock = transport(() => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[pulled++];
          if (chunk) controller.enqueue(chunk); else controller.close();
        }, cancel() { cancelled = true; },
      }, { highWaterMark: 0 }), { headers: { 'Content-Length': '1' } }));
      const response = await endpoint.fetch(request(), env as never);
      expect(response.status).toBe(overflow ? 502 : 200);
      expect(await response.json()).toEqual(overflow ? { error: 'OpenAI request failed.' } : { content: 'bounded-baseline' });
      expect(pulled).toBe(2);
      expect(cancelled).toBe(overflow);
      expect(mock).toHaveBeenCalledTimes(2);
    }
  });

  it.each(['/chat/completions', '/planning-attachment', '/planning-transcription'])('%s emits only safe error type/code when a provider rejects', async path => {
    const error = Object.assign(new TypeError('private-input-sentinel private-key-sentinel'), { code: 'ECONNRESET' });
    const mock = transport(async () => { throw error; });
    const response = await worker.fetch(request(path), env as never);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unexpected worker error.' });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unexpected'), { name: 'TypeError', code: 'ECONNRESET' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private-input-sentinel|private-key-sentinel/);
  });

  it('observation failure retains no error message, stack, custom name or arbitrary code', async () => {
    vi.spyOn(ProductObservabilityStore.prototype, 'storeAiRequestMetric').mockRejectedValue(
      Object.assign(new Error('private-input-sentinel private-key-sentinel'), { name: 'private-key-sentinel', code: 'private-input-sentinel' }),
    );
    transport(() => Response.json({ model: AI_CHAT_PURPOSE_MODELS.weekly_planning_semantic_normalizer,
      choices: [{ message: { content: 'baseline-content' } }] }));
    const pending: Promise<unknown>[] = [];
    const response = await traceWorker.fetch(request(), { ...env, FIREBASE_PROJECT_ID: 'fixture-project',
      FIREBASE_SERVICE_ACCOUNT_EMAIL: 'fixture@example.com', FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-fixture',
      OBSERVABILITY_IDENTITY_SECRET: 'x'.repeat(32),
    } as never, { waitUntil: work => pending.push(work) } as ExecutionContext);
    expect(await response.json()).toEqual({ content: 'baseline-content' });
    await Promise.all(pending);
    expect(console.warn).toHaveBeenCalledWith('[AI Proxy] observability metric write failed', { name: 'unknown', code: null });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private-input-sentinel|private-key-sentinel/);
  });
});
