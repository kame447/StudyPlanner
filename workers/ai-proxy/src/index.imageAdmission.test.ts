import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

// Exercise the index entry itself: deployed OCR and the compatibility attachment handler.
const origin = 'https://app.example';
const image = { mimeType: 'image/png', base64: 'aGVsbG8=' };
const bodyLimit = 5 * 1024 * 1024;

describe.each([
  { path: '/timetable-ocr', kind: 'ocr', invalid: 'Invalid timetable OCR payload.',
    modelError: 'Timetable OCR model is not configured.', result: { periods: [], items: [] } },
  { path: '/planning-attachment', kind: 'attachment', invalid: 'Invalid planning attachment payload.',
    modelError: 'Planning attachment model is not configured.', result: { text: '数学の課題' } },
])('index image admission $path', ({ path, kind, invalid, modelError, result }) => {
  let env: Parameters<typeof worker.fetch>[1];
  let events: string[];
  let fetcher: ReturnType<typeof vi.fn>;
  let quota: ReturnType<typeof vi.fn>;

  function request(body = JSON.stringify(image), headers: Record<string, string> = {}) {
    return new Request(`https://worker.example${path}`, { method: 'POST', body,
      headers: { Origin: origin, Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...headers } });
  }

  beforeEach(() => {
    events = [];
    quota = vi.fn(async () => {
      events.push('quota');
      return { allowed: true, retryAfterSeconds: 0 };
    });
    env = {
      OPENAI_API_KEY: 'unused-test-key', GEMINI_API_KEY: 'test-key', FIREBASE_WEB_API_KEY: 'test-key',
      ALLOWED_ORIGIN: origin, GEMINI_MODEL: 'gemini-test', ALLOWED_GEMINI_MODELS: 'gemini-test',
      AI_QUOTA: { getByName: () => ({ checkAndConsume: quota }) } as unknown as Parameters<typeof worker.fetch>[1]['AI_QUOTA'],
    };
    fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
        events.push('auth');
        return Response.json({ users: [{ localId: 'owner', emailVerified: true }] });
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        events.push('provider');
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
      }
      throw new Error(`Unexpected external request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each([
    ['bad JSON', '{', 'Invalid JSON payload.'],
    ['null', 'null', null], ['number', '42', null], ['string', '"image"', null],
    ['array', '[]', 'Only PNG and JPEG images are supported.'],
    ['missing MIME', JSON.stringify({ base64: image.base64 }), 'Only PNG and JPEG images are supported.'],
    ['unsupported MIME', JSON.stringify({ ...image, mimeType: 'image/webp' }), 'Only PNG and JPEG images are supported.'],
    ['missing data', JSON.stringify({ mimeType: image.mimeType }), 'Image data is required.'],
    ['blank data', JSON.stringify({ ...image, base64: ' \n\t' }), 'Image data is required.'],
    ['non-base64 data', JSON.stringify({ ...image, base64: 'a b!' }), 'Image data was not valid base64.'],
    ['oversized data', JSON.stringify({ ...image, base64: 'A'.repeat(4_500_001) }), 'Image data was too large.'],
  ])('rejects %s before quota or provider calls', async (_label, body, error) => {
    const response = await worker.fetch(request(body!), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: error ?? invalid });
    expect(events).toEqual(['auth']);
    expect(quota).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized body without reading it', async () => {
    const input = request('{', { 'Content-Length': String(bodyLimit + 1) });
    const response = await worker.fetch(input, env);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Image request body was too large.' });
    expect(input.bodyUsed).toBe(false);
    expect(events).toEqual(['auth']);
  });

  it('enforces actual UTF-8 bytes rather than character count or declared size', async () => {
    const body = JSON.stringify({ ...image, ignored: 'あ'.repeat(Math.ceil(bodyLimit / 3)) });
    expect(body.length).toBeLessThan(bodyLimit);
    const response = await worker.fetch(request(body, { 'Content-Length': '1' }), env);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Image request body was too large.' });
    expect(events).toEqual(['auth']);
  });

  it('requires authentication before parsing malformed JSON', async () => {
    const input = request('{', { Authorization: '' });
    const response = await worker.fetch(input, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Missing Firebase ID token.' });
    expect(input.bodyUsed).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
  });

  it('does not parse a body after Firebase rejects its token', async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const input = request('{');
    const response = await worker.fetch(input, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Firebase ID token verification failed.' });
    expect(input.bodyUsed).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(quota).not.toHaveBeenCalled();
  });

  it('keeps CORS and configured-key gates before authentication', async () => {
    const input = request('{', { Origin: 'https://other.example' });
    const corsResponse = await worker.fetch(input, { ...env, GEMINI_API_KEY: '' });
    expect(corsResponse.status).toBe(403);
    expect(await corsResponse.json()).toEqual({ error: 'Origin is not allowed.' });
    const keyResponse = await worker.fetch(request('{'), { ...env, GEMINI_API_KEY: '' });
    expect(keyResponse.status).toBe(500);
    expect(await keyResponse.json()).toEqual({ error: 'GEMINI_API_KEY is not configured.' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
  });

  it('checks the model after input admission and before quota consumption', async () => {
    env.GEMINI_MODEL = 'not-allowed';
    const badInput = await worker.fetch(request('{'), env);
    expect(badInput.status).toBe(400);
    expect(await badInput.json()).toEqual({ error: 'Invalid JSON payload.' });
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: modelError });
    expect(events).toEqual(['auth', 'auth']);
    expect(quota).not.toHaveBeenCalled();
  });

  it.each([1, 2])('does not call the provider when quota check %i rejects', async deniedCheck => {
    if (deniedCheck === 2) quota.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 });
    quota.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 7 });
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'AI rate limit exceeded.', retryAfterSeconds: 7 });
    expect(response.headers.get('Retry-After')).toBe('7');
    expect(quota).toHaveBeenCalledTimes(deniedCheck);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['image/png', 'image/jpeg'])('forwards admitted %s after authentication and both quota gates', async mimeType => {
    const response = await worker.fetch(request(JSON.stringify({ ...image, mimeType, ignored: { note: 'not provider input' } })), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result });
    expect(events).toEqual(['auth', 'quota', 'quota', 'provider']);
    expect(quota.mock.calls[1][0].rules.map((rule: { name: string }) => rule.name))
      .toEqual([`${kind}:uid:minute`, `${kind}:uid:day`]);
    const providerBody = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(providerBody.contents[0].parts[1]).toEqual({ inline_data: { mime_type: mimeType, data: image.base64 } });
  });
});
