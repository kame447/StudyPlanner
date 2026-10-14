import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import { executeIsolatedWeeklyPlanningTurn } from '../application/weeklyPlanningIsolatedTurn';
import { durableReceipt } from '../application/weeklyPlanningDurableTurn.testUtils';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { boundWeeklyPlanningDialogueRendererTraceForTransport } from '../trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from '../trace/weeklyPlanningTraceTypes';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS as LIMITS } from '../../../../shared/weeklyPlanningTraceContract';

function provider() {
  const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
  const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
    requests.push(structuredClone(request));
    if (request.purpose === 'weekly_planning_semantic_normalizer') return JSON.stringify({
      schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
      planningWindow: { localId: 'window', kind: 'absolute', value: '2026-10-14',
        start: '2026-10-14', end: '2026-10-14', sourceText: '10月14日' },
      tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
      userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
    });
    const payload = JSON.parse(request.messages[1].content);
    return JSON.stringify({ actionId: payload.actionId, actionKind: payload.applicationDecision.actionKind,
      questionCode: payload.applicationDecision.questionCode, groundingAcknowledgement: null,
      text: '何を進めたいですか？' });
  } };
  return { requests, client };
}

function payload(owner = 'alice', label = '履歴') {
  const value = durableReceipt().payload;
  value.input.userId = owner;
  value.input.userText = '10月14日の計画を立てたい';
  value.input.messages = Array.from({ length: 6 }, (_, i) => [
    { id: `u${i}`, role: 'user' as const, content: `${label}${i}を相談したい`, createdAt: '2026-10-13' },
    { id: `a${i}`, role: 'assistant' as const, content: `${label}${i}についての相談ですね`, createdAt: '2026-10-13' },
  ]).flat();
  return value;
}

function repository() {
  let fail = true;
  const writes: { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }[] = [];
  const port: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(write) {
      if (fail) { fail = false; throw new Error('synthetic first append failure'); }
      writes.push(structuredClone(write));
    },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  return { port, writes };
}

function prepared(write: ReturnType<typeof repository>['writes'][number]) {
  return prepareWeeklyPlanningTraceServerWrite({
    session: write.session as unknown as Record<string, unknown>,
    entries: write.entries as unknown as Record<string, unknown>[],
  }, { token: `wpt_${'f'.repeat(43)}`, epoch: '691' }, {
    sessionId: 'weekly-trace-323e4567-e89b-52d3-a456-426614174000',
    logicalConversationId: 'weekly-conversation-323e4567-e89b-52d3-a456-426614174000',
  }, '2026-10-14T00:00:00Z');
}

let restore: () => void;
beforeEach(() => {
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});
afterEach(() => {
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restore();
});

describe('Codex-style context through the actual shared runtime and trace boundary', () => {
  it.each([false, true])('preserves request-scoped history through outbox and Worker (oversized=%s)', async oversized => {
    const h = provider();
    const source = payload();
    const before = structuredClone(source);
    const { result } = await executeIsolatedWeeklyPlanningTurn(source, h.client);
    expect(result.failure).toBeUndefined();
    expect(result.responseSource, JSON.stringify(result.dialogueRendererTrace?.response)).toBe('ai');
    expect(source).toEqual(before);
    const semantic = JSON.parse(h.requests.find(r => r.purpose === 'weekly_planning_semantic_normalizer')!.messages[1].content);
    const rendererRequest = h.requests.find(r => r.purpose === 'weekly_planning_renderer')!;
    const renderer = JSON.parse(rendererRequest.messages[1].content);
    expect(semantic.recentConversation).toHaveLength(12);
    expect(renderer.recentConversation).toEqual(semantic.recentConversation);
    expect(renderer.historyWindow).toEqual(semantic.publicStateSummary.historyWindow);
    const trace = result.dialogueRendererTrace!;
    expect(trace.request).not.toBeNull();
    const captured = trace.request!.promptContext as { messages: unknown; requestBytes: number };
    expect(captured.messages).toEqual(rendererRequest.messages);
    const future = { ...captured, futureSentinel: 'future-harness-field',
      ...(oversized ? { large: ('"\\\n😀').repeat(9000) } : {}), tailSentinel: 'tail-harness-field' };
    const input = {
      userId: 'alice', conversationId: 'chat', requestId: 'chat:request:1',
      userText: source.input.userText, assistantMessage: result.message,
      responseSource: result.responseSource, outcome: 'revision_pending', previewCount: 0, debugTraceEvents: [],
      dialogueRendererTrace: boundWeeklyPlanningDialogueRendererTraceForTransport({
        ...trace, request: { ...trace.request!, promptContext: future },
      }),
    };
    const repo = repository(); setWeeklyPlanningTraceRepositoryForTests(repo.port);
    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(repo.writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: 'alice', conversationId: 'chat' })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: 'chat:request:2' });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: 'alice', conversationId: 'chat' })).toEqual([]);
    expect(repo.writes).toHaveLength(2);
    const entry = repo.writes[0].entries[0];
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(LIMITS.clientDocumentTargetBytes);
    const server = prepared(repo.writes[0]);
    expect(server.entries).toHaveLength(1);
    const serialized = JSON.stringify(server.entries[0]);
    expect(serialized).toContain('tail-harness-field');
    expect(serialized).toContain(oversized ? 'traceTruncated' : 'future-harness-field');
    if (!oversized) expect(serialized).toContain('recent_complete_turns');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(LIMITS.maxDocumentBytes);
  });

  it('captures the real durable ingress before model awaits so late UI edits cannot change later steps', async () => {
    const h = provider();
    const source = payload();
    const originalText = source.input.messages[0].content;
    const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
      if (request.purpose === 'weekly_planning_semantic_normalizer') {
        source.input.messages[0].content = 'a different owner changed the screen';
        source.input.userText = 'late replacement';
      }
      return h.client.createChatCompletion(request);
    } };
    const { result } = await executeIsolatedWeeklyPlanningTurn(source, client);
    expect(result.responseSource).toBe('ai');
    const sent = h.requests.find(r => r.purpose === 'weekly_planning_renderer')!;
    const context = JSON.parse(sent.messages[1].content);
    expect(context.currentUserMessage).toBe('10月14日の計画を立てたい');
    expect(context.recentConversation[0].content).toBe(originalText);
    expect(context.recentConversation).not.toContainEqual(expect.objectContaining({ content: 'late replacement' }));
  });

  it('does not cross-contaminate prompt snapshots when concurrent owners reuse turn identifiers', async () => {
    const a = provider(); const b = provider();
    const [alice, bob] = await Promise.all([
      executeIsolatedWeeklyPlanningTurn(payload('alice', '数学'), a.client),
      executeIsolatedWeeklyPlanningTurn(payload('bob', '英語'), b.client),
    ]);
    const aContext = JSON.stringify(alice.result.dialogueRendererTrace?.request?.promptContext);
    const bContext = JSON.stringify(bob.result.dialogueRendererTrace?.request?.promptContext);
    expect(aContext).toContain('数学'); expect(aContext).not.toContain('英語');
    expect(bContext).toContain('英語'); expect(bContext).not.toContain('数学');
  });
});
