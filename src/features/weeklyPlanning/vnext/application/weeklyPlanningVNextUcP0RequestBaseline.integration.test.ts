import { afterEach, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../../services/ai/openAiCompatibleClient';
import type { ChatMessage, OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY } from './weeklyPlanningVNextRuntimeInterpreter';

// Select the direct adapter deliberately. These bytes are not the production proxy,
// durable journal or Worker-reconstructed upstream body. Only fetch returns synthetic data.
vi.mock('../../../../lib/aiConfig', () => ({
  getCloudflareAiProxyUrl: () => '', usesCloudflareOpenAiProxy: () => false,
}));

const WEEK = '2026-11-02';
const ENDPOINT = 'https://uc-p0.invalid/v1/chat/completions';
const FIRST = '架空の青葉教材の数学を60分進めたいです。初回発話の印は星砂です。';
const TASK = '架空の青葉教材・数学';
const REPLY = '架空の条件を保持しました。';
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const facts: VNextAddFact[] = [
  { kind: 'task', localId: 'aoba', category: 'study', title: TASK },
  { kind: 'workload', localId: 'minutes', taskRef: { localId: 'aoba' }, componentRef: null,
    quantityRole: 'remaining', amount: 60, unitCode: 'minute', unitLabel: '分',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
];
const reading = (add: VNextAddFact[] = []) => ({
  planningIntent: 'discuss', conversationActs: [], delta: { ...empty, add }, answer: null,
});
type Context = {
  userText: string;
  recentConversation: ChatMessage[];
  activeFacts: Record<string, Record<string, unknown>[]>;
  clock: { planningStartDate: string; planningEndDate: string };
};
type WireRequest = {
  model: string; messages: ChatMessage[]; response_format: unknown; max_completion_tokens: number;
};
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetOpenAiCompatibleClientRequestBudgetForTest();
});

it('measures the native route port and serialized direct-adapter request with synthetic history and scope controls', async () => {
  vi.stubEnv('VITE_AI_EVAL_ENABLE_PURPOSE_MODEL_OVERRIDE', '0');
  vi.stubEnv('VITE_AI_MAX_PROCESS_REQUESTS', '');
  resetOpenAiCompatibleClientRequestBudgetForTest();
  const storage = createMemoryStorageHarness().storage;
  const saveBlock = vi.fn(async () => { throw new Error('unexpected plan save'); });
  const approvalWrite = vi.fn(() => { throw new Error('unexpected approval write'); });
  const choose = vi.fn(async () => { throw new Error('unexpected option-choice dispatch'); });
  const renderer = vi.fn(async () => ({ status: 'rendered' as const, text: REPLY, rawResponse: '' }));
  const scripted = [reading(facts), ...Array.from({ length: 6 }, () => reading())];
  const wireBodies: string[] = [];
  const portRequests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    wireBodies.push(init!.body as string);
    const next = scripted.shift();
    if (!next) throw new Error('synthetic response script exhausted');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(next) }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock); // No request is forwarded to a network implementation.
  const adapter = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: 'https://uc-p0.invalid/v1',
    model: 'gpt-6-luna', apiKey: 'synthetic-no-credential' });
  const client: OpenAiCompatibleClient = { createChatCompletion: async request => {
    portRequests.push(structuredClone(request)); // Capture before any possible repair mutates messages.
    return adapter.createChatCompletion(request);
  } };
  const measurements: Record<string, unknown>[] = [];
  function session(ownerId: string, conversationId: string) {
    const local = createWeeklyPlanningVNextLocalSession({ ownerId, weekStartDate: WEEK, chatId: conversationId,
      storage, legacyV5Raw: null });
    const scope: WeeklyPlanningVNextExperimentalScope = { ownerId, conversationId, weekStartDate: WEEK,
      notBeforeTime: '09:00', clock: { currentDate: WEEK, planningStartDate: WEEK,
        planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } };
    const interpret = createWeeklyPlanningVNextRuntimeInterpreter(scope, { choice: { policy: VNEXT_OPTION_CHOICE_POLICY, choose },
      focusedRequestId: () => 'synthetic-focused-request' });
    let sequence = 0;
    const ports: WeeklyPlanningVNextExperimentalPorts = {
      checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
      client, interpret, approvalLedger: { read: () => null, write: approvalWrite },
      plans: { findExistingPlanId: async () => undefined, saveBlock },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      now: () => '2026-11-02T09:00:00.000Z', createRenderer: () => ({ render: renderer }),
    };
    async function measure(label: string, userText: string) {
      const before = portRequests.length;
      const graph = local.readCheckpoint()?.vnext.state.graph;
      const active = new Set(graph?.factLifecycles.filter(item => item.status === 'active').map(item => item.factId));
      const internalFacts = graph ? [...graph.tasks, ...graph.workloads].filter(item => active.has(item.id)) : [];
      const started = performance.now();
      const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText,
        turnId: `synthetic-turn-${++sequence}`, shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
      const syntheticTurnMs = performance.now() - started;
      expect(result.outcome).toBe(label === 'bootstrap' ? 'applied' : 'noop');
      expect(portRequests.length - before).toBe(1);
      expect(wireBodies.length).toBe(portRequests.length);
      const port = portRequests[before];
      const wire = JSON.parse(wireBodies[before]) as WireRequest;
      expect(port.purpose).toBe('weekly_planning_semantic_normalizer');
      expect(wire.messages.map(message => message.role)).toEqual(['system', 'user']);
      expect(wire.messages).toEqual(port.messages);
      expect(wire.response_format).toEqual(port.responseFormat);
      expect(wire.max_completion_tokens).toBe(port.maxCompletionTokens);
      expect(wire.model).toBe('gpt-6-luna');
      const context = JSON.parse(wire.messages[1].content) as Context;
      const projectedFacts = Object.values(context.activeFacts).flat();
      const sourceKeys = [...new Set(internalFacts.flatMap(fact => Object.keys(fact.source)))].sort();
      measurements.push({ label, portRequestBytes: bytes(port), directHttpBodyBytes: new TextEncoder().encode(wireBodies[before]).byteLength,
        wireMessagesBytes: bytes(wire.messages), systemContentBytes: new TextEncoder().encode(wire.messages[0].content).byteLength,
        schemaBytes: bytes(wire.response_format), contextBytes: new TextEncoder().encode(wire.messages[1].content).byteLength,
        outerMessages: wire.messages.length, recentMessages: context.recentConversation.length,
        internalActiveFacts: active.size, projectedActiveFacts: projectedFacts.length,
        internalFactsWithSource: internalFacts.filter(fact => owns(fact, 'source')).length,
        internalSourceKeys: sourceKeys,
        projectedFactsWithSource: projectedFacts.filter(fact => owns(fact, 'source')).length,
        projectedFactsWithCreatedRevision: projectedFacts.filter(fact => owns(fact, 'createdRevision')).length,
        projectedFactKeys: projectedFacts.map(fact => Object.keys(fact).sort()),
        recentMessageKeys: context.recentConversation.map(message => Object.keys(message).sort()),
        contextKeys: Object.keys(context).sort(),
        ownerField: owns(context, 'ownerId'), conversationField: owns(context, 'conversationId'),
        planningHorizon: [context.clock.planningStartDate, context.clock.planningEndDate],
        calls: portRequests.length - before, syntheticTurnMs: Number(syntheticTurnMs.toFixed(3)) });
      return context;
    }
    return { local, measure };
  }
  const primary = session('synthetic-owner-a', 'synthetic-chat-a');
  await primary.measure('bootstrap', FIRST);
  await primary.measure('history-two', '架空の相談を続けます。');
  const within = await primary.measure('recent-four', '条件を確かめています。');
  const outside = await primary.measure('outside-window-active-facts', '次も相談を続けます。');
  expect(within.recentConversation.map(message => message.content)).toEqual([
    FIRST, REPLY, '架空の相談を続けます。', REPLY,
  ]);
  expect(outside.recentConversation.map(message => message.content)).toEqual([
    '架空の相談を続けます。', REPLY, '条件を確かめています。', REPLY,
  ]);
  expect(outside.activeFacts.tasks.map(fact => fact.title)).toEqual([TASK]);
  expect(outside.activeFacts.workloads.map(fact => fact.amount)).toEqual([60]);
  // Full content controls supplement aliases: absence of owner strings alone cannot prove isolation.
  for (const [label, owner, conversation] of [
    ['other-owner-same-chat', 'synthetic-owner-b', 'synthetic-chat-a'],
    ['other-owner-other-chat', 'synthetic-owner-b', 'synthetic-chat-b'],
    ['same-owner-other-chat', 'synthetic-owner-a', 'synthetic-chat-b'],
  ]) {
    const control = await session(owner, conversation).measure(label, '架空の別の相談を始めます。');
    expect(control.recentConversation).toEqual([]);
    expect(Object.values(control.activeFacts).flat()).toEqual([]);
    expect(JSON.stringify(control)).not.toContain(TASK);
    expect(JSON.stringify(control)).not.toContain('星砂');
  }
  expect(measurements.map(row => [row.recentMessages, row.internalActiveFacts, row.projectedActiveFacts, row.calls])).toEqual([
    [0, 0, 0, 1], [2, 2, 2, 1], [4, 2, 2, 1], [4, 2, 2, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1],
  ]);
  expect(measurements.map(row => [row.projectedFactsWithSource, row.projectedFactsWithCreatedRevision,
    row.ownerField, row.conversationField])).toEqual(Array.from({ length: 7 }, () => [0, 0, false, false]));
  expect(fetchMock).toHaveBeenCalledTimes(7);
  expect(scripted).toHaveLength(0);
  expect(choose).not.toHaveBeenCalled();
  expect(saveBlock).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();
  // No token/time threshold: synthetic turn times are observations, not real-provider budgets.
  const report = { boundary: 'native route: client port and direct adapter fetch body; Worker upstream unmeasured',
    model: 'gpt-6-luna', measurements, calls: { client: portRequests.length, fetch: fetchMock.mock.calls.length,
      optionChoice: choose.mock.calls.length, rendererStub: renderer.mock.calls.length },
    memoryRead: 'not connected to the normal VNext turn; no unavailable/empty outcome simulated', tokenUsage: 'unmeasured' };
  console.info('UC_P0_REQUEST_BASELINE', JSON.stringify(report));
  if (process.env.WEEKLY_PLANNING_UC_P0_RAW_REPORT === '1') {
    console.info('UC_P0_RAW_REQUESTS', JSON.stringify({ portRequests, directHttpBodies: wireBodies }));
  }
});
