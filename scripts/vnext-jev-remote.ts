import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenAiCompatibleClient } from '../src/services/ai/openAiCompatibleClient';
import { usesCloudflareOpenAiProxy } from '../src/lib/aiConfig';
import type { OpenAiCompatibleClient } from '../src/services/ai/openAiCompatibleClientTypes';
import { createCandidateChoiceClient, type CandidateSemanticGatePolicy } from '../src/services/ai/candidateChoiceClient';
import type { CandidateChoiceWireRequest, CandidateChoiceResult } from '../shared/candidateChoiceDecision';
import type { WeeklyPlanningVNextOptionChoicePort } from '../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextOptionChoice';
import { loadVerifiedWrangler } from './verified-wrangler.mjs';
import { createVNextJevRemoteSource } from './vnext-jev-remote-worker.mjs';

export interface ProviderUsage {
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  servedModels: string[];
  httpStatuses: (number | null)[];
  lastCall: ProviderCallUsage | null;
}
export interface ProviderCallUsage {
  inputTokens: number | null; outputTokens: number | null; costUsd: number | null;
  latencyMs: number; servedModel: string | null; httpStatus: number | null;
}
export interface VNextJevRemote {
  lunaClient: OpenAiCompatibleClient;
  evaluateJev(request: CandidateChoiceWireRequest): Promise<CandidateChoiceResult>;
  jevChoose(policy: CandidateSemanticGatePolicy): WeeklyPlanningVNextOptionChoicePort['choose'];
  usage(): { luna: ProviderUsage; jev: ProviderUsage };
  stop(): Promise<void>;
}
const origin = 'https://vnext-jev-remote.invalid';
// Serialize the short-lived global fetch scope, including overlapping harness instances.
let lunaQueue: Promise<unknown> = Promise.resolve();
const emptyUsage = (): ProviderUsage => ({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
  latencyMs: 0, servedModels: [], httpStatuses: [], lastCall: null });
function accumulate(total: ProviderUsage, receipt: ProviderCallUsage) {
  total.calls++;
  for (const key of ['inputTokens', 'outputTokens', 'costUsd'] as const) {
    total[key] = total[key] === null || receipt[key] === null ? null : total[key]! + receipt[key]!;
  }
  total.latencyMs += receipt.latencyMs;
  if (receipt.servedModel && !total.servedModels.includes(receipt.servedModel)) total.servedModels.push(receipt.servedModel);
  total.httpStatuses.push(receipt.httpStatus);
  total.lastCall = structuredClone(receipt);
}

export async function startVNextJevRemote(options: { worker: string; ttlMs: number }): Promise<VNextJevRemote> {
  if (process.env.VNEXT_JEV_REMOTE !== '1') throw new Error('VNext remote evaluation requires explicit local opt-in.');
  if (process.env.CI) throw new Error('VNext remote evaluation is local only.');
  if (usesCloudflareOpenAiProxy({ provider: 'openai' })) throw new Error('VNext remote evaluation requires direct-client mode.');
  if (!/^[a-zA-Z0-9-]+$/.test(options.worker) || !Number.isSafeInteger(options.ttlMs)
    || options.ttlMs <= 0 || options.ttlMs > 1_800_000) throw new Error('Invalid VNext remote preview options.');
  const { unstable_dev } = await loadVerifiedWrangler({ purpose: 'VNext remote evaluation',
    missingMessage: 'Put the pinned verified Wrangler on PATH before VNext remote evaluation.' });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(tmpdir(), 'studyplanner-vnext-jev-'));
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const expiresAt = Date.now() + options.ttlMs;
  let worker: { fetch: typeof fetch; stop(): Promise<void> } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    clearTimeout(timer);
    try { await worker?.stop(); } finally { await rm(directory, { recursive: true, force: true }); }
  })();
  try {
    const entry = join(directory, 'preview.ts');
    const config = join(directory, 'wrangler.json');
    await writeFile(entry, createVNextJevRemoteSource({ root, digest, expiresAt }));
    await writeFile(config, JSON.stringify({ name: options.worker, main: 'preview.ts', compatibility_date: '2026-04-10' }));
    worker = await unstable_dev(entry, { config, local: false, ip: '127.0.0.1', port: 0, inspect: false, logLevel: 'none',
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true,
        watch: false, showInteractiveDevSession: false, enableIpc: false } });
    timer = setTimeout(() => { void stop().catch(() => {}); }, Math.max(1, expiresAt - Date.now()));
    timer.unref();
    const totals = { luna: emptyUsage(), jev: emptyUsage() };
    const call = async (path: '/luna' | '/jev', body: string, signal?: AbortSignal | null) => {
      if (stopping || Date.now() >= expiresAt) throw new Error('VNext remote preview expired.');
      const started = Date.now();
      let receipt: ProviderCallUsage = { httpStatus: null, servedModel: null, latencyMs: 0, inputTokens: null, outputTokens: null, costUsd: null };
      try {
        const response = await worker!.fetch(path, { method: 'POST', body,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          signal: signal ?? AbortSignal.timeout(90_000) });
        receipt.httpStatus = response.status;
        if (!response.ok) throw new Error('VNext preview provider request failed.');
        const envelope = await response.json() as { result: unknown; usage: ProviderCallUsage };
        receipt = envelope.usage;
        return envelope.result;
      } catch { throw new Error('VNext preview provider request failed.'); }
      finally {
        accumulate(totals[path === '/luna' ? 'luna' : 'jev'], { ...receipt, latencyMs: Date.now() - started });
      }
    };
    const ready = await worker!.fetch('/ready', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(45_000) });
    if (!ready.ok) throw new Error('VNext preview readiness failed.');
    const presence = await ready.json() as { openRouter?: boolean; openAi?: boolean };
    if (presence.openRouter !== true || presence.openAi !== true) throw new Error('VNext preview provider binding missing.');

    const direct = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: origin,
      model: 'gpt-6-luna', apiKey: 'preview-only-placeholder', requestTimeoutMs: 90_000 });
    const lunaTransport: typeof fetch = async (url, init) => {
      if (String(url) !== `${origin}/chat/completions` || init?.method !== 'POST' || typeof init.body !== 'string') {
        throw new Error('VNext Luna transport refused endpoint.');
      }
      return Response.json(await call('/luna', init.body, init.signal));
    };
    const lunaClient: OpenAiCompatibleClient = { createChatCompletion(request) {
      const next = lunaQueue.then(async () => {
        const original = globalThis.fetch;
        globalThis.fetch = (url, init) => String(url).startsWith(origin)
          ? lunaTransport(url, init) : original(url, init);
        try { return await direct.createChatCompletion(request); }
        catch { throw new Error('VNext Luna request failed.'); }
        finally { globalThis.fetch = original; }
      });
      lunaQueue = next.catch(() => {});
      return next;
    } };
    return { lunaClient,
      evaluateJev: async request => await call('/jev', JSON.stringify({ decisionContext: { purpose: 'candidate_choice', request } })) as CandidateChoiceResult,
      jevChoose: semanticPolicy => createCandidateChoiceClient({ semanticPolicy, proxyUrl: origin,
        getToken: async () => 'preview-only-placeholder', timeoutMs: 20_000,
        transport: async (url, init) => {
          if (String(url) !== `${origin}/chat/completions` || typeof init?.body !== 'string') throw new Error('VNext Jev transport refused endpoint.');
          return Response.json(await call('/jev', init.body, init.signal));
        },
      }).choose,
      usage: () => structuredClone(totals), stop,
    };
  } catch {
    await stop();
    throw new Error('VNext remote preview startup failed.');
  }
}
