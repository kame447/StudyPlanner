import { afterEach, expect, it, vi } from 'vitest';
import worker from './worker';
import { JEV_MODEL } from './decision/decisionPolicy';
import type { CandidateChoiceWireRequest } from '../../../shared/candidateChoiceDecision';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../src/services/ai/openAiCompatibleClient';
import type { OpenAiCompatibleClient } from '../../../src/services/ai/openAiCompatibleClientTypes';
import { usesCloudflareOpenAiProxy } from '../../../src/lib/aiConfig';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY,
  VNEXT_OPTION_CHOICE_SEMANTIC_POLICY } from '../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextRuntimeInterpreter';
import { createWeeklyPlanningVNextOptionChoicePort } from '../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextOptionChoiceBrowserPort';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { presentWeeklyPlanningVNextQuestion } from '../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextQuestionText';
import type { VNextAddFact, WeeklyPlanningVNextState } from '../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';

vi.mock('../../../src/lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: () => 'https://proxy.uc-p0.invalid', usesCloudflareOpenAiProxy: vi.fn(() => true),
}));
vi.mock('../../../src/lib/firebaseClient', () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: async () => 'synthetic-token-a' } }),
}));

const scope = { ownerId: 'synthetic-owner-a', conversationId: 'synthetic-worker-chat' };
const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
const clock = { currentDate: horizon.startDate, planningStartDate: horizon.startDate, planningEndDate: horizon.endDate,
  defaultPlanningHorizon: horizon, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' as const };
const empty = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task: VNextAddFact = { kind: 'task', localId: 't', category: 'study', title: '架空の夕凪教材・数学' };
const pages = (localId: string, quantityRole: 'remaining' | 'scope_total' | 'completed', amount: number): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 't' }, componentRef: null, quantityRole, amount,
  unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
function seeded(add: VNextAddFact[]): WeeklyPlanningVNextState {
  const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { ...empty, add: [task, ...add] }, {
    expectedRevision: 0, acceptedDate: horizon.startDate, weekStartsOn: 'monday', planningHorizon: horizon,
    defaultPlanningHorizon: horizon, turnKey: 'synthetic-seed', turnId: 'synthetic-seed',
    conversationId: scope.conversationId, sourceText: '架空の教材の計測用条件です。',
  });
  if (result.status !== 'applied') throw new Error('synthetic seed rejected');
  return result.state;
}
type Port = Parameters<OpenAiCompatibleClient['createChatCompletion']>[0];
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const bodyBytes = (value: string) => new TextEncoder().encode(value).byteLength;

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetOpenAiCompatibleClientRequestBudgetForTest();
});

// Existing Worker harness pattern: actual runtime/clients/handler, synthetic auth and
// upstream transports only. No durable job/session/UI/real identity service is exercised.
it('measures native, focused and choice proxy/Worker/upstream requests with authenticated UID and binding controls', async () => {
  vi.stubEnv('VITE_AI_MAX_PROCESS_REQUESTS', '');
  vi.stubEnv('VITE_AI_EVAL_ENABLE_PURPOSE_MODEL_OVERRIDE', '0');
  resetOpenAiCompatibleClientRequestBudgetForTest();
  vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(true);
  let phase = 'native';
  let rollout: 'off' | 'candidate' | 'focused' = 'off';
  const ports: { phase: string; request: Port }[] = [];
  const choiceRequests: { phase: string; request: CandidateChoiceWireRequest }[] = [];
  const proxyBodies: { phase: string; body: string; status: number }[] = [];
  const upstreams: { phase: string; provider: string; body: string }[] = [];
  const directs: { phase: string; body: string }[] = [];
  const quotaKeys: { phase: string; key: string }[] = [];
  const identities: { phase: string; uid: string }[] = [];
  const pending: Promise<unknown>[] = [];
  const env = () => ({ OPENAI_API_KEY: 'synthetic-server-key', OPENROUTER_API_KEY: 'synthetic-jev-key',
    OPENAI_BASE_URL: 'https://openai.uc-p0.invalid/v1', FIREBASE_WEB_API_KEY: 'synthetic-project',
    ALLOWED_ORIGIN: 'https://app.uc-p0.invalid', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
    // Canary is confined to this fixture env, never deployment configuration.
    JEV_MODE: rollout === 'off' ? 'off' : 'canary', JEV_CANARY_PERCENT: rollout === 'off' ? '0' : '100',
    JEV_CANDIDATE_CHOICE_MODE: rollout === 'candidate' ? 'canary' : 'off', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100',
    JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: rollout === 'focused' ? 'canary' : 'off', JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100',
    AI_QUOTA: { getByName: (key: string) => {
      quotaKeys.push({ phase, key }); return { checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) };
    } },
  });
  async function handle(body: string, token: string | null = 'synthetic-token-a') {
    const response = await worker.fetch(new Request('https://proxy.uc-p0.invalid/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.uc-p0.invalid',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body,
    }), env() as never, undefined, { waitUntil: promise => pending.push(promise) } as ExecutionContext);
    proxyBodies.push({ phase, body, status: response.status });
    return response;
  }
  const completion = (body: { model: string; response_format?: { json_schema?: { name?: string } } }) => {
    const content = body.response_format?.json_schema?.name === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name
      ? { decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'total_duration',
        minutes: 40, precision: 'approximate', quantityRole: null }
      : { planningIntent: 'discuss', conversationActs: [], delta: empty, answer: null };
    return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://proxy.uc-p0.invalid/chat/completions') {
      const token = new Headers(init?.headers).get('Authorization');
      expect(token).toBe('Bearer synthetic-token-a');
      return handle(String(init?.body));
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?')) {
      const token = JSON.parse(String(init?.body)).idToken;
      const uid = token === 'synthetic-token-a' ? 'synthetic-auth-a' : token === 'synthetic-token-b' ? 'synthetic-auth-b' : null;
      if (!uid) return Response.json({ error: 'synthetic invalid token' }, { status: 400 });
      identities.push({ phase, uid }); return Response.json({ users: [{ localId: uid, emailVerified: true }] });
    }
    if (url === 'https://openai.uc-p0.invalid/v1/chat/completions') {
      upstreams.push({ phase, provider: 'openai', body: String(init?.body) }); return completion(JSON.parse(String(init?.body)));
    }
    if (url === 'https://direct.uc-p0.invalid/v1/chat/completions') {
      directs.push({ phase, body: String(init?.body) }); return completion(JSON.parse(String(init?.body)));
    }
    if (url === 'https://openrouter.ai/api/alpha/decisions') {
      const body = JSON.parse(String(init?.body));
      upstreams.push({ phase, provider: 'openrouter', body: String(init?.body) });
      const head = body.questions.candidate ? 'candidate' : 'contextual_answer';
      const ids = Object.keys(body.questions[head].criteria);
      const selected = head === 'candidate' ? ids.find(id => id !== 'none')! : 'focused_luna';
      return Response.json({ model: JEV_MODEL.responses[0], answers: {
        [head]: { type: 'choice', choice: selected, confidence: 1,
          probabilities: Object.fromEntries(ids.map(id => [id, id === selected ? 1 : 0])) },
        condition_change: { type: 'noul', noul: 0 }, independent_meaning: { type: 'noul', noul: 0 },
      } });
    }
    throw new Error(`Unexpected synthetic transport: ${url}`); // Never forwards a request.
  }));
  const adapter = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: 'https://direct.uc-p0.invalid/v1',
    model: 'gpt-6-luna', apiKey: 'synthetic-unused-client-key' });
  const client: OpenAiCompatibleClient = { createChatCompletion: request => {
    ports.push({ phase, request: structuredClone(request) }); return adapter.createChatCompletion(request);
  } };
  const choiceAdapter = createWeeklyPlanningVNextOptionChoicePort({ policy: VNEXT_OPTION_CHOICE_POLICY,
    client: { semanticPolicy: VNEXT_OPTION_CHOICE_SEMANTIC_POLICY, proxyUrl: 'https://proxy.uc-p0.invalid',
      getToken: async () => 'synthetic-token-a' } });
  const runtime = createWeeklyPlanningVNextRuntimeInterpreter(scope, { choice: { policy: VNEXT_OPTION_CHOICE_POLICY,
    choose: (request, beforeDispatch, observe) => {
      choiceRequests.push({ phase, request: structuredClone(request) }); return choiceAdapter.choose(request, beforeDispatch, observe);
    } }, focusedRequestId: () => 'synthetic-worker-focused' });
  async function interpret(state: WeeklyPlanningVNextState, userText: string) {
    const projection = projectWeeklyPlanningVNext(state);
    const question = projection.questions[0] ?? null;
    return runtime({ client, state, projection, presentedQuestion: question,
      presentedText: question ? presentWeeklyPlanningVNextQuestion(state, question).text : null, userText, clock, recentConversation: [] });
  }
  expect((await interpret(createEmptyWeeklyPlanningVNextState(), '架空の教材の相談を始めます。')).status).toBe('interpreted');
  phase = 'focused';
  const focused = await interpret(seeded([pages('pages', 'remaining', 8)]), '40分くらいです。');
  expect(focused).toMatchObject({ status: 'interpreted', metrics: { calls: 1 } });
  expect(ports[1].request.decisionContext?.purpose).toBe('focused_contextual_answer_v2');
  phase = 'choice'; rollout = 'candidate';
  const chosen = await interpret(seeded([pages('total', 'scope_total', 20), pages('done', 'completed', 12), pages('left', 'remaining', 7)]), '最初の選択肢でお願いします。');
  expect(chosen).toMatchObject({ status: 'interpreted', answer: { kind: 'option' }, metrics: { calls: 1 } });
  expect(upstreams.filter(item => item.phase === 'choice').map(item => item.provider)).toEqual(['openrouter']);
  const nativeBody = proxyBodies.find(item => item.phase === 'native')!.body;
  const focusedBody = proxyBodies.find(item => item.phase === 'focused')!.body;
  const choiceBody = proxyBodies.find(item => item.phase === 'choice')!.body;
  expect(JSON.parse(choiceBody).decisionContext.request).toEqual(choiceRequests[0].request);
  expect(JSON.parse(focusedBody).decisionContext).toEqual(ports[1].request.decisionContext);
  expect(JSON.parse(upstreams.find(item => item.phase === 'focused')!.body)).not.toHaveProperty('decisionContext');

  phase = 'choice-off'; rollout = 'off';
  expect(await (await handle(choiceBody)).json()).toMatchObject({ status: 'unavailable', reason: 'off' });
  expect(upstreams.filter(item => item.phase === phase)).toEqual([]);
  phase = 'other-authenticated-owner';
  expect((await handle(nativeBody, 'synthetic-token-b')).status).toBe(200);
  expect(quotaKeys.filter(item => item.phase === phase && item.key.startsWith('uid:')).map(item => item.key)).toEqual(['uid:synthetic-auth-b']);
  expect(quotaKeys.some(item => item.key === `uid:${scope.ownerId}`)).toBe(false);
  phase = 'unauthenticated';
  expect((await handle(nativeBody, null)).status).toBe(401);
  expect(upstreams.filter(item => item.phase === phase)).toEqual([]);
  phase = 'bound-focused'; rollout = 'focused';
  expect((await handle(focusedBody)).status).toBe(200);
  expect(upstreams.filter(item => item.phase === phase).map(item => item.provider)).toEqual(['openrouter', 'openai']);
  phase = 'mismatched-focused';
  const mismatch = JSON.parse(focusedBody);
  const source = JSON.parse(mismatch.messages[1].content);
  source.pendingQuestion.questionTargetWorkload.amount = 9;
  mismatch.messages[1].content = JSON.stringify(source);
  expect((await handle(JSON.stringify(mismatch))).status).toBe(200);
  expect(upstreams.filter(item => item.phase === phase).map(item => item.provider)).toEqual(['openai']);
  // The original Luna request remains a fallback; an unbound target never reaches Jev.

  vi.mocked(usesCloudflareOpenAiProxy).mockReturnValue(false);
  for (const captured of ports) {
    phase = `${captured.phase}-direct-pair`; await adapter.createChatCompletion(captured.request);
    const direct = directs[directs.length - 1].body;
    const upstream = upstreams.find(item => item.phase === captured.phase && item.provider === 'openai')!.body;
    expect(direct).toBe(upstream); // Same fixed model/budget, Worker strips the proxy-only binding envelope.
  }
  await Promise.all(pending);
  for (const item of upstreams) {
    const body = JSON.parse(item.body);
    expect(body).not.toHaveProperty('decisionContext');
    expect(body).not.toHaveProperty('ownerId');
  }
  expect(identities.filter(item => item.uid === 'synthetic-auth-b')).toHaveLength(1);
  for (const identity of identities) {
    expect(quotaKeys.filter(item => item.phase === identity.phase && item.key.startsWith('uid:')).map(item => item.key))
      .toEqual([`uid:${identity.uid}`]);
  }
  expect(quotaKeys.filter(item => item.phase === 'unauthenticated')).toEqual([]);
  const summary = proxyBodies.map(item => ({ phase: item.phase, status: item.status, proxyBytes: bodyBytes(item.body),
    proxyMessages: JSON.parse(item.body).messages.length, proxyDecisionContext: Boolean(JSON.parse(item.body).decisionContext),
    upstream: upstreams.filter(sent => sent.phase === item.phase).map(sent => {
      const body = JSON.parse(sent.body);
      return { provider: sent.provider, bytes: bodyBytes(sent.body), messages: body.messages?.length ?? null,
        decisionContext: Boolean(body.decisionContext), fields: Object.keys(body).sort(),
        schemaBytes: body.response_format ? jsonBytes(body.response_format) : null };
    }) }));
  console.info('UC_P0_WORKER_BASELINE', JSON.stringify({ summary, portBytes: [...ports, ...choiceRequests].map(item => ({ phase: item.phase, bytes: jsonBytes(item.request) })),
    directBytes: directs.map(item => ({ phase: item.phase, bytes: bodyBytes(item.body) })), quotaKeys, identities,
    limits: 'synthetic auth/upstream only; no durable ownership/storage, token/cost/real latency or memory read measurement' }));
  if (process.env.WEEKLY_PLANNING_UC_P0_RAW_REPORT === '1') console.info('UC_P0_WORKER_RAW', JSON.stringify({ ports, choiceRequests, proxyBodies, upstreams, directs }));
});
