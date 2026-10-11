import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUtf8ByteLength } from '../../../shared/aiProxyContract';
import * as aiProxyContract from '../../../shared/aiProxyContract';
import { ProductObservabilityStore } from './productObservabilityStore';
import * as aiProxyObserver from './aiProxyRequestObserver';
import traceWorker from './traceWorker';
import { JEV_MODEL } from './decision/decisionPolicy';

const routes = [
  { path: '/', operationKind: 'chat_completion' },
  { path: '/chat/completions', operationKind: 'chat_completion' },
  { path: '/planning-attachment', operationKind: 'planning_attachment' },
  { path: '/planning-transcription', operationKind: 'planning_transcription' },
] as const;
type Outcome = 'success' | 'quota_rejected' | 'provider_error';

function setup(outcome: Outcome = 'success', usage?: unknown) {
  const store = vi.spyOn(ProductObservabilityStore.prototype, 'storeAiRequestMetric')
    .mockResolvedValue(undefined);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('accounts:lookup')) {
      const { idToken } = JSON.parse(String(init?.body)) as { idToken: string };
      return Response.json({ users: [{ localId: `uid-${idToken}`, emailVerified: true }] });
    }
    if (url.endsWith('/chat/completions')) {
      if (outcome === 'provider_error') return new Response('upstream failure', { status: 503 });
      return Response.json({
        choices: [{ message: { content: '{"text":"教材 1章"}' } }],
        ...(usage === undefined ? {} : { usage }),
      });
    }
    if (url.endsWith('/audio/transcriptions')) {
      if (outcome === 'provider_error') return new Response('upstream failure', { status: 503 });
      return Response.json({ text: '教材 1章' });
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"periods":[],"items":[]}' }] } }] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const env = {
    OPENAI_API_KEY: 'openai-key',
    GEMINI_API_KEY: 'gemini-key',
    FIREBASE_WEB_API_KEY: 'firebase-key',
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused-by-store-boundary',
    OBSERVABILITY_IDENTITY_SECRET: '0123456789abcdef0123456789abcdef',
    ALLOWED_ORIGIN: 'https://app.example',
    ALLOWED_CHAT_MODELS: 'gpt-5.6-luna',
    AI_QUOTA: {
      getByName: () => ({
        checkAndConsume: async () => ({
          allowed: outcome !== 'quota_rejected', retryAfterSeconds: 60,
        }),
      }),
    },
  };
  return { env, store, fetchMock };
}

function makeRequest(path: string, token = 'user-a') {
  const body = JSON.stringify(path === '/' || path === '/chat/completions'
    ? {
        purpose: 'weekly_planning_renderer',
        messages: [{ role: 'user', content: '今日の予定' }],
      }
    : { mimeType: path === '/planning-transcription' ? 'audio/webm' : 'image/png', base64: 'aGVsbG8=' });
  const request = new Request(`https://proxy.example${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://app.example',
      'Content-Type': 'application/json',
      'X-StudyPlanner-AI-Request-Id': `request-${token}`,
      'X-StudyPlanner-App-Version': 'test-version',
    },
    body,
  });
  return { request, body };
}

async function invoke(request: Request, env: ReturnType<typeof setup>['env']) {
  const tasks: Promise<unknown>[] = [];
  const response = await traceWorker.fetch(request, env, {
    waitUntil: (task: Promise<unknown>) => tasks.push(task),
  } as unknown as ExecutionContext);
  return { response, tasks };
}

function lookupCalls(fetchMock: ReturnType<typeof setup>['fetchMock']) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes('accounts:lookup'));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('traceWorker AI observation authentication', () => {
  describe.each(routes)('$path', ({ path, operationKind }) => {
    it('records a failure after authentication and body consumption with one lookup', async () => {
      const { env, store, fetchMock } = setup();
      const { request, body } = makeRequest(path);
      const readBody = vi.spyOn(request, 'text');
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(aiProxyContract, 'getUtf8ByteLength').mockImplementationOnce(() => {
        throw new Error('injected failure before request metadata is parsed');
      });

      const { response, tasks } = await invoke(request, env);
      expect(response.status).toBe(500);
      await Promise.all(tasks);
      expect(lookupCalls(fetchMock)).toHaveLength(1);
      expect(readBody).toHaveBeenCalledTimes(1);
      expect(store).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        firebaseUid: 'uid-user-a',
        payload: expect.objectContaining({
          operationKind,
          status: 'unknown_failure',
          requestBytes: getUtf8ByteLength(body),
          promptTokens: null,
          estimatedCostMicros: null,
        }),
      }));
    });

    it('records a failure after authentication but before body consumption with one lookup', async () => {
      const { env, store, fetchMock } = setup();
      const { request } = makeRequest(path);
      const getHeader = request.headers.get.bind(request.headers);
      vi.spyOn(request.headers, 'get').mockImplementation((name) => {
        if (name === 'Content-Length') throw new Error('injected pre-body handler failure');
        return getHeader(name);
      });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const { response, tasks } = await invoke(request, env);
      expect(response.status).toBe(500);
      await Promise.all(tasks);
      expect(lookupCalls(fetchMock)).toHaveLength(1);
      expect(store).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        firebaseUid: 'uid-user-a',
        payload: expect.objectContaining({ operationKind, status: 'unknown_failure' }),
      }));
    });

    it.each<Outcome>(['success', 'quota_rejected', 'provider_error'])(
      'performs exactly one lookup and records the %s outcome',
      async (outcome) => {
        const { env, store, fetchMock } = setup(outcome);
        const { request, body } = makeRequest(path);
        const readBody = vi.spyOn(request, 'text');
        const cloneBody = vi.spyOn(request, 'clone');
        const { response, tasks } = await invoke(request, env);
        const responseText = await response.text();
        await Promise.all(tasks);

        expect(response.status).toBe({ success: 200, quota_rejected: 429, provider_error: 502 }[outcome]);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
        expect(lookupCalls(fetchMock)).toHaveLength(1);
        expect(readBody).toHaveBeenCalledTimes(1);
        expect(cloneBody).not.toHaveBeenCalled();
        expect(tasks).toHaveLength(1);
        expect(store).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          firebaseUid: 'uid-user-a',
          requestId: 'request-user-a',
          appVersion: 'test-version',
          payload: expect.objectContaining({
            operationKind,
            status: outcome,
            requestBytes: getUtf8ByteLength(body),
            responseBytes: getUtf8ByteLength(responseText),
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            cachedTokens: null,
            cacheWriteTokens: null,
            estimatedCostMicros: null,
          }),
        }));
      },
    );
  });

  it('preserves measured provider usage', async () => {
    const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
    const { env, store, fetchMock } = setup('success', usage);
    const { response, tasks } = await invoke(makeRequest('/chat/completions').request, env);
    expect(await response.json()).toMatchObject({ usage });
    await Promise.all(tasks);
    expect(lookupCalls(fetchMock)).toHaveLength(1);
    expect(store.mock.calls[0][0].payload).toMatchObject({
      promptTokens: 120, completionTokens: 30, totalTokens: 150, cachedTokens: null,
    });
  });

  it('keeps concurrent callers isolated within their own invocation', async () => {
    const { env, store, fetchMock } = setup();
    const results = await Promise.all(['user-a', 'user-b'].map((token) =>
      invoke(makeRequest('/chat/completions', token).request, env)));
    await Promise.all(results.flatMap(({ tasks }) => tasks));
    expect(lookupCalls(fetchMock)).toHaveLength(2);
    expect(store.mock.calls.map(([metric]) => [metric.requestId, metric.firebaseUid]).sort()).toEqual([
      ['request-user-a', 'uid-user-a'], ['request-user-b', 'uid-user-b'],
    ]);
  });

  it('preserves the explicit legacy OCR lookup fallback', async () => {
    const { env, store, fetchMock } = setup();
    const { response, tasks } = await invoke(makeRequest('/timetable-ocr').request, env);
    expect(response.status).toBe(200);
    await Promise.all(tasks);
    expect(lookupCalls(fetchMock)).toHaveLength(2);
    expect(store).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      firebaseUid: 'uid-user-a',
      payload: expect.objectContaining({ operationKind: 'timetable_ocr', status: 'success' }),
    }));
  });

  it('does not retry authentication after it fails in the handler', async () => {
    const { env, store, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { response, tasks } = await invoke(makeRequest('/chat/completions').request, env);
    expect(response.status).toBe(401);
    await Promise.all(tasks);
    expect(lookupCalls(fetchMock)).toHaveLength(1);
    expect(store).not.toHaveBeenCalled();
  });

  it('preserves unknown-failure observation when the handler fails before authentication', async () => {
    const { env, store, fetchMock } = setup();
    const { response, tasks } = await invoke(makeRequest('/chat/completions').request, {
      ...env, OPENAI_API_KEY: '',
    });
    expect(response.status).toBe(500);
    await Promise.all(tasks);
    expect(lookupCalls(fetchMock)).toHaveLength(1);
    expect(store).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      firebaseUid: 'uid-user-a',
      payload: expect.objectContaining({ status: 'unknown_failure' }),
    }));
  });

  it('leaves the user response successful when metric storage fails', async () => {
    const { env, store, fetchMock } = setup();
    store.mockRejectedValueOnce(new Error('storage unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { response, tasks } = await invoke(makeRequest('/chat/completions').request, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content: '{"text":"教材 1章"}' });
    await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
    expect(lookupCalls(fetchMock)).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith('[AI Proxy] observability metric write failed', {
      message: 'storage unavailable',
    });
  });

  it('returns the response before observation finishes and contains observer failures', async () => {
    const { env, fetchMock } = setup();
    let rejectObservation!: (error: Error) => void;
    const pendingObservation = new Promise<void>((_resolve, reject) => {
      rejectObservation = reject;
    });
    vi.spyOn(aiProxyObserver, 'observeAiProxyRequest').mockReturnValueOnce(pendingObservation);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { response, tasks } = await invoke(makeRequest('/chat/completions').request, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ content: '{"text":"教材 1章"}' });
    rejectObservation(new Error('observation failed'));
    await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
    expect(lookupCalls(fetchMock)).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith('[AI Proxy] observability metric write failed', {
      message: 'observation failed',
    });
  });

  it('does not schedule observation when observability is unconfigured', async () => {
    const { env, store, fetchMock } = setup();
    const { response, tasks } = await invoke(makeRequest('/chat/completions').request, {
      ...env, OBSERVABILITY_IDENTITY_SECRET: '',
    });
    expect(response.status).toBe(200);
    expect(tasks).toHaveLength(0);
    expect(lookupCalls(fetchMock)).toHaveLength(1);
    expect(store).not.toHaveBeenCalled();
  });
});

describe('traceWorker completion metadata stays inside existing observation', () => {
  it.each([
    {
      label: 'dense nonempty length', purpose: 'weekly_planning_semantic_normalizer',
      requested: 6400, effective: 4096, finishReason: 'length', refusal: null,
      content: '{"private-response-sentinel":', status: 200, metricStatus: 'success',
      completionTokens: 4096, reasoningTokens: 4000, textTokens: 96,
    },
    {
      label: 'renderer default with unknown refusal presence', purpose: 'weekly_planning_renderer',
      requested: undefined, effective: 800, finishReason: 'stop', refusal: undefined,
      content: '{"reply":"private-response-sentinel"}', status: 200, metricStatus: 'success',
      completionTokens: 30, reasoningTokens: 12, textTokens: 18,
    },
    {
      label: 'empty refusal', purpose: 'weekly_planning_renderer',
      requested: 3200, effective: 3200, finishReason: 'stop', refusal: 'private-refusal-sentinel',
      content: null, status: 502, metricStatus: 'empty_response',
      completionTokens: 12, reasoningTokens: 12, textTokens: 0,
    },
  ])('observes $label without changing the public response or dispatch', async (row) => {
    const { env, store, fetchMock } = setup();
    const upstream: Array<Record<string, unknown>> = [];
    const unexpected: string[] = [];
    const usage = { prompt_tokens: 120, completion_tokens: row.completionTokens, total_tokens: 120 + row.completionTokens,
      completion_tokens_details: { reasoning_tokens: row.reasoningTokens, text_tokens: row.textTokens } };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('accounts:lookup')) {
        return Response.json({ users: [{ localId: 'uid-user-a', emailVerified: true }] });
      }
      if (url.endsWith('/chat/completions')) {
        upstream.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ choices: [{ finish_reason: row.finishReason,
          message: { content: row.content, ...(row.refusal === undefined ? {} : { refusal: row.refusal }) } }], usage });
      }
      unexpected.push(url);
      return new Response(null, { status: 503 });
    });
    const request = new Request('https://proxy.example/chat/completions', {
      method: 'POST', headers: {
        Authorization: 'Bearer user-a', Origin: 'https://app.example', 'Content-Type': 'application/json',
        'X-StudyPlanner-AI-Request-Id': 'request-completion-baseline',
      },
      body: JSON.stringify({ purpose: row.purpose,
        messages: [{ role: 'user', content: 'private-input-sentinel' }],
        ...(row.requested === undefined ? {} : { max_completion_tokens: row.requested }),
        // Client metadata is not a source of provider facts.
        providerCompletion: { finishReason: 'client-private-sentinel', effectiveMaxCompletionTokens: 1 },
      }),
    });
    const { response, tasks } = await invoke(request, env);
    expect(response.status).toBe(row.status);
    expect(await response.json()).toEqual(row.content === null
      ? { error: 'OpenAI response content was empty.' }
      : { content: row.content, usage });
    await Promise.all(tasks);
    expect(unexpected).toEqual([]);
    expect(upstream).toHaveLength(1);
    expect(upstream[0].max_completion_tokens).toBe(row.effective);
    expect(upstream[0]).not.toHaveProperty('providerCompletion');
    expect(lookupCalls(fetchMock)).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(store).toHaveBeenCalledTimes(1);
    const metric = store.mock.calls[0][0];
    expect(metric).toMatchObject({ firebaseUid: 'uid-user-a', requestId: 'request-completion-baseline',
      payload: { purpose: row.purpose, status: row.metricStatus } });
    expect(JSON.stringify(metric.payload)).not.toMatch(/private-input-sentinel|private-response-sentinel|private-refusal-sentinel|client-private-sentinel/);
    expect(metric.payload).toHaveProperty('providerCompletion', {
      finishReason: row.finishReason,
      refusalPresent: row.refusal === undefined ? null : row.refusal !== null,
      requestedMaxCompletionTokens: row.requested ?? null,
      effectiveMaxCompletionTokens: row.effective,
      reasoningTokens: row.reasoningTokens, textTokens: row.textTokens,
    });
  });
});

describe('traceWorker completion evidence belongs to the actual Luna attempt', () => {
  it.each([
    { label: 'accepted canary', mode: 'canary', acceptJev: true, delayed: false, lunaCalls: 0 },
    { label: 'rejected canary fallback', mode: 'canary', acceptJev: false, delayed: false, lunaCalls: 1 },
    { label: 'delayed shadow', mode: 'shadow', acceptJev: true, delayed: true, lunaCalls: 1 },
  ] as const)('separates $label decision and completion metadata', async (row) => {
    const { env, store, fetchMock } = setup();
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const decisionContext = {
      purpose: 'focused_authorization', requestId: 'completion-decision-context', inputRevision: 7,
      previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
      state: { currentUserText: 'private-input-sentinel', lastAssistantMessage: 'private-context-sentinel' },
    } as const;
    const jevResponse = {
      model: JEV_MODEL.responses[1],
      answers: {
        authorization: { type: 'choice', choice: 'create_plan', confidence: row.acceptJev ? 0.999 : 0.5,
          probabilities: { create_plan: 1, fallback: 0 } },
        condition_change: { type: 'noul', noul: 0.001 },
        independent_meaning: { type: 'noul', noul: 0.001 },
      },
      usage: { input_tokens: 200, output_tokens: 30, cost: 0.0000084 },
    };
    const lunaUsage = { prompt_tokens: 40, completion_tokens: 11, total_tokens: 51,
      completion_tokens_details: { reasoning_tokens: 7, text_tokens: 4 } };
    const expectedCompletion = {
      finishReason: 'length', refusalPresent: true,
      requestedMaxCompletionTokens: 6400, effectiveMaxCompletionTokens: 4096,
      reasoningTokens: 7, textTokens: 4,
    };
    let releaseJev!: () => void;
    let jevReleased = false;
    const delayedJev = new Promise<Response>((resolve) => {
      releaseJev = () => { jevReleased = true; resolve(Response.json(jevResponse)); };
    });
    const lunaRequests: Array<Record<string, unknown>> = [];
    let jevCalls = 0;
    const unexpected: string[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('accounts:lookup')) {
        return Response.json({ users: [{ localId: 'uid-user-a', emailVerified: true }] });
      }
      if (url === 'https://openrouter.ai/api/alpha/decisions') {
        jevCalls += 1;
        return row.delayed ? delayedJev : Response.json(jevResponse);
      }
      if (url === 'https://api.openai.com/v1/chat/completions') {
        lunaRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ choices: [{ finish_reason: 'length', message: {
          content: '{"decision":"fallback"}', refusal: 'private-luna-refusal-sentinel',
        } }], usage: lunaUsage });
      }
      unexpected.push(url);
      throw new Error('Unexpected test transport target.');
    });
    const request = new Request('https://proxy.example/chat/completions', {
      method: 'POST', headers: {
        Authorization: 'Bearer user-a', Origin: 'https://app.example', 'Content-Type': 'application/json',
        'X-StudyPlanner-AI-Request-Id': 'completion-jev-comparison',
      },
      body: JSON.stringify({
        purpose: 'weekly_planning_semantic_normalizer', decisionContext,
        messages: [{ role: 'user', content: 'private-input-sentinel' }], max_completion_tokens: 6400,
      }),
    });
    const observedEnv = {
      ...env,
      OPENROUTER_API_KEY: 'private-jev-test-key',
      JEV_MODE: row.mode, JEV_CANARY_PERCENT: '100',
      JEV_FOCUSED_AUTHORIZATION_MODE: row.mode, JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100',
    };
    const invocation = invoke(request, observedEnv);
    // Observe both fulfillment and rejection immediately, including when a lifecycle assertion fails.
    const settledInvocation = invocation.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let responseArrived = false;
    void settledInvocation.then(() => { responseArrived = true; });
    try {
      if (row.delayed) {
        // This bound is below the existing Jev timeout: provider timeout must not fake early return.
        await vi.waitFor(() => expect(responseArrived).toBe(true), { timeout: 500, interval: 5 });
        expect(jevReleased).toBe(false);
      }
      const result = await settledInvocation;
      if (!result.ok) throw result.error;
      const { response, tasks } = result.value;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(row.lunaCalls === 0
        ? { content: '{"decision":"create_plan"}', decisionContext: {
            requestId: decisionContext.requestId, inputRevision: decisionContext.inputRevision,
          } }
        : { content: '{"decision":"fallback"}', usage: lunaUsage });
      expect(response.headers.get('X-StudyPlanner-Internal-Jev-Mode')).toBeNull();
      expect(response.headers.get('X-StudyPlanner-Internal-Luna-Baseline-Failure')).toBeNull();

      let beforeLateDecision: string | undefined;
      if (row.delayed) {
        await vi.waitFor(() => expect(store.mock.calls.filter(([metric]) =>
          metric.payload.operationKind === 'chat_completion')).toHaveLength(1));
        expect(store.mock.calls.filter(([metric]) => metric.payload.operationKind === 'decision')).toHaveLength(0);
        const baseline = store.mock.calls.find(([metric]) => metric.payload.operationKind === 'chat_completion')![0];
        expect(baseline.payload.providerCompletion).toEqual(expectedCompletion);
        beforeLateDecision = JSON.stringify(baseline.payload.providerCompletion);
        releaseJev();
      }
      await Promise.all(tasks);
      expect(unexpected).toEqual([]);
      expect(lookupCalls(fetchMock)).toHaveLength(1);
      expect(jevCalls).toBe(1);
      expect(lunaRequests).toHaveLength(row.lunaCalls);
      lunaRequests.forEach((body) => {
        expect(body.max_completion_tokens).toBe(4096);
        expect(body).not.toHaveProperty('providerCompletion');
      });
      const metrics = store.mock.calls.map(([metric]) => metric);
      const decisions = metrics.filter((metric) => metric.payload.operationKind === 'decision');
      const completions = metrics.filter((metric) => metric.payload.operationKind === 'chat_completion');
      expect(metrics).toHaveLength(1 + row.lunaCalls);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].payload).toMatchObject({
        provider: 'openrouter', promptTokens: 200, completionTokens: 30,
        decision: { outcome: row.delayed ? 'shadow' : row.acceptJev ? 'success' : 'fallback' },
      });
      expect(decisions[0].payload).not.toHaveProperty('providerCompletion');
      expect(completions).toHaveLength(row.lunaCalls);
      if (completions.length > 0) {
        expect(completions[0]).toMatchObject({
          requestId: 'completion-jev-comparison', firebaseUid: 'uid-user-a',
          payload: { provider: 'openai', status: 'success', promptTokens: 40, completionTokens: 11,
            providerCompletion: expectedCompletion },
        });
        if (row.delayed) expect(JSON.stringify(completions[0].payload.providerCompletion)).toBe(beforeLateDecision);
      }
      expect(JSON.stringify({ payloads: metrics.map((metric) => metric.payload), logs: log.mock.calls }))
        .not.toMatch(/private-/);
    } finally {
      releaseJev();
      const result = await settledInvocation;
      if (result.ok) await Promise.allSettled(result.value.tasks);
      log.mockRestore();
    }
  });
});
