import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUtf8ByteLength } from '../../../shared/aiProxyContract';
import * as aiProxyContract from '../../../shared/aiProxyContract';
import { ProductObservabilityStore } from './productObservabilityStore';
import * as aiProxyObserver from './aiProxyRequestObserver';
import traceWorker from './traceWorker';

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
