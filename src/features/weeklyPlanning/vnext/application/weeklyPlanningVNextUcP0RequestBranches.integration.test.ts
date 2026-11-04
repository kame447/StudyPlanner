import { afterEach, expect, it, vi } from 'vitest';
import { CANDIDATE_CHOICE_CATALOG_VERSION, type CandidateChoiceWireRequest } from '../../../../../shared/candidateChoiceDecision';
import { createOpenAiCompatibleClient, resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../../services/ai/openAiCompatibleClient';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../weeklyPlanningVNextV5Boundary';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { createWeeklyPlanningVNextOptionChoicePort } from './weeklyPlanningVNextOptionChoiceBrowserPort';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY,
  VNEXT_OPTION_CHOICE_SEMANTIC_POLICY } from './weeklyPlanningVNextRuntimeInterpreter';

vi.mock('../../../../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: () => '', usesCloudflareOpenAiProxy: () => false }));

const WEEK = '2026-11-02';
const OWNER = 'synthetic-branch-owner';
const CHAT = 'synthetic-branch-chat';
const FIRST = '架空の白波教材の数学を60分進めます。初回の印は月砂です。';
const CORRECTION = '60分ではなく90分に訂正します。訂正の印は月虹です。';
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task: VNextAddFact = { kind: 'task', localId: 't', category: 'study', title: '架空の白波教材・数学' };
const workload = (localId: string, quantityRole: 'remaining' | 'scope_total' | 'completed', amount: number,
  unitCode: 'minute' | 'page' = 'minute'): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 't' }, componentRef: null, quantityRole, amount,
  unitCode, unitLabel: unitCode === 'minute' ? '分' : 'ページ', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null,
});
const reading = (delta: Partial<VNextTurnDelta> = {}, planningIntent = 'discuss') => ({
  planningIntent, conversationActs: [], delta: { ...empty, ...delta }, answer: null,
});
type NativeContext = { activeFacts: Record<string, { id: string; amount?: number }[]>;
  recentConversation: { role: string; content: string }[] };
type Script = (context: NativeContext) => unknown;
type PortRequest = Parameters<OpenAiCompatibleClient['createChatCompletion']>[0];
type Capture = { label: string; route: 'native' | 'focused' | 'option-choice'; port: PortRequest | CandidateChoiceWireRequest; body: string };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const metadataKeys = new Set(['source', 'sourceText', 'createdRevision', 'sourceRevision', 'ownerId', 'conversationId', 'turnId', 'scope']);
function metadataPaths(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(metadataKeys.has(key) ? [`${path}.${key}`] : []), ...metadataPaths(child, `${path}.${key}`),
  ]);
}

afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetOpenAiCompatibleClientRequestBudgetForTest();
});

// Real session/runtime/gates/clients, synthetic responses only. Chat routes capture
// direct HTTP bodies; option choice captures the authenticated proxy envelope.
// Neither boundary is the production Worker's final upstream body.
function harness(scripts: Script[]) {
  vi.stubEnv('VITE_AI_EVAL_ENABLE_PURPOSE_MODEL_OVERRIDE', '0');
  vi.stubEnv('VITE_AI_MAX_PROCESS_REQUESTS', '');
  resetOpenAiCompatibleClientRequestBudgetForTest();
  const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: OWNER, conversationId: CHAT, weekStartDate: WEEK,
    notBeforeTime: '09:00', clock: { currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08',
      timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } };
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, chatId: CHAT,
    storage: createMemoryStorageHarness().storage, legacyV5Raw: null });
  const captures: Capture[] = [];
  const rows: Record<string, unknown>[] = [];
  const portRequests: PortRequest[] = [];
  const choiceRequests: CandidateChoiceWireRequest[] = [];
  let label = '';
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(url).toBe('https://uc-p0.invalid/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    const body = init!.body as string;
    const port = portRequests[portRequests.length - 1];
    const route = port.responseFormat?.json_schema.name === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name ? 'focused' : 'native';
    captures.push({ label, route, port, body });
    const next = scripts.shift();
    if (!next) throw new Error('synthetic chat script exhausted');
    const context = JSON.parse(port.messages[1].content) as NativeContext;
    return Response.json({ choices: [{ message: { content: JSON.stringify(next(context)) }, finish_reason: 'stop' }] });
  });
  vi.stubGlobal('fetch', fetchMock); // Never forwards requests to a real network implementation.
  const adapter = createOpenAiCompatibleClient({ provider: 'openai', baseUrl: 'https://uc-p0.invalid/v1',
    model: 'gpt-6-luna', apiKey: 'synthetic-no-credential' });
  const client: OpenAiCompatibleClient = { createChatCompletion: async request => {
    portRequests.push(structuredClone(request)); return adapter.createChatCompletion(request);
  } };
  const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(_url).toBe('https://uc-p0.invalid/candidate/chat/completions');
    expect(init?.method).toBe('POST');
    const body = init!.body as string;
    const request = JSON.parse(body).decisionContext.request as CandidateChoiceWireRequest;
    captures.push({ label, route: 'option-choice', port: choiceRequests[choiceRequests.length - 1], body });
    const selected = request.menu.options.find(option => option.kind !== 'none')!;
    return Response.json({ status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
      requestId: request.requestId, selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
      nodeId: request.menu.nodeId, optionId: selected.id, conditionChange: 0, independentMeaning: 0,
      probabilities: request.menu.options.map(option => ({ optionId: option.id, probability: option.id === selected.id ? 1 : 0 })) });
  });
  const choicePort = createWeeklyPlanningVNextOptionChoicePort({ policy: VNEXT_OPTION_CHOICE_POLICY,
    client: { semanticPolicy: VNEXT_OPTION_CHOICE_SEMANTIC_POLICY, proxyUrl: 'https://uc-p0.invalid/candidate',
      getToken: async () => 'synthetic-token', transport } });
  const interpret = createWeeklyPlanningVNextRuntimeInterpreter(scope, { choice: { policy: VNEXT_OPTION_CHOICE_POLICY,
    choose: (request, beforeDispatch, observe) => {
      choiceRequests.push(structuredClone(request)); return choicePort.choose(request, beforeDispatch, observe);
    } }, focusedRequestId: () => 'synthetic-focused-0128' });
  const saveBlock = vi.fn(async () => { throw new Error('unexpected save'); });
  const approvalWrite = vi.fn(() => { throw new Error('unexpected approval write'); });
  const ports: WeeklyPlanningVNextExperimentalPorts = { client, interpret,
    checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
    approvalLedger: { read: () => null, write: approvalWrite },
    plans: { findExistingPlanId: async () => undefined, saveBlock },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    now: () => '2026-11-02T09:00:00.000Z',
    createRenderer: () => ({ render: async input => ({ status: 'rendered',
      text: input.requiredLabels.join(' / ') || '架空の相談を続けられます。', rawResponse: '' }) }),
  };
  async function turn(nextLabel: string, userText: string) {
    label = nextLabel;
    const before = captures.length;
    const graph = local.readCheckpoint()?.vnext.state.graph;
    const activeIds = new Set(graph?.factLifecycles.filter(item => item.status === 'active').map(item => item.factId));
    const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText,
      turnId: `synthetic-turn-${before + 1}`, shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
    expect(captures.length - before).toBe(1);
    const captured = captures[before];
    const wire = JSON.parse(captured.body);
    const context = captured.route === 'option-choice' ? wire.decisionContext.request.context : JSON.parse(wire.messages[1].content);
    if (captured.route !== 'option-choice') {
      const port = captured.port as PortRequest;
      expect(wire.messages).toEqual(port.messages);
      expect(wire.response_format).toEqual(port.responseFormat);
      expect(wire.max_completion_tokens).toBe(port.maxCompletionTokens);
    }
    rows.push({ label, route: captured.route, boundary: captured.route === 'option-choice' ? 'candidate proxy envelope' : 'direct adapter HTTP body',
      portBytes: bytes(captured.port), bodyBytes: new TextEncoder().encode(captured.body).byteLength,
      messagesBytes: bytes(wire.messages), messages: wire.messages.length,
      systemContentBytes: wire.messages.filter((message: { role: string }) => message.role === 'system')
        .reduce((sum: number, message: { content: string }) => sum + new TextEncoder().encode(message.content).byteLength, 0),
      schemaBytes: wire.response_format ? bytes(wire.response_format) : null,
      contextBytes: bytes(context), recentMessages: context.recentConversation?.length ?? null,
      activeGraphFacts: graph?.factLifecycles.filter(item => item.status === 'active').length ?? 0,
      activeGraphFactsWithSource: graph ? [...graph.tasks, ...graph.workloads].filter(fact => activeIds.has(fact.id) && fact.source).length : 0,
      supersededGraphFacts: graph?.factLifecycles.filter(item => item.status === 'superseded').length ?? 0,
      projectedActiveFacts: context.activeFacts ? Object.values(context.activeFacts as NativeContext['activeFacts']).flat().length : null,
      wireMetadataPaths: metadataPaths(wire), portMetadataPaths: metadataPaths(captured.port), contextMetadataPaths: metadataPaths(context),
      calls: 1, clientCalls: captured.route === 'option-choice' ? 0 : 1, candidateCalls: captured.route === 'option-choice' ? 1 : 0 });
    return { result, captured, wire, context };
  }
  function report() {
    expect(scripts).toHaveLength(0);
    expect(saveBlock).not.toHaveBeenCalled(); expect(approvalWrite).not.toHaveBeenCalled();
    console.info('UC_P0_BRANCH_BASELINE', JSON.stringify({ rows, calls: { chat: fetchMock.mock.calls.length,
      candidate: transport.mock.calls.length }, memoryRead: 'not connected', tokenLatency: 'unmeasured' }));
    if (process.env.WEEKLY_PLANNING_UC_P0_RAW_REPORT === '1') console.info('UC_P0_BRANCH_RAW', JSON.stringify(captures));
  }
  const presented = () => {
    const checkpoint = local.readCheckpoint()?.vnext;
    return checkpoint && projectWeeklyPlanningVNext(checkpoint.state).questions.find(question => question.key === checkpoint.presentedQuestion?.questionKey);
  };
  return { turn, report, presented, rows };
}

it('measures the native request after both original and correction utterances leave the window', async () => {
  const h = harness([
    () => reading({ add: [task, workload('w', 'remaining', 60)] }),
    context => reading({ patch: [{ kind: 'workload', localId: 'corrected', targetFactId: context.activeFacts.workloads[0].id,
      amountDelta: null, changes: { amount: 90, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null,
        rangeEnd: null, perOccurrence: null, periodExpression: null } }] }, 'update_plan'),
    () => reading(), () => reading(), () => reading(),
  ]);
  for (const [label, text] of [['original', FIRST], ['correct', CORRECTION], ['filler-a', '架空の相談の続きです。'],
    ['filler-b', '架空の条件を見ています。']]) expect((await h.turn(label, text)).result.outcome).toBe(label === 'original' || label === 'correct' ? 'applied' : 'noop');
  const last = await h.turn('superseded-outside-window', '架空の相談を続けてください。');
  expect(last.result.outcome).toBe('noop');
  expect(last.captured.route).toBe('native');
  expect(last.context.activeFacts.workloads.map((fact: { amount: number }) => fact.amount)).toEqual([90]);
  expect(last.context.recentConversation.map((message: { content: string }) => message.content)).not.toContain(FIRST);
  expect(last.context.recentConversation.map((message: { content: string }) => message.content)).not.toContain(CORRECTION);
  expect(h.rows[4]).toMatchObject({ activeGraphFacts: 2, supersededGraphFacts: 1, projectedActiveFacts: 2, recentMessages: 4 });
  h.report();
});

it('measures a reachable focused answer through the runtime and actual direct adapter', async () => {
  const h = harness([() => reading({ add: [task, workload('pages', 'remaining', 8, 'page')] }),
    () => ({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'total_duration',
      minutes: 40, precision: 'approximate', quantityRole: null })]);
  expect((await h.turn('focused-bootstrap', '架空の白波教材の数学が残り8ページです。')).result.outcome).toBe('applied');
  expect(h.presented()?.code).toBe('missing_effort_estimate');
  const answer = await h.turn('focused-answer', '40分くらいです。');
  expect(answer.result.outcome).toBe('applied');
  expect(answer.captured.route).toBe('focused');
  expect((answer.captured.port as PortRequest).decisionContext?.purpose).toBe('focused_contextual_answer_v2');
  expect(answer.wire).not.toHaveProperty('decisionContext'); // Direct body differs from the proxy binding envelope.
  h.report();
});

it('measures a reachable closed choice through the real candidate client proxy envelope', async () => {
  const h = harness([() => reading({ add: [task, workload('total', 'scope_total', 20, 'page'),
    workload('done', 'completed', 12, 'page'), workload('left', 'remaining', 7, 'page')] })]);
  expect((await h.turn('choice-bootstrap', '架空の白波教材は全部20ページ、12ページ完了、残り7ページです。')).result.outcome).toBe('applied');
  expect(h.presented()?.code).toBe('remaining_inconsistent');
  const answer = await h.turn('choice-answer', '最初の選択肢でお願いします。');
  expect(answer.result.outcome).toBe('applied');
  expect(answer.captured.route).toBe('option-choice');
  expect(answer.wire.decisionContext.purpose).toBe('candidate_choice');
  expect(answer.wire.decisionContext.request).toEqual(answer.captured.port);
  expect(answer.wire).not.toHaveProperty('response_format'); // This envelope has no schema/system; remote evaluation is unmeasured.
  h.report();
});
