import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import capture from '../../../../tests/fixtures/weekly-session-duration-873.json';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, submitWeeklyPlanningControlledTurn } from '../weeklyPlanningTurnController';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { resetWeeklyPlanningDialogueRendererPromptContextsForTest } from '../trace/weeklyPlanningDialogueRendererTrace';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import { getWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningTurnRuntimeGateway } from './weeklyPlanningTurnRuntimeGateway';
import { weeklyPlanningTurnStagingLifecycle } from './weeklyPlanningTurnSideEffects';

const { completion } = vi.hoisted(() => ({ completion: vi.fn<OpenAiCompatibleClient['createChatCompletion']>() }));
vi.mock('../../../lib/aiConfig', () => ({ getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test', apiKey: 'test' }), getAiConfigValidationMessage: () => undefined }));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({ createOpenAiCompatibleClient: () => ({ createChatCompletion: completion }) }));

const OWNER = 'issue873-owner';
const CONVERSATION = 'weekly-conversation-873e4567-e89b-52d3-a456-426614174000';
const WEEK = '2026-10-26';
const NOW = '2026-10-26T07:59:00.000Z';
const SEMANTIC_SCHEMA = 'weekly_planning_semantic_document_v5';
const RENDERER_SCHEMA = 'weekly_planning_stable_v5_dialogue_response';
type ProviderRequest = Parameters<OpenAiCompatibleClient['createChatCompletion']>[0];
interface RendererPrompt {
  actionId: string;
  applicationDecision: { actionKind: string; questionCode: string | null };
}
type ReplyFactory = (prompt: RendererPrompt) => string;
const schema = (request: ProviderRequest) => request.responseFormat?.json_schema?.name;
let storage: ReturnType<typeof createMemoryStorageHarness>;
let restore: () => void;

beforeEach(() => {
  storage = createMemoryStorageHarness();
  restore = installWeeklyPlanningTestStorage(storage.storage);
  completion.mockReset();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
});
afterEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningDialogueRendererPromptContextsForTest();
  restore();
});

async function runTurn(options: { text?: string; precision?: string; renderer?: ReplyFactory; document?: WeeklyPlanningSemanticDocumentV5; userText?: string } = {}) {
  const document = options.document ?? structuredClone(capture.semanticDocument) as WeeklyPlanningSemanticDocumentV5;
  document.tasks[0].effortEstimates[0].precision = (options.precision ?? 'exact') as 'exact' | 'approximate';
  const text = options.text ?? capture.replies[0].acknowledgement;
  completion.mockImplementation(async request => {
    if (schema(request) === SEMANTIC_SCHEMA) return JSON.stringify(document);
    if (schema(request) !== RENDERER_SCHEMA) throw new Error(`Unexpected provider schema: ${schema(request)}`);
    const prompt = JSON.parse(request.messages[1].content);
    return options.renderer?.(prompt) ?? JSON.stringify({ actionId: prompt.actionId,
      actionKind: prompt.applicationDecision.actionKind, questionCode: prompt.applicationDecision.questionCode,
      groundingAcknowledgement: null, text });
  });
  let state = createInitialPlanningState(WEEK);
  let result: WeeklyPlanningTurnExecutionResult | undefined;
  const submission = await submitWeeklyPlanningControlledTurn({
    session: createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION), ownerId: OWNER,
    userText: options.userText ?? capture.userText, now: () => NOW, getState: () => state,
    dispatch: action => (state = weeklyPlanningReducer(state, action)),
    prepareExecutionCommit: ({ pending }) => weeklyPlanningTurnStagingLifecycle.prepare({ ownerId: OWNER, pending }),
    discardExecutionResult: ({ pending }) => weeklyPlanningTurnStagingLifecycle.discard(pending),
    execute: async params => {
      result = await weeklyPlanningTurnRuntimeGateway.execute({ ...params, selectedDate: WEEK, userId: OWNER,
        plans: [], studyMaterials: [], scheduleTemplates: [], timeZone: 'Asia/Tokyo' });
      return result;
    },
  });
  expect(result).toBeDefined();
  return { state, result: result!, submission, graph: getWeeklyPlanningStableV5RuntimeSession(CONVERSATION)!.graph };
}

function expectUnapprovedSession(run: Awaited<ReturnType<typeof runTurn>>) {
  expect(run.submission.accepted).toBe(true);
  expect(run.result.failure).toBeUndefined();
  expect(run.state.pendingTurn).toBeUndefined();
  expect(run.state.previewCandidates).toHaveLength(1);
  expect(run.result.draftCandidates).toEqual(run.state.previewCandidates);
  expect(run.state.previewCandidates![0]).toMatchObject({ title: '英語の勉強 60分', date: '2026-10-27',
    startTime: '09:00', endTime: '10:00', durationMinutes: 60, approvalStatus: 'unapproved' });
  expect(run.graph.tasks).toHaveLength(1);
  expect(run.graph.tasks[0].title).toBe('英語の勉強');
  expect(run.graph.workloads).toHaveLength(1);
  expect(run.graph.workloads[0]).toMatchObject({ taskId: run.graph.tasks[0].id, amount: 60, unitCode: 'minute', quantityRole: 'target' });
  expect(run.graph.effortEstimates).toHaveLength(1);
  expect(run.graph.effortEstimates[0]).toMatchObject({ taskId: run.graph.tasks[0].id,
    targetFactId: run.graph.workloads[0].id, kind: 'session_duration', minutes: 60 });
  expect(run.result.stableV5Graph).toEqual(run.graph);
  expect(run.state.draftBlocks).toEqual([]);
  expect(run.state.pendingApproval).toBeUndefined();
  expect(run.state.approvalRecovery).toBeUndefined();
  for (const key of ['studyplanner.scheduleEvents.v1', 'studyplanner.plans']) {
    expect(JSON.parse(storage.storage.getItem(key) ?? '[]')).toEqual([]);
  }
}

describe('Issue #873: real semantic → scheduling → renderer → controller pipeline', () => {
  it.each(capture.replies)('keeps one unsaved 60-minute candidate and exactly one model reply: $name', async reply => {
    const run = await runTurn({ text: reply.acknowledgement, precision: reply.precision });
    expectUnapprovedSession(run);
    expect(run.graph.effortEstimates[0].precision).toBe(reply.precision);
    expect(run.result.responseSource).toBe('ai');
    expect(run.state.messages.filter(message => message.role === 'assistant').map(message => message.content)).toEqual([reply.acknowledgement]);
    expect(completion.mock.calls.filter(([request]) => schema(request) === SEMANTIC_SCHEMA)).toHaveLength(1);
    expect(completion.mock.calls.filter(([request]) => schema(request) === RENDERER_SCHEMA)).toHaveLength(1);
  });

  it.each(['英語の勉強は明日90分ですね。', '数学の勉強は明日、連続で1時間ですね。'])('does not let misleading prose change task, effort, candidate or approval: %s', async text => {
    const run = await runTurn({ text });
    expectUnapprovedSession(run);
    expect(run.result.responseSource).toBe('ai');
    expect(run.state.messages[run.state.messages.length - 1]?.content).toBe(text);
  });

  it.each([
    { name: 'invalid JSON', renderer: () => '{invalid', reason: 'invalid_json' },
    { name: 'action identity mismatch', renderer: (prompt: RendererPrompt) => JSON.stringify({
      actionId: 'other-action', actionKind: prompt.applicationDecision.actionKind,
      questionCode: prompt.applicationDecision.questionCode, text: capture.replies[0].acknowledgement,
    }), reason: 'action_mismatch' },
    { name: 'action kind mismatch', renderer: (prompt: RendererPrompt) => JSON.stringify({
      actionId: prompt.actionId, actionKind: 'status', questionCode: prompt.applicationDecision.questionCode,
      text: capture.replies[0].acknowledgement,
    }), reason: 'action_contract_mismatch' },
    { name: 'false save-completed claim', renderer: (prompt: RendererPrompt) => JSON.stringify({
      actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
      questionCode: prompt.applicationDecision.questionCode, text: '保存しました。',
    }), reason: 'ungrounded_text' },
  ])('preserves the accepted unapproved preview and no save after $name', async ({ renderer, reason }) => {
    const run = await runTurn({ renderer });
    expectUnapprovedSession(run);
    expect(run.result.responseSource).toBe('deterministic_fallback');
    expect(run.result.dialogueRendererTrace?.response).toMatchObject({ status: 'fallback', reason });
    expect(run.state.messages.filter(message => message.role === 'assistant')).toHaveLength(1);
    expect(run.state.messages[run.state.messages.length - 1]?.content).toContain('まだ保存していません');
    // Only repeated-question/legacy-grounding failures permit a renderer repair.
    expect(completion.mock.calls.filter(([request]) => schema(request) === RENDERER_SCHEMA)).toHaveLength(1);
  });

  it('rejects an invalid typed session duration before any preview or save', async () => {
    const document = structuredClone(capture.semanticDocument) as WeeklyPlanningSemanticDocumentV5;
    document.tasks[0].effortEstimates[0].minutes = 0;
    const run = await runTurn({ document });
    expect(run.result.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(run.state.previewCandidates ?? []).toEqual([]);
    expect(run.graph.effortEstimates).toEqual([]);
    expect(run.state.draftBlocks).toEqual([]);
    expect(storage.storage.getItem('studyplanner.scheduleEvents.v1')).toBeNull();
    expect(completion.mock.calls.filter(([request]) => schema(request) === SEMANTIC_SCHEMA)).toHaveLength(2);
    expect(completion.mock.calls.filter(([request]) => schema(request) === RENDERER_SCHEMA)).toHaveLength(0);
  });

  it.each([
    { kind: 'total_duration', minutes: 45, unitCode: null, wording: '残りの合計45分' },
    { kind: 'duration_per_unit', minutes: 15, unitCode: 'problem', wording: '1問15分' },
    { kind: 'session_duration', minutes: 60, unitCode: null, wording: '1回60分' },
  ] as const)('keeps $kind bound to remaining work without conflating measurement roles', async estimate => {
    const document = structuredClone(capture.semanticDocument) as WeeklyPlanningSemanticDocumentV5;
    const userText = `明日、英語の残り3問について相談したい。${estimate.wording}です。`;
    document.planningIntent = 'discuss';
    const task = document.tasks[0];
    task.sourceText = userText;
    task.workloads[0] = { ...task.workloads[0], quantityRole: 'remaining', amount: 3, unitCode: 'problem', unitLabel: '問', sourceText: userText };
    task.effortEstimates[0] = { ...task.effortEstimates[0], kind: estimate.kind,
      minutes: estimate.minutes, unitCode: estimate.unitCode, sourceText: userText };
    const run = await runTurn({ document, userText, text: '相談を続けられます。' });
    expect(run.submission.accepted).toBe(true);
    expect(run.result.failure).toBeUndefined();
    expect(run.graph.workloads).toHaveLength(1);
    expect(run.graph.workloads[0]).toMatchObject({ quantityRole: 'remaining', amount: 3, unitCode: 'problem' });
    expect(run.graph.effortEstimates).toHaveLength(1);
    expect(run.graph.effortEstimates[0]).toMatchObject({ kind: estimate.kind, minutes: estimate.minutes,
      unitCode: estimate.unitCode, targetFactId: run.graph.workloads[0].id });
    expect(run.state.previewCandidates ?? []).toEqual([]);
    expect(storage.storage.getItem('studyplanner.scheduleEvents.v1')).toBeNull();
  });
});
