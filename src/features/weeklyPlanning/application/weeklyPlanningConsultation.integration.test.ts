import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { createPresentedWeeklyPlanningConversation } from '../testUtils/__tests__/weeklyPlanningPresentedConversation';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { resetWeeklyPlanningStableV5DebugTraceForTest, readWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import * as rendererTraceOwner from '../trace/weeklyPlanningDialogueRendererTrace';
import { recordCommittedWeeklyPlanningApplicationTurn } from './weeklyPlanningTurnTraceSideEffects';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession, WeeklyPlanningTraceEntry } from '../trace/weeklyPlanningTraceTypes';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';

const { normalizeMock, rendererClient } = vi.hoisted(() => ({
  normalizeMock: vi.fn(), rendererClient: vi.fn<OpenAiCompatibleClient['createChatCompletion']>(),
}));
vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test', apiKey: 'test' }),
  getAiConfigValidationMessage: () => undefined,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({
  createOpenAiCompatibleClient: () => ({ createChatCompletion: rendererClient }),
}));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }),
}));

const OWNER = 'owner-consultation';
const CONVERSATION = 'weekly-conversation-923e4567-e89b-52d3-a456-426614174020';
const START = '10月12日から18日に、部屋の掃除を180分する予定を作って';
const CONSULT = '土日にまとめても大丈夫？';
const requestContext = { startedAtIso: '2026-10-07T00:00:00.000Z', timeZone: 'Asia/Tokyo',
  currentDate: '2026-10-07', currentTime: '09:00', notBeforeDate: '2026-10-07', notBeforeTime: '09:00', weekStartsOn: 'monday' as const };
let conversation: ReturnType<typeof createPresentedWeeklyPlanningConversation>;
let restoreStorage: () => void;
let rendererFault: 'feasibility' | 'promotion' | 'provider' | null;
let faultUsed: boolean;

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    conversationActs: [], uncertainties: [], corrections: [], decisions: [] };
}
function planDocument(): WeeklyPlanningSemanticDocumentV5 {
  return { ...emptyDocument(), planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-10-12/2026-10-18',
      start: '2026-10-12', end: '2026-10-18', sourceText: START },
    tasks: [{ localId: 'task', category: 'non_study', title: '部屋の掃除', study: null,
      decompositionStatus: 'atomic',
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 180, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: START }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: START }],
  };
}
function consultationDocument(target: string, alternative: unknown = undefined): Record<string, unknown> {
  return { ...emptyDocument(), conversationActs: [{ kind: 'consultation_request', targetPublicId: target,
    ...(alternative !== undefined ? { placementAlternative: alternative } : {}) }] };
}
const weekend = () => ({ scope: 'task', dateExpressions: ['weekday:saturday', 'weekday:sunday'], sourceText: CONSULT });

async function run(raw: Record<string, unknown> | WeeklyPlanningSemanticDocumentV5, userText: string) {
  const actual = await vi.importActual<typeof import('../semantic/weeklyPlanningSemanticNormalizerV5')>('../semantic/weeklyPlanningSemanticNormalizerV5');
  const client = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async request => {
    const schema = request.responseFormat?.json_schema.name;
    if (schema === 'weekly_planning_focused_authorization_v5') return JSON.stringify({ decision: 'fallback' });
    if (schema === 'weekly_planning_focused_task_temporal_side_contribution_v5') return JSON.stringify({
      decision: 'fallback', kind: null, constraintLevel: null, dateExpression: null,
      namedTimePeriod: null, startTime: null, endTime: null, precision: null,
    });
    expect(schema).toBe('weekly_planning_semantic_document_v5');
    return JSON.stringify(raw);
  });
  const normalizer = actual.createWeeklyPlanningSemanticNormalizerV5({ createChatCompletion: client });
  const index = normalizeMock.mock.calls.length;
  normalizeMock.mockImplementationOnce((input: WeeklyPlanningSemanticNormalizerInputV5) => normalizer.normalize(input));
  const result = await conversation.run({ userText, selectedDate: '2026-10-12', userId: OWNER,
    plans: [], scheduleTemplates: [], conversationId: CONVERSATION, traceRequestId: `consultation-${index}`,
    messages: [], requestContext });
  const reading = await normalizeMock.mock.results[index].value;
  expect(reading.status, JSON.stringify(reading.diagnostics)).toBe('accepted');
  expect(result.failure).toBeUndefined();
  return { result, client, requestId: normalizeMock.mock.calls[index][0].traceRequestId as string };
}
async function initialPlan() {
  const first = await run(planDocument(), START);
  expect(first.result.draftCandidates.length).toBeGreaterThan(0);
  return { ...first, taskId: first.result.stableV5Graph!.tasks[0].id,
    graph: structuredClone(first.result.stableV5Graph!), preview: structuredClone(conversation.getState().previewCandidates) };
}
function expectUnchanged(before: Awaited<ReturnType<typeof initialPlan>>, result: Awaited<ReturnType<typeof run>>['result']) {
  expect(result.stableV5Graph).toEqual({ ...before.graph, appliedTurnKeys: result.stableV5Graph!.appliedTurnKeys });
  expect(conversation.getState().previewCandidates).toEqual(before.preview);
  expect(result.draftCandidates).toEqual([]);
  expect(result.state.shouldSavePlan).toBe(false);
  expect(conversation.getState().pendingApproval).toBeUndefined();
}

beforeEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); normalizeMock.mockReset(); rendererClient.mockReset();
  conversation = createPresentedWeeklyPlanningConversation();
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  rendererFault = null; faultUsed = false;
  rendererClient.mockImplementation(async request => {
    if (rendererFault === 'provider') throw new Error('injected provider failure');
    const body = JSON.parse(request.messages[1].content);
    const decision = body.applicationDecision;
    const consultation = decision.communication?.consultation;
    const invalid = rendererFault && !faultUsed && consultation;
    if (invalid) faultUsed = true;
    const claim = invalid && rendererFault === 'feasibility' ? 'does_not_fit'
      : consultation?.feasibility.status === 'not_evaluated' ? 'none' : consultation?.feasibility.status;
    const ack = body.currentTurnGrounding.mode === 'required_before_resume'
      ? { factIds: body.currentTurnGrounding.acceptedFacts.map((fact: { factId: string }) => fact.factId), text: '変更を受け取りました。' } : null;
    const text = consultation
      ? invalid && rendererFault === 'promotion' ? '「この内容で仮予定にする」を押してください。'
        : claim === 'fits' ? consultation.assessmentScope === 'proposed_days'
          ? '10月17日と10月18日なら、受理済みの条件では収まりそうです。この日程に変更しますか？'
          : `受理済みの条件では収まりそうです。${decision.previewPromotionControlLabel ? `「${decision.previewPromotionControlLabel}」で候補を確認できます。` : ''}`
        : claim === 'does_not_fit' ? 'この条件では収まりません。使う日を増やしますか？'
        : 'まだ評価していません。条件を確認してから考えましょう。'
      : decision.previewPromotionControlLabel ? `候補を確認して「${decision.previewPromotionControlLabel}」を押してください。`
      : '必要な内容を教えてください。';
    return JSON.stringify({ actionId: body.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
      groundingAcknowledgement: ack, text: (ack?.text ?? '') + text,
      ...(consultation ? { feasibilityClaim: claim } : {}) });
  });
});
afterEach(() => { setWeeklyPlanningTraceRepositoryForTests(undefined); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restoreStorage(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('bounded consultation through the current semantic/controller/renderer owners', () => {
  it('does not borrow feasibility from a retained preview for a proposal-free consultation', async () => {
    const before = await initialPlan();
    const { result } = await run(consultationDocument(before.taskId), 'この進め方で大丈夫？');
    expect(result.consultation).toMatchObject({ assessmentScope: 'accepted_plan_only',
      feasibility: { status: 'not_evaluated', reason: 'existing_preview_not_rechecked' } });
    expect(result.interactionOutcome?.kind).toBe('aside'); expectUnchanged(before, result);
  });
  it('evaluates proposed days without adopting them, then accepts only an explicit normal planning change', async () => {
    const before = await initialPlan();
    const queried = await run(consultationDocument(before.taskId, weekend()), CONSULT);
    expect(queried.result.responseSource, JSON.stringify(queried.result.dialogueRendererTrace)).toBe('ai');
    expect(queried.result.consultation).toMatchObject({ assessmentScope: 'proposed_days',
      alternative: { dates: ['2026-10-17', '2026-10-18'], taskIds: [before.taskId] },
      feasibility: { status: 'fits', basis: 'alternative_scheduler' } });
    expectUnchanged(before, queried.result);
    const sent = JSON.parse(rendererClient.mock.calls[rendererClient.mock.calls.length - 1][0].messages[1].content).applicationDecision;
    expect(sent.previewPromotionControlLabel).toBeNull();
    expect(sent.communication.alternativeRequiresAdoption).toBe(true);
    const text = '掃除は10月17日以降、10月18日までに進める予定へ変更して';
    const task = planDocument().tasks[0];
    const adopted = await run({ ...emptyDocument(), planningIntent: 'update_plan', tasks: [{
      ...task, existingPublicId: before.taskId, workloads: [], sourceText: text,
      temporalConstraints: [
        { localId: 'from', targetLocalId: task.localId, kind: 'earliest_start', constraintLevel: 'hard',
          dateExpression: '2026-10-17', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: text },
        { localId: 'until', targetLocalId: task.localId, kind: 'latest_end', constraintLevel: 'hard',
          dateExpression: '2026-10-18', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: text },
      ],
    }] }, text);
    expect(adopted.result.consultation).toBeUndefined();
    expect(adopted.result.draftCandidates.length).toBeGreaterThan(0);
    expect(adopted.result.draftCandidates.every(candidate => ['2026-10-17', '2026-10-18'].includes(candidate.date))).toBe(true);
    expect(conversation.getState().previewCandidates).not.toEqual(before.preview);
    expect(adopted.result.state.shouldSavePlan).toBe(false);
    expect(conversation.getState().pendingApproval).toBeUndefined();
  });
  it('uses this turn scheduler evidence when an independently authorized plan is created beside a consultation', async () => {
    const doc = planDocument(); doc.conversationActs = [{ kind: 'consultation_request', targetPublicId: null }];
    const { result } = await run(doc, START + '。この進め方で大丈夫？');
    expect(result.consultation).toMatchObject({ assessmentScope: 'accepted_plan_only',
      feasibility: { status: 'fits', basis: 'current_turn_scheduler' } });
    expect(result.draftCandidates.length).toBeGreaterThan(0);
    expect(result.interactionOutcome?.kind).toBe('apply'); expect(result.responseSource).toBe('ai');
    expect(result.state.shouldSavePlan).toBe(false);
  });
  it('applies an independent work delta while the proposed days stay hypothetical', async () => {
    const before = await initialPlan();
    const text = CONSULT + '。書類整理も60分追加して';
    const raw = consultationDocument(before.taskId, weekend());
    raw.planningIntent = 'update_plan';
    raw.tasks = [{ ...planDocument().tasks[0], localId: 'other', title: '書類整理', sourceText: '書類整理も60分追加して',
      workloads: [{ ...planDocument().tasks[0].workloads[0], localId: 'other-work', amount: 60, sourceText: '書類整理も60分追加して' }] }];
    const { result } = await run(raw, text);
    expect(result.stableV5Graph!.tasks.some(task => task.title === '書類整理')).toBe(true);
    expect(result.stableV5Graph!.temporalConstraints).toEqual(before.graph.temporalConstraints);
    expect(result.draftCandidates.length).toBeGreaterThan(0);
    expect(result.consultation?.assessmentScope).toBe('proposed_days');
    expect(result.interactionOutcome?.kind).toBe('apply'); expect(result.state.shouldSavePlan).toBe(false);
  });
  it.each(['malformed', 'unknown', 'unquoted', 'outside', 'multiple'] as const)('keeps %s alternatives unevaluated and preserves the current preview', async fault => {
    const before = await initialPlan();
    const proposal = weekend();
    if (fault === 'malformed') proposal.dateExpressions = ['土日'];
    if (fault === 'unquoted') proposal.sourceText = '前の発言';
    if (fault === 'outside') proposal.dateExpressions = ['2026-10-24'];
    const raw = consultationDocument(fault === 'unknown' ? 'unknown-task' : before.taskId, proposal);
    if (fault === 'multiple') raw.conversationActs = [...raw.conversationActs as unknown[], ...raw.conversationActs as unknown[]];
    const { result } = await run(raw, CONSULT);
    expect(result.consultation?.feasibility.status).toBe('not_evaluated');
    expect(result.responseSource).toBe('ai'); expectUnchanged(before, result);
  });
  it.each(['feasibility', 'promotion'] as const)('repairs contradictory %s once within the existing renderer ceiling', async fault => {
    const before = await initialPlan(); rendererClient.mockClear(); rendererFault = fault;
    const remembered = vi.spyOn(rendererTraceOwner, 'rememberWeeklyPlanningDialogueRendererPromptContext');
    const { result } = await run(consultationDocument(before.taskId, weekend()), CONSULT);
    expect(rendererClient).toHaveBeenCalledTimes(2);
    expect(result.responseSource).toBe('ai'); expectUnchanged(before, result);
    const context = remembered.mock.calls.find(([actionId]) => actionId === result.dialogueRendererTrace!.actionId)?.[1];
    expect(context).toHaveProperty('consultationRepair.messages', rendererClient.mock.calls[1][0].messages);
  });
  it('keeps an unresolved machine question without treating a consultation as its answer', async () => {
    const document = planDocument(); document.tasks[0].workloads = [];
    const first = await run(document, START); const question = structuredClone(first.result.state.lastQuestionContext);
    expect(question).toBeDefined();
    const { result } = await run(consultationDocument(first.result.stableV5Graph!.tasks[0].id, weekend()), CONSULT);
    expect(result.consultation?.feasibility.status).toBe('not_evaluated');
    expect(result.state.lastQuestionContext).toMatchObject({ targetSlot: question!.targetSlot, topicId: question!.topicId });
    expect(result.interactionOutcome?.kind).toBe('aside'); expect(result.questionPresentationContent).toBeUndefined();
    expect(result.draftCandidates).toEqual([]);
  });
});

it.each([false, true])('persists actual semantic and consultation/repair requests through outbox/retry/Worker (large=%s)', async large => {
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
  const before = await initialPlan(); rendererClient.mockClear(); rendererFault = 'feasibility';
  const remembered = vi.spyOn(rendererTraceOwner, 'rememberWeeklyPlanningDialogueRendererPromptContext');
  const turn = await run(consultationDocument(before.taskId, weekend()), CONSULT);
  const events = readWeeklyPlanningStableV5DebugTrace(turn.requestId);
  const generic = turn.client.mock.calls.find(([request]) => request.responseFormat?.json_schema.name === 'weekly_planning_semantic_document_v5')![0];
  const semanticEvent = events.find(event => event.stage === 'semantic_provider_request' && JSON.stringify(event.data).includes('placementAlternative'));
  expect(semanticEvent).toBeDefined();
  const actualMessages = (semanticEvent!.data as { request: { messages: unknown[] } }).request.messages;
  expect(actualMessages[actualMessages.length - 1]).toEqual(generic.messages[generic.messages.length - 1]);
  const trace = structuredClone(turn.result.dialogueRendererTrace!);
  const context = remembered.mock.calls.find(([actionId]) => actionId === trace.actionId)?.[1] as Record<string, unknown>;
  expect(context).toBeDefined();
  expect(context.messages).toEqual(rendererClient.mock.calls[0][0].messages);
  expect(context).toHaveProperty('consultationRepair.messages', rendererClient.mock.calls[1][0].messages);
  trace.request!.promptContext = { futureConsultationSentinel: 'consultation-field-retained', ...context,
    ...(large ? { largeConsultationValue: 'hypothesis-evidence'.repeat(30_000) } : {}) };
  type Write = { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] };
  const writes: Write[] = []; let fail = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {}, async appendEntries(write) { if (fail) { fail = false; throw new Error('append failure'); } writes.push(structuredClone(write)); },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {},
    async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  const input = { userId: OWNER, conversationId: CONVERSATION, requestId: turn.requestId, userText: CONSULT,
    assistantMessage: turn.result.message, responseSource: turn.result.responseSource, outcome: turn.result.state.status,
    previewCount: 0, debugTraceEvents: events, dialogueRendererTrace: trace };
  await recordCommittedWeeklyPlanningApplicationTurn({ ownerId: OWNER,
    pending: { requestId: turn.requestId, conversationId: CONVERSATION, turnId: 'consultation-turn',
      weekStartDate: '2026-10-12', baseRevision: 1, startedAt: requestContext.startedAtIso },
    userText: CONSULT, result: { ...turn.result, dialogueRendererTrace: trace },
  });
  expect(writes).toHaveLength(0); expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${turn.requestId}:retry-trigger`, dialogueRendererTrace: undefined, debugTraceEvents: [] });
  expect(writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
  const stored = writes[0]; const json = JSON.stringify(stored.entries[0]);
  expect(json).toContain('futureConsultationSentinel');
  if (large) expect(json).toContain('traceTruncated');
  else { expect(json).toContain('alternative_scheduler'); expect(json).toContain('proposed_days'); expect(json).toContain('placementAlternative'); }
  expect(measureWeeklyPlanningTraceJsonBytes(stored.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  const prepared = prepareWeeklyPlanningTraceServerWrite({ session: stored.session as unknown as Record<string, unknown>,
    entries: stored.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '100' }, {
    sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION,
  }, '2026-10-11T19:00:00.000Z');
  expect(prepared.entries).toHaveLength(1); expect(JSON.stringify(prepared.entries[0])).toContain('futureConsultationSentinel');
  if (!large) expect(JSON.stringify(prepared.entries[0])).toContain('alternative_scheduler');
  expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
});
