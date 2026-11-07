import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { prepareWeeklyPlanningTraceServerWrite } from '../weeklyPlanningTracePrivacy';
import { recordCommittedWeeklyPlanningApplicationTurn } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTurnTraceSideEffects';
import { createMemoryStorageHarness } from '../../../../src/features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { listWeeklyPlanningTraceOutboxItems } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceOutbox';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTraceTurnDiagnosticEntry } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceTypes';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { CANDIDATE_CHOICE_QUESTION_CODES, isCandidateChoiceEvaluation, type CandidateChoiceWireRequest } from '../../../../shared/candidateChoiceDecision';
import { JEV_MODEL } from './decisionPolicy';
import { jevPurposeCanarySample } from './jevPurposeRollout';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { createWeeklyPlanningVNextOptionChoiceInterpreter, VNEXT_OPTION_CHOICE_CODES, type WeeklyPlanningVNextOptionChoicePort } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextOptionChoice';
import { presentWeeklyPlanningVNextQuestion } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextQuestionText';
import { VNEXT_OPTION_CHOICE_POLICY, VNEXT_OPTION_CHOICE_SEMANTIC_POLICY } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextRuntimeInterpreter';
import type { WeeklyPlanningVNextInterpretation, WeeklyPlanningVNextInterpretationInput } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, WeeklyPlanningVNextState } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import type { OpenAiCompatibleClient } from '../../../../src/services/ai/openAiCompatibleClientTypes';

/**
 * The Jev closed-choice path as production runs it: the Worker we deploy reads `workers/ai-proxy/wrangler.jsonc`.
 * Its vars are used unchanged below; only secrets are fixtures. Nothing here changes a production var.
 */
const repository = vi.hoisted(() => ({ fail: true, writes: [] as Array<{ session: Record<string, unknown>; entries: Record<string, unknown>[] }> }));
vi.mock('../../../../src/features/weeklyPlanning/trace/weeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceEnabled: () => true,
  getWeeklyPlanningTraceRepository: () => ({ async appendEntries(params: { session: Record<string, unknown>; entries: Record<string, unknown>[] }) {
    if (repository.fail) throw new Error('intentional first append failure');
    repository.writes.push(structuredClone(params));
  } }) }));
beforeEach(() => {
  repository.fail = true; repository.writes.length = 0;
  vi.stubGlobal('window', { localStorage: createMemoryStorageHarness().storage });
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
});
const production = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')).vars as Record<string, string>;
const OWNER = 'fixture-owner';
const allowQuota = { AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 1 }) }) } };
const denyQuota = { AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: false, retryAfterSeconds: 30 }) }) } };
const prodEnv = (over: Record<string, unknown> = {}) => ({ ...production, OPENAI_API_KEY: 'fixture-openai', OPENROUTER_API_KEY: 'fixture-jev',
  FIREBASE_WEB_API_KEY: 'fixture-project', ALLOWED_ORIGIN: 'https://app.test', ...allowQuota, ...over });

const pages = (localId: string, role: 'scope_total' | 'completed' | 'remaining', amount: number): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 't' }, componentRef: null, quantityRole: role, amount,
  unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
function stateWith(adds: VNextAddFact[]): WeeklyPlanningVNextState {
  const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
  const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { add: [{ kind: 'task', localId: 't', category: 'study', title: '数学プリント' }, ...adds],
    patch: [], remove: [], relate: [], defer: [] }, { acceptedDate: '2026-11-02', weekStartsOn: 'monday', planningHorizon: horizon, defaultPlanningHorizon: horizon,
    turnKey: 'seed', expectedRevision: 0, conversationId: 'c', turnId: 'seed', sourceText: 'seed' });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
// Stated remaining 7 against total 20 - completed 12 = 8 (remaining_inconsistent); two remainders in different units (same_or_distinct_work).
const QUESTION_STATES = {
  remaining_inconsistent: () => stateWith([pages('total', 'scope_total', 20), pages('done', 'completed', 12), pages('left', 'remaining', 7)]),
  same_or_distinct_work: () => stateWith([pages('a', 'remaining', 20), { ...pages('b', 'remaining', 8), unitCode: 'custom', unitLabel: '問' } as VNextAddFact]),
} as const;
type VNextChoiceCode = keyof typeof QUESTION_STATES;
const fullReading: WeeklyPlanningVNextInterpretation = { status: 'interpreted', planningIntent: 'unknown',
  delta: { add: [], patch: [], remove: [], relate: [], defer: [] }, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
function interpretationInput(state: WeeklyPlanningVNextState, userText: string): WeeklyPlanningVNextInterpretationInput {
  const projection = projectWeeklyPlanningVNext(state); const presentedQuestion = projection.questions[0] ?? null;
  return { client: {} as OpenAiCompatibleClient, state, projection, presentedQuestion, userText,
    presentedText: presentedQuestion ? presentWeeklyPlanningVNextQuestion(state, presentedQuestion).text : null,
    clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday',
      defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' } } };
}

/** The exact request the production VNext composition sends: captured from the real interpreter and frozen policy. */
async function captureRequest(code: VNextChoiceCode, userText = '一つ目で') {
  let captured: CandidateChoiceWireRequest | undefined; let policy: WeeklyPlanningVNextOptionChoicePort['policy'] | undefined;
  const port: WeeklyPlanningVNextOptionChoicePort = { policy: VNEXT_OPTION_CHOICE_POLICY, choose: async (request, beforeDispatch) => {
    beforeDispatch(); captured = request as unknown as CandidateChoiceWireRequest; policy = VNEXT_OPTION_CHOICE_POLICY; throw new Error('captured'); } };
  const full = vi.fn(async () => fullReading);
  await createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading: full, choice: port, scope: { ownerId: OWNER, conversationId: 'c' } })(
    interpretationInput(QUESTION_STATES[code](), userText));
  expect(captured, `the production composition sends a closed choice for ${code}`).toBeDefined();
  return { request: captured!, policy: policy! };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('1. what the production client sends', () => {
  it('sends a closed choice only for the two VNext option question codes, under the frozen policy', async () => {
    expect([...VNEXT_OPTION_CHOICE_CODES].sort()).toEqual(['remaining_inconsistent', 'same_or_distinct_work']);
    for (const code of VNEXT_OPTION_CHOICE_CODES) expect(CANDIDATE_CHOICE_QUESTION_CODES, `${code} is in the shared catalog the Worker validates`).toContain(code);
    expect(VNEXT_OPTION_CHOICE_POLICY).toMatchObject({ id: 'vnext-frozen-dev', calibrationEvidenceId: 'vnext-dev-frozen-a25c9899' });
    expect(VNEXT_OPTION_CHOICE_SEMANTIC_POLICY).toEqual({ calibrationEvidenceId: 'vnext-dev-frozen-a25c9899', maximumConditionChange: 0.36, maximumIndependentMeaning: 0.69 });
    for (const code of Object.keys(QUESTION_STATES) as VNextChoiceCode[]) {
      const { request, policy } = await captureRequest(code);
      expect(request.context.question.code).toBe(code);
      expect(policy.id).toBe('vnext-frozen-dev');
      expect(request.menu.options.some(option => option.kind === 'none')).toBe(true);
    }
  });
});

/** The deployed Worker's own handler, with the production vars. Auth and the provider are the only fixtures. */
function install(provider: 'evaluated' | 'error' = 'evaluated', uid = OWNER) {
  const jevBodies: Record<string, unknown>[] = []; const lunaCalls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('identitytoolkit')) return Response.json({ users: [{ localId: uid, emailVerified: true }] });
    if (url.endsWith('/api/alpha/decisions')) {
      const body = JSON.parse(String(init?.body)) as Record<string, any>; jevBodies.push(body);
      if (provider === 'error') return Response.json({ error: 'fixture failure' }, { status: 502 });
      const options = Object.keys(body.questions.candidate.criteria as Record<string, string>);
      const first = options.find(id => id !== 'none') ?? options[0];
      const probabilities = Object.fromEntries(options.map(id => [id, id === first ? 0.97 : 0.03 / (options.length - 1)]));
      return Response.json({ model: JEV_MODEL.responses[0], answers: { candidate: { type: 'choice', choice: first, confidence: 0.97, probabilities },
        condition_change: { type: 'noul', noul: 0.01 }, independent_meaning: { type: 'noul', noul: 0.01 } } });
    }
    if (url.endsWith('/chat/completions')) { lunaCalls.push(url); return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content: 'ordinary Luna' } }] }); }
    throw new Error(`Unexpected endpoint ${url}`);
  }));
  return { jevBodies, lunaCalls };
}
const post = (request: CandidateChoiceWireRequest, env: Record<string, unknown>) => worker.fetch(new Request('https://proxy.test/chat/completions', {
  method: 'POST', headers: { Authorization: 'Bearer fixture', Origin: 'https://app.test' },
  body: JSON.stringify({ purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: request.wholeUtterance }],
    decisionContext: { purpose: 'candidate_choice', request } }) }), env as never, { waitUntil() {} } as never);

describe('2. what the Worker we deploy does with it (production vars, both codes)', () => {
  it('ships Jev candidate choice on: canary at 100 percent, master canary at 100 percent', () => {
    expect(production).toMatchObject({ JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100' });
  });

  it.each(Object.keys(QUESTION_STATES) as VNextChoiceCode[])('admits, decides and serializes the %s request exactly as the client validates it', async code => {
    const h = install(); const { request } = await captureRequest(code);
    const response = await post(request, prodEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('X-StudyPlanner-AI-Provider')).toBe('openrouter');
    const body = await response.json();
    expect(isCandidateChoiceEvaluation(body, request)).toBe(true);
    expect(h.jevBodies).toHaveLength(1);
    expect((h.jevBodies[0].state as { context: { question: { code: string } } }).context.question.code).toBe(code);
    expect(h.lunaCalls).toEqual([]);
  });

  const refusals: Array<{ label: string; vars: Record<string, unknown>; provider?: 'error'; jevCalled: boolean; reason: string | RegExp }> = [
    { label: 'master switch off', vars: { JEV_MODE: 'off' }, jevCalled: false, reason: 'off' },
    { label: 'purpose off', vars: { JEV_CANDIDATE_CHOICE_MODE: 'off' }, jevCalled: false, reason: 'off' },
    { label: 'purpose shadow (never selectable)', vars: { JEV_CANDIDATE_CHOICE_MODE: 'shadow' }, jevCalled: false, reason: 'not_selected' },
    { label: 'purpose canary percent 0', vars: { JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '0' }, jevCalled: false, reason: 'off' },
    { label: 'an unparseable percent closes', vars: { JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100.0' }, jevCalled: false, reason: 'off' },
    { label: 'no OpenRouter key', vars: { OPENROUTER_API_KEY: undefined }, jevCalled: false, reason: /./ },
    { label: 'provider failure (502)', vars: {}, provider: 'error', jevCalled: true, reason: /./ },
  ];
  it.each(refusals.flatMap(refusal => (Object.keys(QUESTION_STATES) as VNextChoiceCode[]).map(code => ({ ...refusal, code }))))(
    'refuses cleanly: $label ($code) is an ordinary 200 unavailable the client falls back from, with no Luna call', async ({ vars, provider, jevCalled, reason, code }) => {
      const h = install(provider); const { request } = await captureRequest(code);
      const response = await post(request, prodEnv(vars));
      expect(response.status).toBe(200);
      expect(response.headers.get('X-StudyPlanner-AI-Provider')).toBeNull();
      const body = await response.json() as { status: string; reason: string };
      expect(body.status).toBe('unavailable');
      expect(body.reason).toMatch(typeof reason === 'string' ? new RegExp(`^${reason}$`) : reason);
      expect(h.jevBodies.length).toBe(jevCalled ? 1 : 0);
      expect(h.lunaCalls).toEqual([]);
    });

  it('a user outside the canary percentage is not selected, and one inside is (the cohort is per user and per purpose)', async () => {
    const outside = Array.from({ length: 200 }, (_, index) => `cohort-${index}`).find(uid => jevPurposeCanarySample('candidate_choice', uid) >= 0.25)!;
    const inside = Array.from({ length: 200 }, (_, index) => `cohort-${index}`).find(uid => jevPurposeCanarySample('candidate_choice', uid) < 0.05)!;
    const { request } = await captureRequest('remaining_inconsistent');
    const partial = { JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '5' };
    const h1 = install('evaluated', outside);
    expect(await (await post(request, prodEnv(partial))).json()).toMatchObject({ status: 'unavailable', reason: 'not_selected' });
    expect(h1.jevBodies).toEqual([]);
    const h2 = install('evaluated', inside);
    expect(await (await post(request, prodEnv(partial))).json()).toMatchObject({ status: 'evaluated' });
    expect(h2.jevBodies).toHaveLength(1);
  });

  it('over quota is a 429 before any Jev dispatch, not a 200 unavailable (the one refusal that is not an ordinary fallback)', async () => {
    const h = install(); const { request } = await captureRequest('remaining_inconsistent');
    const response = await post(request, prodEnv(denyQuota));
    expect(response.status).toBe(429);
    expect(h.jevBodies).toEqual([]);
  });
});

// ---- 3 + 4: the durable production path, end to end through the real job, Worker handler and renderer contract ----
import { DurableTurnJob, type DurableTurnRecord } from '../durableTurns/durableTurnJob';
import { executeDurableVNextTurn } from '../durableTurns/durableVNextTurn';
import { serializeWeeklyPlanningTurnResult } from '../durableTurns/weeklyPlanningTurnResult';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import type { WeeklyPlanningVNextDurableTurnInput, WeeklyPlanningVNextDurableTurnResult } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';

const STARTED = '2026-11-02T00:00:00.000Z';
const CONVERSATION = 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000';
const emptyDelta = { patch: [], remove: [], relate: [], defer: [] };
const workload = (localId: string, quantityRole: string, amount: number) => ({ kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null,
  quantityRole, amount, unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const inconsistentReading = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null, delta: { ...emptyDelta, add: [
  { kind: 'task', localId: 'task', category: 'study', title: '数学プリント' }, workload('total', 'scope_total', 20), workload('done', 'completed', 12), workload('left', 'remaining', 7)] } });
const silentReading = JSON.stringify({ planningIntent: 'unknown', conversationActs: [], answer: null, delta: { ...emptyDelta, add: [] } });

function payload(requestId: string, userText: string, checkpoint: string | null): WeeklyPlanningVNextDurableTurnInput {
  return { core: 'vnext', weekStartDate: '2026-11-02', checkpoint, legacyV5Checkpoint: null,
    input: { userId: OWNER, conversationId: CONVERSATION, traceRequestId: requestId, inputStateRevision: 0, messages: [], userText, selectedDate: '2026-11-02', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: STARTED, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
}

/** One provider fixture for the durable path: native reading, V5 renderer contract, and Jev. Counts every spend. */
function installDurable(jev: 'evaluated' | 'http500' | 'abstain' = 'evaluated', nativeReading = silentReading) {
  const calls = { jev: 0, native: 0, renderer: 0, luna: 0 };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/alpha/decisions')) {
      calls.jev += 1;
      if (jev === 'http500') return Response.json({ error: 'fixture failure' }, { status: 500 });
      const body = JSON.parse(String(init?.body)) as { questions: { candidate: { criteria: Record<string, string> } } };
      const options = Object.keys(body.questions.candidate.criteria);
      const chosen = jev === 'abstain' ? 'none' : options.find(id => id !== 'none')!;
      const probabilities = Object.fromEntries(options.map(id => [id, id === chosen ? 0.97 : 0.03 / (options.length - 1)]));
      return Response.json({ model: JEV_MODEL.responses[0], answers: { candidate: { type: 'choice', choice: chosen, confidence: 0.97, probabilities },
        condition_change: { type: 'noul', noul: 0.01 }, independent_meaning: { type: 'noul', noul: 0.01 } } });
    }
    calls.luna += 1;
    const body = JSON.parse(String(init!.body)) as { response_format?: { json_schema?: { name?: string } }; messages: { content: string }[] };
    const schema = body.response_format?.json_schema?.name; let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) { calls.native += 1; content = nativeReading; }
    else { calls.renderer += 1; content = await successfulWeeklyPlanningRendererCompletion(body); }
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  return calls;
}

/** The real job: its journal and its stop-on-provider-failure rule decide what a failed dispatch costs the turn. */
async function runDurable(env: Record<string, unknown>, turn: WeeklyPlanningVNextDurableTurnInput) {
  let record: DurableTurnRecord | undefined; const startedAt = Date.parse(STARTED);
  const job = new DurableTurnJob({ read: async () => record && structuredClone(record), write: async next => { record = structuredClone(next); }, alarmAt: async () => {} }, () => startedAt);
  await job.accept({ ownerId: OWNER, conversationId: CONVERSATION, requestId: turn.input.traceRequestId!, baseRevision: 0, startedAt, payload: JSON.stringify(turn) });
  await job.run(async (raw, dispatch, ip, deadline) => serializeWeeklyPlanningTurnResult(
    await executeDurableVNextTurn(env as never, JSON.parse(raw), dispatch, ip, deadline)));
  return { record: record!, result: record!.status === 'completed' ? JSON.parse(record!.result!) as WeeklyPlanningVNextDurableTurnResult : null };
}
const optionChoiceOf = (result: WeeklyPlanningVNextDurableTurnResult) => {
  const validation = (result.result.debugTraceEvents ?? []).filter(event => event.stage === 'semantic_validation_result').slice(-1)[0];
  return ((validation?.data as { parsedDocument?: { metrics?: { optionChoice?: Record<string, unknown> } } })?.parsedDocument)?.metrics?.optionChoice;
};

describe('3. fallback and 4. trace, through the durable production path', () => {
  async function presentedQuestionCheckpoint() {
    installDurable('evaluated', inconsistentReading);
    const first = await runDurable(prodEnv(), payload('chat:request:1', '数学プリントは20枚で12枚終わっていて、残り7枚です', null));
    expect(first.record.status).toBe('completed');
    const checkpoint = first.result!.checkpointAfter!;
    const state = JSON.parse(checkpoint).vnext as { presentedQuestion: { questionKey: string } | null };
    expect(state.presentedQuestion?.questionKey).toMatch(/^remaining_inconsistent:/);
    return checkpoint;
  }

  it('Jev admitted: the closed choice answers the question, no native reading is spent, and the decision reaches the trace', async () => {
    const checkpoint = await presentedQuestionCheckpoint();
    const calls = installDurable('evaluated');
    const turn = await runDurable(prodEnv(), payload('chat:request:2', '一つ目で', checkpoint));
    expect(turn.record.status).toBe('completed');
    expect(calls).toMatchObject({ jev: 1, native: 0 });
    expect(optionChoiceOf(turn.result!)).toMatchObject({ gateReason: 'selected', reason: 'selected', policyId: 'vnext-frozen-dev' });
  });

  it.each([
    { label: 'Jev off', env: { JEV_MODE: 'off' }, jev: 'evaluated' as const, jevCalls: 0, gateReason: 'provider_error' },
    { label: 'no OpenRouter key', env: { OPENROUTER_API_KEY: undefined }, jev: 'evaluated' as const, jevCalls: 0, gateReason: 'provider_error' },
    { label: 'Jev abstains (none)', env: {}, jev: 'abstain' as const, jevCalls: 1, gateReason: 'none' },
    { label: 'Jev provider failure', env: {}, jev: 'http500' as const, jevCalls: 1, gateReason: 'provider_error' },
  ])('$label: the full native reading answers once, the turn completes, nothing fails, and the fallback reason reaches the trace', async ({ env, jev, jevCalls, gateReason }) => {
    const checkpoint = await presentedQuestionCheckpoint();
    const calls = installDurable(jev);
    const turn = await runDurable(prodEnv(env), payload('chat:request:2', '一つ目で', checkpoint));
    expect(turn.record.status, `failure=${turn.record.failure}`).toBe('completed');
    expect(calls.jev).toBe(jevCalls);
    expect(calls.native, 'exactly one native reading: no double AI spend').toBe(1);
    expect(optionChoiceOf(turn.result!)).toMatchObject({ gateReason, policyId: 'vnext-frozen-dev' });
    expect(optionChoiceOf(turn.result!)).toHaveProperty('reason', gateReason === 'none' ? 'none' : 'schema_or_transport');
    expect(turn.result!.result.failure).toBeUndefined();
  });

  it('over quota on the Jev call alone still ends in the native reading, not a failed turn', async () => {
    const checkpoint = await presentedQuestionCheckpoint();
    const calls = installDurable('evaluated');
    let denied = false;
    // The first chat-quota check after the question is the Jev dispatch; every later one passes.
    const quota = { AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => { const allowed = denied; denied = true; return { allowed, retryAfterSeconds: 30 }; } }) } };
    denied = false;
    const turn = await runDurable(prodEnv(quota), payload('chat:request:2', '一つ目で', checkpoint));
    expect(turn.record.status, `failure=${turn.record.failure}`).toBe('completed');
    expect(calls.jev).toBe(0);
    expect(calls.native).toBe(1);
  });

  // Gate items 1 (the request/decision reaches the trace), 4 (outbox retry) and 6 (an unregistered field survives) for the Jev decision.
  it.each([
    { label: 'a Jev decision', jev: 'evaluated' as const, env: {}, gateReason: 'selected' },
    { label: 'a fallback reason', jev: 'evaluated' as const, env: { JEV_MODE: 'off' }, gateReason: 'provider_error' },
  ])('persists $label through failed append, outbox retry and the Worker preparation', async ({ jev, env, gateReason }) => {
    const checkpoint = await presentedQuestionCheckpoint();
    installDurable(jev);
    const turn = await runDurable(prodEnv(env), payload('chat:request:2', '一つ目で', checkpoint));
    expect(turn.record.status).toBe('completed');
    const optionChoice = optionChoiceOf(turn.result!)!;
    expect(optionChoice).toMatchObject({ gateReason, policyId: 'vnext-frozen-dev' });
    // A future field the schema never heard of must survive (gate item 6).
    const validation = (turn.result!.result.debugTraceEvents ?? []).filter(event => event.stage === 'semantic_validation_result').slice(-1)[0];
    ((validation.data as { parsedDocument: { metrics: { optionChoice: Record<string, unknown> } } }).parsedDocument.metrics.optionChoice).futureJevField = 'future-jev-safe-field';
    const pending = { conversationId: CONVERSATION, turnId: `${CONVERSATION}:turn:2`, requestId: 'chat:request:2', weekStartDate: '2026-11-02', baseRevision: 0, startedAt: STARTED };
    await recordCommittedWeeklyPlanningApplicationTurn({ ownerId: OWNER, pending, userText: '一つ目で', result: turn.result!.result });
    expect(repository.writes).toEqual([]);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toHaveLength(1);
    expect(JSON.stringify(queued)).toContain('future-jev-safe-field');
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest(); repository.fail = false;
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'chat:request:2-retry', debugTraceEvents: [] });
    const write = repository.writes[0]; expect(write).toBeDefined();
    const entry = write.entries[0] as unknown as WeeklyPlanningTraceTurnDiagnosticEntry;
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite(write, { token: `wpt_${'a'.repeat(43)}`, epoch: '100' },
      { sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, '2026-11-02T00:00:00Z');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    const stored = JSON.stringify(prepared);
    expect(stored).toContain(gateReason);
    expect(stored).toContain('vnext-frozen-dev');
    expect(stored).toContain('future-jev-safe-field');
  });
});
