import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from './openAiCompatibleClient';
import { createSemanticRequestRecorder } from '../../../shared/semanticDispatchRecorder';
import { getCloudflareAiProxyUrl, usesCloudflareOpenAiProxy } from '../../lib/aiConfig';
import { getFirebaseAuth } from '../../lib/firebaseClient';

vi.mock('../../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: vi.fn(), usesCloudflareOpenAiProxy: vi.fn() }));
vi.mock('../../lib/firebaseClient', () => ({ getFirebaseAuth: vi.fn() }));
const recorder = (stage: 'initial' | 'repair' | 'audit' | 'retry' = 'initial') => createSemanticRequestRecorder({ population: { source: 'fixture', domain: 'weekly-planning', arm: 'baseline', corpusId: crypto.randomUUID() }, turnId: crypto.randomUUID(), requestId: crypto.randomUUID(), stage, boundary: 'direct' });
const config = { baseUrl: 'https://provider.test/v1', model: 'gpt-5.6-luna', apiKey: 'private-api-key' };
const input = { purpose: 'weekly_planning_semantic_normalizer' as const, messages: [{ role: 'user' as const, content: 'private-japanese-request' }] };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); resetOpenAiCompatibleClientRequestBudgetForTest(); });

describe('direct versus proxy dispatch evidence', () => {
  it.each([true, false])('census join metadata travels only to our proxy: proxy=%s', async (proxy) => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(proxy);
    vi.mocked(getCloudflareAiProxyUrl).mockReturnValue('https://proxy.test');
    vi.mocked(getFirebaseAuth).mockReturnValue({ currentUser: { getIdToken: async () => 'private-token' } } as never);
    const transport = vi.fn(async () => Response.json(proxy ? { content: 'result' } : { choices: [{ message: { content: 'result' } }] }));
    vi.stubGlobal('fetch', transport);
    const semanticCensus = { version: 1 as const, domain: 'weekly-planning' as const, turnId: crypto.randomUUID(), requestId: crypto.randomUUID(), stage: 'repair' as const };
    await createOpenAiCompatibleClient(config).createChatCompletion({ ...input, semanticCensus, semanticCensusStage: 'repair' });
    const body = JSON.parse((transport.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    if (proxy) expect(body.semanticCensus).toEqual(semanticCensus);
    else expect(body).not.toHaveProperty('semanticCensus');
    expect(body).not.toHaveProperty('semanticCensusStage');
  });
  it.each(['initial', 'repair', 'audit', 'retry'] as const)('captures an actual direct %s dispatch without adding fields to the provider body', async (stage) => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
    const transport = vi.fn(async () => Response.json({ choices: [{ message: { content: 'private-provider-output' } }], usage: { prompt_tokens: 8, completion_tokens: 2 } })); vi.stubGlobal('fetch', transport);
    const capture = recorder(stage);
    expect(await createOpenAiCompatibleClient({ ...config, dispatchRecorder: capture }).createChatCompletion(input)).toBe('private-provider-output');
    expect(capture.snapshot()).toMatchObject({ integrity: 'complete', dispatches: [{ stage, family: 'luna', usage: { inputTokens: 8, outputTokens: 2, costUsd: null } }] });
    expect(JSON.stringify(capture.snapshot())).not.toContain('private-');
    const body = JSON.parse((transport.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(body).sort()).toEqual(['messages', 'model']);
  });
  it('keeps a successful proxy response unknown even when it reports usage', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(true); vi.mocked(getCloudflareAiProxyUrl).mockReturnValue('https://proxy.test');
    vi.mocked(getFirebaseAuth).mockReturnValue({ currentUser: { getIdToken: async () => 'private-token' } } as never);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ content: 'result', usage: { prompt_tokens: 5, completion_tokens: 2 } })));
    const capture = recorder();
    await createOpenAiCompatibleClient({ ...config, dispatchRecorder: capture }).createChatCompletion(input);
    expect(capture.snapshot()).toMatchObject({ boundary: 'unobserved_proxy', integrity: 'unknown', dispatches: [] });
  });
  it('distinguishes a local budget rejection from a dispatched timeout', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false); vi.stubEnv('VITE_AI_MAX_PROCESS_REQUESTS', '1');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'result' } }] })));
    await createOpenAiCompatibleClient(config).createChatCompletion(input);
    const budget = recorder(); await expect(createOpenAiCompatibleClient({ ...config, dispatchRecorder: budget }).createChatCompletion(input)).rejects.toThrow('budget');
    expect(budget.snapshot().dispatches).toHaveLength(0);
    vi.unstubAllEnvs();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))));
    const timeout = recorder();
    await expect(createOpenAiCompatibleClient({ ...config, requestTimeoutMs: 5, dispatchRecorder: timeout }).createChatCompletion(input)).rejects.toThrow('timed out');
    expect(timeout.snapshot().dispatches).toMatchObject([{ outcome: 'timeout', family: 'luna', usage: { inputTokens: null } }]);
  });
  it('makes renderer observations unknown and excludes renderer from semantic dispatches', async () => {
    vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'result' } }] })));
    const capture = recorder(); await createOpenAiCompatibleClient({ ...config, dispatchRecorder: capture }).createChatCompletion({ ...input, purpose: 'weekly_planning_renderer' });
    expect(capture.snapshot()).toMatchObject({ integrity: 'unknown', dispatches: [] });
  });
});
