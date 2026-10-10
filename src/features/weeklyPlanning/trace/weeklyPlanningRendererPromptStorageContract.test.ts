import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { renderWeeklyPlanningStableV5AssistantMessage } from '../dialogue/weeklyPlanningStableV5TurnDialogue';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  boundWeeklyPlanningDialogueRendererTraceForTransport,
  resetWeeklyPlanningDialogueRendererPromptContextsForTest,
  type WeeklyPlanningDialogueRendererTrace,
} from './weeklyPlanningDialogueRendererTrace';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const completion = vi.hoisted(() => vi.fn<OpenAiCompatibleClient['createChatCompletion']>());
vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test', apiKey: 'test-key' }),
  getAiConfigValidationMessage: () => undefined,
  usesCloudflareOpenAiProxy: () => false,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', async importOriginal => ({
  ...await importOriginal<typeof import('../../../services/ai/openAiCompatibleClient')>(),
  createOpenAiCompatibleClient: () => ({ createChatCompletion: completion }),
}));

const FUTURE_FIELD_SENTINEL = 'renderer-prompt-field-added-after-trace-contract';

function createRepositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  let failuresRemaining = 0;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('injected trace transport failure');
      }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return {
    repository,
    writes,
    failNext(count = 1) {
      failuresRemaining = count;
    },
  };
}

function rendererTrace(promptContext: unknown): WeeklyPlanningDialogueRendererTrace {
  return {
    actionId: 'stable-v5:storage-contract:quantity_role_unresolved',
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    request: {
      purpose: 'weekly_planning_renderer',
      requiredLabels: ['院試', '第2分野'],
      fallbackText: '第2分野の3時間は、今回進める量ですか、それとも残っている全体量ですか？',
      previewCount: 0,
      promptContext,
    },
    response: {
      status: 'rendered',
      reason: null,
      rawResponse: '{"actionId":"stable-v5:storage-contract:quantity_role_unresolved","text":"確認しています。"}',
      renderedText: '確認しています。',
    },
    decision: {
      branch: 'ai_rendered',
      responseSource: 'ai',
      finalMessage: '確認しています。',
    },
  };
}

function traceInput(requestId: string, promptContext: unknown) {
  return {
    userId: 'owner-1',
    conversationId: 'conversation-1',
    requestId,
    userText: 'どういうこと？',
    assistantMessage: '確認しています。',
    responseSource: 'ai' as const,
    dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport(
      rendererTrace(promptContext),
    ),
    outcome: 'revision_pending',
    previewCount: 0,
    debugTraceEvents: [],
  };
}

function promptContextFromEntry(entry: WeeklyPlanningTraceEntry): unknown {
  if (entry.kind !== 'turn_diagnostic') throw new Error('expected turn diagnostic');
  const diagnostics = entry.diagnostics as Record<string, unknown>;
  const renderer = diagnostics.dialogueRenderer as Record<string, unknown>;
  const request = renderer.request as Record<string, unknown>;
  return request.promptContext;
}

let restoreStorage: (() => void) | undefined;

describe('renderer prompt trace storage contract', () => {
  beforeEach(() => {
    restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
    completion.mockReset();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
    completion.mockReset();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    restoreStorage?.();
    restoreStorage = undefined;
  });

  it('preserves newly added prompt fields while keeping the client document bounded', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput('conversation-1:request:1', {
      messages: [
        { role: 'system', content: '返答を考えてください。' },
        { role: 'user', content: '{"currentUserMessage":"どういうこと？"}' },
      ],
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    }));

    expect(harness.writes).toHaveLength(1);
    const entry = harness.writes[0].entries[0];
    expect(promptContextFromEntry(entry)).toMatchObject({
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
  });

  it('keeps prompt context in the persistent outbox and restores it on retry', async () => {
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const firstInput = traceInput('conversation-1:request:1', {
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });

    await recordWeeklyPlanningStableV5TurnTrace(firstInput);
    const pending = listWeeklyPlanningTraceOutboxItems({
      userId: firstInput.userId,
      conversationId: firstInput.conversationId,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].input.dialogueRendererTrace?.request?.promptContext).toMatchObject({
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(traceInput(
      'conversation-1:request:2',
      { secondRequest: true },
    ));

    expect(harness.writes).toHaveLength(2);
    const replayed = harness.writes[0].entries[0];
    expect(replayed.requestId).toBe(firstInput.requestId);
    expect(promptContextFromEntry(replayed)).toMatchObject({
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: firstInput.userId,
      conversationId: firstInput.conversationId,
    })).toEqual([]);
  });

  it('compacts oversized future fields instead of making the whole turn unsavable', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput(
      'conversation-1:request:oversized',
      {
        futurePromptFieldAddedWithoutTraceSchemaChange: 'large-field-segment-'.repeat(8_000),
        tailSentinel: 'end-of-future-field',
      },
    ));

    expect(harness.writes).toHaveLength(1);
    const entry = harness.writes[0].entries[0];
    expect(promptContextFromEntry(entry)).toMatchObject({
      traceTruncated: true,
      originalBytes: expect.any(Number),
      jsonHead: expect.any(String),
      jsonTail: expect.any(String),
    });
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
  });
});

// The routing suite owns the real compiler/scheduler producer oracle. These rows
// isolate that output's actual renderer request and the durable diagnostic boundary.
async function actualPreviewTrace() {
  const conversationId = 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000';
  const requestId = `${conversationId}:request:1`;
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 1;
  graph.tasks = [{ id: 'task', category: 'study', title: '数学', createdRevision: 1,
    source: { conversationId, turnId: requestId, semanticLocalId: 'task', sourceText: 'synthetic', origin: 'user' } }];
  graph.factLifecycles = [{ factId: 'task', status: 'active', createdRevision: 1,
    terminalRevision: null, supersededByFactId: null }];
  completion.mockReset().mockImplementation(async request => {
    const payload = JSON.parse(request.messages[1].content);
    return JSON.stringify({ actionId: payload.actionId, actionKind: 'preview_ready', questionCode: null,
      groundingAcknowledgement: null, text: '候補を確認して、「この内容で仮予定にする」を選択してください。' });
  });
  const candidate = { stableKey: 'candidate', date: '2026-08-24', startTime: '09:00', endTime: '10:10',
    durationMinutes: 70, estimatedMinutes: 70, title: '数学', field: '数学', year: 2026,
    source: 'weekly_exam_prep' as const, approvalStatus: 'unapproved' as const, workItemKey: 'work',
    stableV5Metadata: { runtime: 'stable_v5' as const, conversationId, graphRevision: 1, taskId: 'task',
      sourceFactRefs: ['task'], planType: 'study' as const } };
  const result = await renderWeeklyPlanningStableV5AssistantMessage({
    input: { messages: [], userText: '候補を確認します。', selectedDate: '2026-08-19', userId: 'owner-1',
      plans: [], scheduleTemplates: [], conversationId, traceRequestId: requestId },
    result: { state: { ...createInitialPlanningIntakeState(), status: 'draft_ready' },
      message: '候補を確認してください。', stableV5Graph: graph, draftCandidates: [candidate] },
  });
  expect(completion).toHaveBeenCalledTimes(1);
  expect(result.responseSource).toBe('ai');
  const messages = completion.mock.calls[0][0].messages;
  const payload = JSON.parse(messages[1].content);
  // Independent numeric oracle before durable equality checks. Baseline should fail here.
  expect(payload.applicationDecision.previewEvidence).toMatchObject({ status: 'available', graphRevision: 1,
    constraintEvaluation: 'not_evaluated', summary: { candidateCount: 1, totalDurationMinutes: 70,
      minDurationMinutes: 70, maxDurationMinutes: 70, earliestStartTime: '09:00', latestEndTime: '10:10' } });
  const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(result.dialogueRendererTrace!);
  const context = trace.request!.promptContext as { messages: typeof messages; requestBytes: number };
  expect(context.messages).toEqual(messages);
  return { userId: 'owner-1', conversationId, requestId, userText: '候補を確認します。',
    assistantMessage: result.message, responseSource: result.responseSource!, dialogueRendererTrace: trace,
    outcome: 'preview_ready', previewCount: 1, debugTraceEvents: [], messages, context };
}

describe('actual preview evidence renderer request persistence', () => {
  beforeEach(() => {
    restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
    completion.mockReset();
  });
  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
    completion.mockReset();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    restoreStorage?.(); restoreStorage = undefined;
  });

  it.each([false, true])('retains the actual sent observations through outbox and Worker, oversized=%s', async oversized => {
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const actual = await actualPreviewTrace();
    const { messages, context, ...first } = actual;
    const promptContext = { ...context, futurePreviewEvidenceSentinel: FUTURE_FIELD_SENTINEL,
      ...(oversized ? { oversizedFutureEvidence: 'あ'.repeat(80_000) } : {}) };
    first.dialogueRendererTrace.request!.promptContext = promptContext;
    // Bound the deliberately injected future diagnostic field before durable enqueue,
    // exactly as normal trace transport does; do not overflow the outbox with raw240KiB.
    first.dialogueRendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(first.dialogueRendererTrace);
    await recordWeeklyPlanningStableV5TurnTrace(first);
    expect(harness.writes).toHaveLength(0);
    const pending = listWeeklyPlanningTraceOutboxItems({ userId: first.userId, conversationId: first.conversationId });
    expect(pending).toHaveLength(1);
    if (!oversized) expect(pending[0].input.dialogueRendererTrace?.request?.promptContext).toMatchObject({
      messages, futurePreviewEvidenceSentinel: FUTURE_FIELD_SENTINEL,
    });
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...first, requestId: `${first.conversationId}:request:2`,
      dialogueRendererTrace: undefined });
    expect(harness.writes).toHaveLength(2);
    const replayed = harness.writes[0];
    expect(replayed.entries[0].requestId).toBe(first.requestId);
    const persisted = promptContextFromEntry(replayed.entries[0]);
    if (oversized) expect(persisted).toMatchObject({ traceTruncated: true, originalBytes: expect.any(Number) });
    else expect(persisted).toEqual(promptContext);
    expect(measureWeeklyPlanningTraceJsonBytes(replayed.entries[0]))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: first.userId, conversationId: first.conversationId })).toEqual([]);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: replayed.session as unknown as Record<string, unknown>,
      entries: replayed.entries as unknown as Record<string, unknown>[] },
      { token: `wpt_${'d'.repeat(43)}`, epoch: '103' },
      { sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000', logicalConversationId: first.conversationId },
      '2026-10-10T10:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0]))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    const preparedText = JSON.stringify(prepared.entries[0]);
    if (oversized) {
      expect(preparedText).toContain('traceTruncated');
      expect(preparedText).not.toContain('あ'.repeat(80_000));
    } else {
      const workerContext = ((prepared.entries[0].diagnostics as Record<string, unknown>)
        .dialogueRenderer as WeeklyPlanningDialogueRendererTrace).request?.promptContext;
      expect(workerContext).toEqual(promptContext);
    }
  });
});
