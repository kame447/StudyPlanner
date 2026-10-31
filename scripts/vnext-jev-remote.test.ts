import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createVNextJevRemoteSource } from './vnext-jev-remote-worker.mjs';
import { remoteSmokeRequest } from './vnext-jev-remote-smoke.ts';
import { CANDIDATE_CHOICE_CATALOG_VERSION, isCandidateChoiceDecisionContext, type CandidateChoiceWireRequest } from '../shared/candidateChoiceDecision';
import { startVNextJevRemote } from './vnext-jev-remote';

const preview = vi.hoisted(() => ({ fetch: vi.fn(), stop: vi.fn(async () => {}) }));
vi.mock('./verified-wrangler.mjs', () => ({ loadVerifiedWrangler: async () => ({ unstable_dev: async () => preview }) }));

const token = 'synthetic-preview-token';
const digest = createHash('sha256').update(token).digest('hex');
const expiresAt = 4_000_000_000_000;
const env = { OPENAI_API_KEY: 'synthetic-openai-secret', OPENROUTER_API_KEY: 'synthetic-openrouter-secret' };
const wireRequest = (): CandidateChoiceWireRequest => ({ wholeUtterance: 'synthetic', requestId: 'request', selectionEpoch: 1,
  candidateSetHash: `sha256:${'0'.repeat(64)}`, context: { question: { id: 'q', code: 'remaining_inconsistent' },
    target: { kind: 'work', id: 'w' }, scope: {} }, menu: { nodeId: 'menu', depth: 0, kind: 'leaves', options: [
    { kind: 'leaf', id: 'leaf:0', candidate: { id: 'left', label: 'Left', tuple: { value: 8 } } }, { kind: 'none', id: 'none' },
  ] } });
let worker: { fetch(request: Request, bindings: typeof env): Promise<Response> };
const request = (path: string, body?: unknown, bearer = token) => new Request(`https://preview.invalid${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
beforeAll(async () => {
  const compiled = await build({ stdin: { contents: createVNextJevRemoteSource({ root: resolve('.'), digest, expiresAt }),
    resolveDir: resolve('.'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  worker = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)).default;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('VNext remote preview source (offline only)', () => {
  it('embeds only the token digest and makes unauthenticated/expired requests indistinguishable', async () => {
    const source = createVNextJevRemoteSource({ root: resolve('.'), digest, expiresAt });
    expect(source).toContain(digest);
    expect(source).not.toContain(token);
    expect((await worker.fetch(request('/ready', undefined, 'wrong'), env)).status).toBe(404);
    vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    expect((await worker.fetch(request('/ready'), env)).status).toBe(404);
  });

  it('reports binding presence only, rejects other models and non-candidate contexts without provider exposure', async () => {
    const fetch = vi.fn(() => { throw new Error('Unexpected provider exposure'); });
    vi.stubGlobal('fetch', fetch);
    expect(await (await worker.fetch(request('/ready'), env)).json()).toEqual({ openAi: true, openRouter: true });
    expect(await (await worker.fetch(request('/ready'), {} as typeof env)).json()).toEqual({ openAi: false, openRouter: false });
    expect((await worker.fetch(request('/luna', { model: 'another-model', messages: [] }), env)).status).toBe(400);
    expect((await worker.fetch(request('/jev', { decisionContext: { purpose: 'authorization' } }), env)).status).toBe(400);
    expect((await worker.fetch(request('/elsewhere', {}), env)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the Luna request body and extracts usage without returning upstream errors or secrets', async () => {
    const body = { model: 'gpt-6-luna', messages: [{ role: 'user', content: 'synthetic input' }], max_completion_tokens: 256 };
    const fetch = vi.fn(async () => Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: 'ready' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(request('/luna', body), env);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual(body);
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
    expect(await response.json()).toMatchObject({ usage: { inputTokens: 10, outputTokens: 2, costUsd: null, servedModel: 'gpt-6-luna' } });
    fetch.mockImplementation(async () => new Response(`${env.OPENAI_API_KEY} upstream-private-body`, { status: 503 }));
    const failed = await worker.fetch(request('/luna', body), env);
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('{"status":503}');
    fetch.mockImplementation(async () => { throw new Error(`${env.OPENAI_API_KEY} private headers/body`); });
    expect(await (await worker.fetch(request('/luna', body), env)).text()).toBe('{"status":502}');
  });

  it('keeps an actual VNext basis request within the existing wire contract', async () => {
    const r = await remoteSmokeRequest();
    expect(r.requestId.length, 'wire requestId length').toBeLessThanOrEqual(160);
    expect(r.context.question.id.length, 'wire question id length').toBeLessThanOrEqual(160);
    expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: r })).toBe(true);
  });

  it('runs this branch candidate-choice evaluator and retains OpenRouter usage without its raw payload', async () => {
    const r = wireRequest();
    const selected = r.menu.options[0].id;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ model: 'typesafe/jev-1.14',
      usage: { input_tokens: 31, output_tokens: 2, cost: 0.000003 },
      answers: {
        candidate: { type: 'choice', confidence: 0.99, choice: selected,
          probabilities: Object.fromEntries(r.menu.options.map(o => [o.id, o.id === selected ? 0.99 : 0.01])) },
        condition_change: { type: 'noul', noul: 0.01 },
        independent_meaning: { type: 'noul', noul: 0.01 },
      },
    })));
    const response = await worker.fetch(request('/jev', { decisionContext: { purpose: 'candidate_choice', request: r } }), env);
    const result = await response.json();
    expect(result.usage).toMatchObject({ inputTokens: 31, outputTokens: 2, costUsd: 0.000003 });
    expect(result.result).toMatchObject({ status: 'evaluated', optionId: selected });
    expect(result).not.toHaveProperty('answers');
  });
});

describe('VNext remote client transport (offline only)', () => {
  it('requires local opt-in before starting any preview', async () => {
    vi.stubEnv('VNEXT_JEV_REMOTE', undefined);
    await expect(startVNextJevRemote({ worker: 'synthetic', ttlMs: 60000 })).rejects.toThrow('explicit local opt-in');
  });

  it('keeps the direct Luna body, restores global fetch, counts only metrics, and cleans up', async () => {
    vi.stubEnv('VNEXT_JEV_REMOTE', '1'); vi.stubEnv('CI', undefined);
    vi.stubEnv('VITE_AI_PROXY_URL', ''); vi.stubEnv('VITE_CLOUDFLARE_AI_PROXY_URL', '');
    const original = globalThis.fetch;
    const bodies: unknown[] = [];
    preview.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/ready') return Response.json({ openAi: true, openRouter: true });
      bodies.push(JSON.parse(init!.body as string));
      return Response.json({ result: { model: 'gpt-6-luna', choices: [{ message: { content: 'ready' } }] },
        usage: { inputTokens: 3, outputTokens: 1, costUsd: null, servedModel: 'gpt-6-luna', httpStatus: 200, latencyMs: 1 } });
    });
    const remote = await startVNextJevRemote({ worker: 'synthetic', ttlMs: 60000 });
    try {
      expect(await remote.lunaClient.createChatCompletion({ messages: [{ role: 'user', content: 'synthetic' }], maxCompletionTokens: 256 })).toBe('ready');
      expect(bodies).toEqual([{ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'synthetic' }], max_completion_tokens: 256 }]);
      expect(globalThis.fetch).toBe(original);
      expect(remote.usage().luna).toMatchObject({ calls: 1, inputTokens: 3, outputTokens: 1, costUsd: null, servedModels: ['gpt-6-luna'] });
      expect(JSON.stringify(remote.usage())).not.toContain('synthetic');
      preview.fetch.mockImplementation(async () => { throw new Error('private upstream payload'); });
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(remote.lunaClient.createChatCompletion({ messages: [] })).rejects.toThrow('VNext Luna request failed.');
      expect(globalThis.fetch).toBe(original);
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private upstream payload');
    } finally { await remote.stop(); }
    expect(preview.stop).toHaveBeenCalled();
  });

  it('uses the production candidate client unchanged, with a scoped preview transport', async () => {
    vi.stubEnv('VNEXT_JEV_REMOTE', '1'); vi.stubEnv('CI', undefined);
    const r = wireRequest();
    const evaluation = { status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
      requestId: r.requestId, selectionEpoch: 1, candidateSetHash: r.candidateSetHash, nodeId: r.menu.nodeId,
      optionId: 'leaf:0', probabilities: [{ optionId: 'leaf:0', probability: 0.99 }, { optionId: 'none', probability: 0.01 }],
      conditionChange: 0.01, independentMeaning: 0.01 };
    let body: unknown;
    preview.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/ready') return Response.json({ openAi: true, openRouter: true });
      body = JSON.parse(init!.body as string);
      return Response.json({ result: evaluation, usage: { inputTokens: 5, outputTokens: 1, costUsd: 0.001,
        servedModel: 'typesafe/jev-1.14', httpStatus: 200, latencyMs: 1 } });
    });
    const remote = await startVNextJevRemote({ worker: 'synthetic', ttlMs: 60000 });
    try {
      const beforeDispatch = vi.fn();
      const choose = remote.jevChoose({ calibrationEvidenceId: 'offline-only', maximumConditionChange: 0.1, maximumIndependentMeaning: 0.1 });
      expect(await choose(r, beforeDispatch)).toEqual({ nodeId: r.menu.nodeId, requestId: r.requestId, selectionEpoch: 1,
        candidateSetHash: r.candidateSetHash, optionId: 'leaf:0', probabilities: evaluation.probabilities,
        semanticSufficiency: 'only_candidate_meaning' });
      expect(beforeDispatch).toHaveBeenCalledTimes(1);
      expect(body).toMatchObject({ decisionContext: { purpose: 'candidate_choice', request: r } });
      expect(remote.usage().jev).toMatchObject({ calls: 1, costUsd: 0.001, servedModels: ['typesafe/jev-1.14'] });
    } finally { await remote.stop(); }
  });
});
