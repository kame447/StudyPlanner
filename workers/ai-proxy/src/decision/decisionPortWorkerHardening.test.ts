import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import legacyWorker from '../index';
import { AI_CHAT_PURPOSE_MODELS } from '../modelPolicy';
import { handleProductObservabilityApi } from '../productObservabilityApi';
import { handleWeeklyPlanningTraceAdminEntriesPage } from '../weeklyPlanningTraceAdminEntriesPage';
import { observeAiProxyRequest } from '../aiProxyRequestObserver';

const redirects = [301, 302, 303, 307, 308];
const contexts = [
  { purpose: 'focused_authorization', requestId: 'fixture-auth', inputRevision: 7,
    previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
    state: { currentUserText: 'private-input', lastAssistantMessage: null } },
  { purpose: 'focused_contextual_answer', requestId: 'fixture-contextual', inputRevision: 7,
    questionCode: 'quantity_role_unresolved', state: { currentUserText: 'private-input',
      pendingQuestion: { targetQuantityRole: 'declared', questionBasis: null, hasEstimateTarget: false } } },
  { purpose: 'temporal_scope_repair', requestId: 'fixture-temporal', inputRevision: 7,
    state: { sourceText: 'private-input', currentAttachedTask: { title: 'private-title' },
      interpretedTime: { dateExpression: 'weekday:tuesday', namedTimePeriod: null, startTime: '18:00', endTime: '20:00' } } },
  { purpose: 'user_context_routing', requestId: 'fixture-routing', inputRevision: 0,
    state: { currentUserText: 'private-input' } },
];
const env = {
  OPENAI_API_KEY: 'fixture-openai-secret', OPENROUTER_API_KEY: 'fixture-jev-secret',
  GEMINI_API_KEY: 'fixture-gemini-secret', FIREBASE_WEB_API_KEY: 'fixture-web-key',
  ALLOWED_ORIGIN: 'https://app.fixture',
  FIREBASE_PROJECT_ID: 'fixture-project', FIREBASE_SERVICE_ACCOUNT_EMAIL: 'fixture@example.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-fixture-key', OBSERVABILITY_IDENTITY_SECRET: 'x'.repeat(32),
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) },
};
function request(path = '/chat/completions', payload: unknown = {
  purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: 'private-luna-input' }],
}) {
  return new Request(`https://proxy.fixture${path}`, { method: 'POST',
    headers: { Authorization: 'Bearer fixture-session-secret', Origin: 'https://app.fixture', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload) });
}
function installTransport(options: { redirectStatus?: number; authRedirect?: boolean; servedModel?: unknown; omitModel?: boolean } = {}) {
  const destination = 'https://untrusted.fixture/credential-sink';
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === destination) return Response.json({ users: [{ localId: 'fixture-owner', emailVerified: true }] });
    const authentication = url.includes('identitytoolkit.googleapis.com');
    if (authentication && !options.authRedirect) return Response.json({ users: [{ localId: 'fixture-owner', emailVerified: true }] });
    if (url.includes('openrouter.ai')) return Response.json({ model: 'unverified-jev', answers: {} });
    if (options.redirectStatus !== undefined) {
      // Mock the documented fetch redirect policy: automatic following would
      // issue another transport send. Manual mode exposes the original 3xx.
      if (init?.redirect !== 'manual') await transport(destination, init);
      return new Response(null, { status: options.redirectStatus, headers: { Location: destination } });
    }
    if (url.includes('api.openai.com')) {
      const body = JSON.parse(String(init?.body));
      return Response.json({ ...(options.omitModel ? {} : { model: options.servedModel ?? body.model }),
        choices: [{ message: { content: 'luna-baseline' } }] });
    }
    throw new Error('Unstubbed endpoint: no real network is permitted.');
  });
  vi.stubGlobal('fetch', transport);
  return transport;
}
const cells = contexts.flatMap(context => (['off', 'shadow', 'canary'] as const)
  .flatMap(mode => redirects.map(status => ({ context, mode, status }))));
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('credential-bearing Worker fetch redirects and Luna model identity', () => {
  it.each(contexts)('$purpose fixes privacy preferences despite browser override and falls back once on route rejection', async context => {
    for (const status of [403, 422]) {
      const decisionBodies: Array<Record<string, unknown>> = [];
      const lunaBodies: Array<Record<string, unknown>> = [];
      const transport = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url.includes('identitytoolkit')) return Response.json({ users: [{ localId: 'fixture-owner', emailVerified: true }] });
        const body = JSON.parse(String(init?.body));
        if (url.includes('openrouter.ai')) {
          decisionBodies.push(body);
          return Response.json({ error: 'private-upstream-sentinel' }, { status });
        }
        if (url.includes('api.openai.com')) {
          lunaBodies.push(body);
          return Response.json({ model: body.model, choices: [{ message: { content: 'luna-after-private-route-rejection' } }] });
        }
        throw new Error('Unstubbed endpoint: no real provider call is allowed.');
      });
      vi.stubGlobal('fetch', transport);
      const response = await worker.fetch(request('/chat/completions', {
        purpose: context.purpose === 'user_context_routing' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer',
        messages: [{ role: 'user', content: 'private-luna-input' }], decisionContext: context,
        provider: { zdr: false, data_collection: 'allow', order: ['browser-chosen-provider'] },
      }), { ...env, JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100',
        JEV_FOCUSED_AUTHORIZATION_MODE: 'canary', JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100',
        JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: 'canary', JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100',
        JEV_TEMPORAL_SCOPE_REPAIR_MODE: 'canary', JEV_TEMPORAL_SCOPE_REPAIR_CANARY_PERCENT: '100',
        JEV_USER_CONTEXT_ROUTING_MODE: 'canary', JEV_USER_CONTEXT_ROUTING_CANARY_PERCENT: '100',
      } as never);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ content: 'luna-after-private-route-rejection' });
      expect(decisionBodies).toHaveLength(1);
      expect(decisionBodies[0].provider).toEqual({ zdr: true, data_collection: 'deny' });
      expect(lunaBodies).toHaveLength(1);
      expect(lunaBodies[0]).not.toHaveProperty('provider');
      expect(lunaBodies[0]).not.toHaveProperty('decisionContext');
      expect(transport.mock.calls.filter(([input]) => String(input).includes('openrouter.ai'))).toHaveLength(1);
      expect(transport.mock.calls.filter(([input]) => String(input).includes('api.openai.com'))).toHaveLength(1);
      expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('private-upstream-sentinel');
    }
  });

  it.each(cells)('$context.purpose/$mode rejects redirect $status with one Luna send and no credential forwarding', async ({ context, mode, status }) => {
    const transport = installTransport({ redirectStatus: status });
    const pending: Promise<unknown>[] = [];
    const configured = { ...env, JEV_MODE: mode, JEV_CANARY_PERCENT: '100',
      JEV_FOCUSED_AUTHORIZATION_MODE: mode, JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100',
      JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: mode, JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100',
      JEV_TEMPORAL_SCOPE_REPAIR_MODE: mode, JEV_TEMPORAL_SCOPE_REPAIR_CANARY_PERCENT: '100',
      JEV_USER_CONTEXT_ROUTING_MODE: mode, JEV_USER_CONTEXT_ROUTING_CANARY_PERCENT: '100' };
    const response = await worker.fetch(request('/chat/completions', {
      purpose: context.purpose === 'user_context_routing' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer',
      messages: [{ role: 'user', content: 'private-luna-input' }], decisionContext: context,
    }), configured as never, undefined, { waitUntil: promise => pending.push(promise) } as ExecutionContext);
    await Promise.all(pending);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'OpenAI request failed.' });
    const luna = transport.mock.calls.filter(([input]) => String(input).includes('api.openai.com'));
    expect(luna).toHaveLength(1);
    expect(luna[0][1]?.redirect).toBe('manual');
    expect(transport.mock.calls.some(([input]) => String(input).includes('untrusted.fixture'))).toBe(false);
    expect(JSON.parse(String(luna[0][1]?.body))).not.toHaveProperty('decisionContext');
    expect(transport.mock.calls.filter(([input]) => String(input).includes('openrouter.ai'))).toHaveLength(mode === 'off' ? 0 : 1);
  });

  it.each([worker, legacyWorker])('rejects missing, wrong or unverified response models and preserves the configured model positive', async endpoint => {
    for (const model of [undefined, 'different-model', `${AI_CHAT_PURPOSE_MODELS.weekly_planning_semantic_normalizer}-unverified-snapshot`]) {
      const transport = installTransport({ servedModel: model, omitModel: model === undefined });
      const response = await endpoint.fetch(request(), env as never);
      expect(response.status).toBe(502);
      expect(transport.mock.calls.filter(([input]) => String(input).includes('api.openai.com'))).toHaveLength(1);
    }
    installTransport();
    expect(await (await endpoint.fetch(request(), env as never)).json()).toMatchObject({ content: 'luna-baseline' });
  });

  it.each(contexts)('$purpose rejects a wrong Luna model after a Jev failure', async context => {
    const transport = installTransport({ servedModel: 'unverified-model' });
    const response = await worker.fetch(request('/chat/completions', {
      purpose: context.purpose === 'user_context_routing' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer',
      messages: [{ role: 'user', content: 'private-luna-input' }], decisionContext: context,
    }), { ...env, JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100',
      JEV_FOCUSED_AUTHORIZATION_MODE: 'canary', JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100',
      JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: 'canary', JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100',
      JEV_TEMPORAL_SCOPE_REPAIR_MODE: 'canary', JEV_TEMPORAL_SCOPE_REPAIR_CANARY_PERCENT: '100',
      JEV_USER_CONTEXT_ROUTING_MODE: 'canary', JEV_USER_CONTEXT_ROUTING_CANARY_PERCENT: '100',
    } as never);
    expect(response.status).toBe(502);
    expect(transport.mock.calls.filter(([input]) => String(input).includes('openrouter.ai'))).toHaveLength(1);
    expect(transport.mock.calls.filter(([input]) => String(input).includes('api.openai.com'))).toHaveLength(1);
  });

  it.each(redirects)('legacy chat, image, audio and Gemini reject redirect %i without forwarding body or key', async status => {
    for (const [endpoint, path] of [
      [legacyWorker, '/chat/completions'], [worker, '/planning-attachment'],
      [worker, '/planning-transcription'], [worker, '/timetable-ocr'],
    ] as const) {
      const transport = installTransport({ redirectStatus: status });
      const response = await endpoint.fetch(request(path, path === '/chat/completions'
        ? { purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: 'private-luna-input' }] }
        : { mimeType: path === '/planning-transcription' ? 'audio/webm' : 'image/png', base64: 'aGVsbG8=' }), env as never);
      // Gemini's existing error envelope retains the upstream status. It still
      // rejects the result and exposes no Location/body from that response.
      expect(response.status).toBe(path === '/timetable-ocr' ? status : 502);
      if (path === '/timetable-ocr') {
        expect(await response.json()).toEqual({ error: 'Gemini timetable OCR request failed.' });
        expect(response.headers.get('Location')).toBeNull();
      }
      const sensitive = transport.mock.calls.filter(([input]) => /api.openai.com|generativelanguage.googleapis.com/.test(String(input)));
      expect(sensitive).toHaveLength(1);
      expect(sensitive[0][1]?.redirect).toBe('manual');
      expect(transport.mock.calls.some(([input]) => String(input).includes('untrusted.fixture'))).toBe(false);
    }
  });

  it.each(redirects)('all five account lookups reject redirect %i using their existing authentication failure', async status => {
    for (const invoke of [
      () => worker.fetch(request(), env as never),
      () => legacyWorker.fetch(request(), env as never),
      () => handleProductObservabilityApi(request('/observability/events'), env as never),
      () => handleWeeklyPlanningTraceAdminEntriesPage(request('/admin/trace/entries'), env),
    ]) {
      const transport = installTransport({ redirectStatus: status, authRedirect: true });
      expect((await invoke()).status).toBe(401);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0][1]?.redirect).toBe('manual');
    }
    const transport = installTransport({ redirectStatus: status, authRedirect: true });
    await observeAiProxyRequest({ request: request(), response: new Response(null, { status: 500 }),
      env: env as never, startedAtMs: 0, occurredAt: new Date().toISOString() });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.redirect).toBe('manual');
  });
});
