import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './worker';
import { describeAiProxyOperation } from './aiProxyRequestObserver';
const result = { items: [{ title: '第1章', level: 1, startPage: 2, endPage: null }] };
function setup(content = JSON.stringify(result), quotaAllowed = true) {
  const upstream: Record<string, unknown>[] = [];
  const quota = vi.fn(async () => ({ allowed: quotaAllowed, retryAfterSeconds: 60 }));
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    if (String(input).includes('identitytoolkit')) return Response.json({ users: [{ localId: 'user-1', emailVerified: true }] });
    upstream.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content } }], usage: { total_tokens: 50 } });
  }));
  const env = { OPENAI_API_KEY: 'test', FIREBASE_WEB_API_KEY: 'test', ALLOWED_ORIGIN: 'https://app.example', AI_QUOTA: { getByName: () => ({ checkAndConsume: quota }) } };
  const send = (patch = {}, authenticated = true) => worker.fetch(new Request('https://proxy.example/planning-attachment', {
    method: 'POST', headers: { Origin: 'https://app.example', 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer token' } : {}) },
    body: JSON.stringify({ mimeType: 'image/png', base64: 'aGVsbG8=', purpose: 'material_contents_photo', ...patch }),
  }), env as never);
  return { send, upstream, quota };
}
afterEach(() => vi.unstubAllGlobals());
describe('material contents photo worker', () => {
  it('reuses authenticated Luna image quota and emits validated draft data', async () => {
    const { send, upstream, quota } = setup(); const response = await send();
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ result });
    expect(upstream[0]).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 8000 });
    expect(JSON.stringify(upstream[0])).toContain('教材の目次写真'); expect(quota).toHaveBeenCalled();
    expect(describeAiProxyOperation('/planning-attachment', { purpose: 'material_contents_photo' }, {})).toMatchObject({ purpose: 'material_contents_photo' });
  });
  it.each(['not json', '{"items":[]}', '{"items":[{"title":"bad","level":2,"startPage":1,"endPage":null}]}', '{"text":"old contract"}'])('rejects invalid model output: %s', async content => {
    const { send } = setup(content); expect((await send()).status).toBe(502);
  });
  it('requires authentication before provider access', async () => {
    const { send, upstream } = setup(); expect((await send({}, false)).status).toBe(401); expect(upstream).toHaveLength(0);
  });
  it('rejects unsupported purpose before quota', async () => {
    const { send, upstream, quota } = setup(); expect((await send({ purpose: 'unknown' })).status).toBe(400); expect(upstream).toHaveLength(0); expect(quota).not.toHaveBeenCalled();
  });
  it('honors attachment quota', async () => {
    const { send, upstream } = setup(undefined, false); expect((await send()).status).toBe(429); expect(upstream).toHaveLength(0);
  });
});
