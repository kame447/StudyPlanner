import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';
import { createWeeklyPlanningStableV5DialogueRendererCore } from './weeklyPlanningStableV5AiDialogueRendererCore';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';
import { createWeeklyPlanningAiRenderedDialogueTrace, recordWeeklyPlanningDialogueRendererRequestV5, recordWeeklyPlanningDialogueRendererResponseV5 } from './weeklyPlanningStableV5TurnDialogueTrace';
import { boundWeeklyPlanningDialogueRendererTraceForTransport, rememberWeeklyPlanningDialogueRendererPromptContext, resetWeeklyPlanningDialogueRendererPromptContextsForTest } from '../trace/weeklyPlanningDialogueRendererTrace';
import { beginWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest, takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from '../trace/weeklyPlanningTraceTypes';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningStableV5CurrentTurnGrounding } from './weeklyPlanningStableV5CurrentTurnGrounding';

function sessionInput(): WeeklyPlanningStableV5DialogueRenderInput {
  const effort = { id: 'session', taskId: 'english', targetFactId: 'english', kind: 'session_duration', minutes: 60, precision: 'exact' };
  return {
    actionId: 'session-confirmation', actionKind: 'status', questionCode: null,
    currentUserMessage: '明日、連続で1時間英語を勉強したい', recentConversation: [],
    requiredLabels: [], fallbackText: '返信を作れませんでした。', previewCount: 0,
    planningInformation: {
      tasks: [{ id: 'english', title: '英語の勉強' }, { id: 'math', title: '数学' }],
      workloads: [], components: [], effortEstimates: [effort],
      temporalConstraints: [{ taskId: 'english', dateExpression: 'tomorrow' }],
    },
    currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [{
      factId: 'session', kind: 'effort_estimate', sourceText: '連続で1時間',
      data: { ...effort, targetLabels: ['英語の勉強'] },
    }] },
  };
}

function parse(input: WeeklyPlanningStableV5DialogueRenderInput, ack: string, body = ack) {
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({
    actionId: input.actionId, actionKind: input.actionKind, questionCode: input.questionCode,
    groundingAcknowledgement: { factIds: ['session'], text: ack }, text: body,
  }), input);
}

function previewInput(): WeeklyPlanningStableV5DialogueRenderInput {
  const input = sessionInput();
  (input.planningInformation!.tasks as unknown[]).pop();
  return { ...input, actionKind: 'preview_ready', previewCount: 1,
    previewPromotionControlLabel: 'この内容で仮予定にする' };
}

const previewBody = '候補を確認して「この内容で仮予定にする」を選べます。';
const canonicalAck = '「英語の勉強」は1回あたり60分です。';
function parseBody(input: WeeklyPlanningStableV5DialogueRenderInput, text = previewBody) {
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({
    actionId: input.actionId, actionKind: input.actionKind, questionCode: input.questionCode,
    groundingAcknowledgement: null, text,
  }), input);
}

describe('application-owned single session preview acknowledgement', () => {
  it('composes typed accepted duration with a model body and exposes its provenance', () => {
    const input = previewInput(); const before = structuredClone(input);
    expect(parseBody(input)).toMatchObject({ status: 'rendered', text: canonicalAck + previewBody,
      applicationAcknowledgement: { source: 'application', factIds: ['session'], text: canonicalAck } });
    expect(input).toEqual(before);
    const prompt = JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(input).userPrompt);
    expect(prompt.applicationDecision.sessionAcknowledgement).toEqual({ source: 'application', factIds: ['session'], text: canonicalAck });
    expect(prompt.request).toContain('groundingAcknowledgement=null');
    expect(prompt.request).toContain('時間の長さを含めない');
  });

  it('adopts a byte-identical app-owned prefix from the real model without duplicating or rewriting its reply', () => {
    const input = previewInput();
    (input.planningInformation!.tasks as Record<string, unknown>[])[0].title = '英語を勉強する';
    input.currentTurnGrounding!.acceptedFacts[0].data.targetLabels = ['英語を勉強する'];
    const text = '「英語を勉強する」は1回あたり60分です。内容を確認して進める場合は、「この内容で仮予定にする」を選んでください。';
    const result = parseBody(input, text);
    expect(result).toMatchObject({ status: 'rendered', text,
      applicationAcknowledgement: { source: 'application', text: '「英語を勉強する」は1回あたり60分です。' } });
    expect(JSON.parse(result.rawResponse!)).toMatchObject({ groundingAcknowledgement: null, text });
  });

  it.each([
    canonicalAck + canonicalAck,
    canonicalAck.replace('60分', '90分'),
    canonicalAck.replace('60分', '約60分'),
    canonicalAck.replace('英語の勉強', '数学'),
    canonicalAck + '1時間の希望も受け取りました。',
    canonicalAck + '数学は連続で60分ですね。',
  ])('does not let an echoed prefix authorize another or changed claim: %s', text => {
    expect(parseBody(previewInput(), text + previewBody).status).toBe('fallback');
  });

  it.each([
    '1時間の希望も受け取りました。',
    '明日、英語を勉強する時間は連続で1時間ですね。',
    '明日、英語を連続で1時間勉強する仮予定を用意しました。',
    '「英語の勉強」は連続で９０分ですね。',
    '数学は三十分です。',
  ])('rejects model duration prose without removing it: %s', extra => {
    const input = previewInput(); input.currentUserMessage += extra;
    expect(parseBody(input, extra + previewBody)).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });
  });

  it('keeps grounded clock times and the exact preview control allowed', () => {
    const input = previewInput();
    input.planningInformation!.temporalConstraints = [{ taskId: 'english', startTime: '09:00', endTime: '10:00' }];
    expect(parseBody(input, '09:00–10:00の候補です。' + previewBody).status).toBe('rendered');
    expect(parseBody(input, '11:00–12:00の候補です。' + previewBody).status).toBe('fallback');
    expect(parseBody(input, '保存しました。' + previewBody).status).toBe('fallback');
    expect(parseBody(input, '候補です。').status).toBe('fallback');
  });

  it.each(['recovery', 'correction', 'multiple_facts', 'multiple_labels', 'multiple_tasks', 'multiple_active_efforts', 'question', 'not_satisfied', 'missing_active'])('abstains safely for %s', kind => {
    const input = previewInput();
    if (kind === 'recovery') input.recovery = { planningDetailsNotApplied: true, acceptedStateUnchanged: true, retainedPreviewUnchanged: false };
    if (kind === 'correction') Object.assign(input.currentTurnGrounding!, { hasCorrections: true });
    if (kind === 'multiple_facts') input.currentTurnGrounding!.acceptedFacts.push({ ...input.currentTurnGrounding!.acceptedFacts[0], factId: 'second' });
    if (kind === 'multiple_labels') input.currentTurnGrounding!.acceptedFacts[0].data.targetLabels = ['英語の勉強', '読解'];
    if (kind === 'multiple_tasks') (input.planningInformation!.tasks as unknown[]).push({ id: 'math', title: '数学' });
    if (kind === 'multiple_active_efforts') (input.planningInformation!.effortEstimates as unknown[]).push({ id: 'other', taskId: 'english', targetFactId: 'english', kind: 'session_duration', minutes: 90, precision: 'exact' });
    if (kind === 'question') { input.actionKind = 'question'; input.questionCode = 'progress'; }
    if (kind === 'not_satisfied') input.previewConstraintSatisfaction = [{ sourceFactId: 'session', taskId: 'english', taskLabel: '英語の勉強', kind: 'session_duration', status: 'not_satisfied' }];
    if (kind === 'missing_active') input.planningInformation!.effortEstimates = [];
    expect(parseBody(input).status).toBe('fallback');
  });

  it('keeps the legacy correction reply byte-for-byte and preserves approximate typed precision', () => {
    const input = previewInput();
    input.currentTurnGrounding!.hasCorrections = true;
    const ack = '英語の勉強は1回あたり60分ですね。';
    const rendered = parse(input, ack, ack + previewBody);
    expect(rendered).toEqual({ status: 'rendered', text: ack + previewBody, rawResponse: JSON.stringify({
      actionId: input.actionId, actionKind: input.actionKind, questionCode: input.questionCode,
      groundingAcknowledgement: { factIds: ['session'], text: ack }, text: ack + previewBody,
    }) });
    expect(JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(input).userPrompt).applicationDecision).not.toHaveProperty('sessionAcknowledgement');
    delete input.currentTurnGrounding!.hasCorrections;
    input.currentTurnGrounding!.acceptedFacts[0].data.precision = 'approximate';
    (input.planningInformation!.effortEstimates as Record<string, unknown>[])[0].precision = 'approximate';
    expect(parseBody(input)).toMatchObject({ status: 'rendered', text: canonicalAck.replace('60分', '約60分') + previewBody });
  });

  it('derives correction abstention from typed current-turn lifecycle intent', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    const source = { conversationId: 'c', turnId: 'current', semanticLocalId: 's', sourceText: '訂正', origin: 'user' as const };
    graph.tasks.push({ id: 'english', category: 'study', title: '英語の勉強', source, createdRevision: 1 });
    graph.factLifecycles.push({ factId: 'english', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
    graph.correctionIntents.push({ id: 'correction', operation: 'modify', target: { kind: 'task', factId: 'english', publicId: null, mention: null }, replacementFactId: null, source, createdRevision: 1 });
    const grounding = createWeeklyPlanningStableV5CurrentTurnGrounding({ graph, turnId: 'current', actionKind: 'preview_ready', previousQuestionCode: null, currentQuestionCode: null });
    expect(grounding).toHaveProperty('hasCorrections', true);
    graph.correctionIntents[0].source = { ...source, turnId: 'prior' };
    expect(createWeeklyPlanningStableV5CurrentTurnGrounding({ graph, turnId: 'current', actionKind: 'preview_ready', previousQuestionCode: null, currentQuestionCode: null })).not.toHaveProperty('hasCorrections');
  });

  it('retries an invalid body once with the body contract and preserves the provider response', async () => {
    const input = previewInput(); const requests: string[] = [];
    const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
      requests.push(JSON.stringify(request));
      return JSON.stringify({ actionId: input.actionId, actionKind: input.actionKind, questionCode: null, groundingAcknowledgement: null,
        text: requests.length === 1 ? '1時間の希望も受け取りました。' + previewBody : previewBody });
    } });
    const result = await renderer.render(input);
    expect(result).toMatchObject({ status: 'rendered', text: canonicalAck + previewBody });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain('時間の長さを含めない');
    expect(JSON.parse(result.rawResponse!)).toMatchObject({ groundingAcknowledgement: null, text: previewBody });
  });
});

describe('Issue #873 session duration display grounding', () => {
  it('leaves non-preview session ACKs on the existing model-rendered contract', () => {
    const input = sessionInput();
    const request = JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(input).userPrompt).request;
    expect(request).not.toContain('sessionAcknowledgement');
    input.currentTurnGrounding!.acceptedFacts[0].data.kind = 'total_duration';
    expect(JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(input).userPrompt).request).toBe(request);
  });

  it.each([
    ['英語を勉強する', '明日、英語の勉強を連続で1時間ですね。'],
    ['英語を勉強', '明日、英語を連続で1時間勉強する内容ですね。'],
  ])('keeps real-model paraphrased/split labels rejected and the exact session form valid: %s', (title, rejected) => {
    const input = sessionInput();
    (input.planningInformation!.tasks as Record<string, unknown>[])[0].title = title;
    input.currentTurnGrounding!.acceptedFacts[0].data.targetLabels = [title];
    input.planningInformation!.temporalConstraints = [];
    input.planningInformation!.taskDateRules = [{ taskId: 'english', kind: 'allowed_date', dateExpression: 'tomorrow', constraintLevel: 'hard' }];
    expect(parse(input, rejected).status).toBe('fallback');
    const exact = `「${title}」は1回あたり60分です。明日ですね。`;
    expect(parse(input, exact).status).toBe('rendered');
    expect(parse(input, `明日、「${title}」を連続で1時間ですね。`).status).toBe('rendered');
  });

  it.each([
    '英語の勉強は明日、連続で1時間（1回あたり60分）ですね。',
    '英語の勉強は連続で1時間（1回あたり60分）ですね。',
    '英語の勉強は連続で60分ですね。',
    '英語の勉強は連続で１時間（一回につき６０分）ですね。',
  ])('accepts equivalent explicit session claims without changing facts: %s', ack => {
    const input = sessionInput(); const before = structuredClone(input);
    expect(parse(input, ack)).toMatchObject({ status: 'rendered', text: ack });
    expect(input).toEqual(before);
  });

  it.each([
    '英語の勉強は連続で2時間（1回あたり60分）ですね。',
    '英語の勉強は連続で1時間（1回あたり90分）ですね。',
    '英語の勉強は連続で0分（1回あたり60分）ですね。',
    '英語の勉強は連続で1時間（1回あたり0分）ですね。',
    '英語の勉強は連続で1時間（2回あたり60分）ですね。',
    '英語の勉強は連続で1時間（全部で60分）ですね。',
    '英語の勉強は連続で1時間（1問あたり60分）ですね。',
    '英語の勉強は連続で約1時間（1回あたり60分）ですね。',
    '英語の勉強は連続で1時間（1回あたり約60分）ですね。',
    '英語の勉強は連続で1時間（1回あたり60分）ではありません。',
    '英語の勉強は連続で1時間（1回あたり60分）ですか？',
    '数学は連続で1時間（1回あたり60分）ですね。',
    '英語の勉強は明後日、連続で1時間（1回あたり60分）ですね。',
    '英語の勉強は連続で1時間（1回あたり60分）、追加で30分ですね。',
    '90分の英語の勉強は連続で1時間（1回あたり60分）ですね。',
  ])('rejects unsupported values, roles, precision, targets or predicates: %s', ack => {
    const input = sessionInput();
    // Seeing a number in raw text/history never supplies an accepted session fact.
    input.currentUserMessage += '。2時間、90分、30分、明後日とも言った。';
    input.recentConversation = [{ role: 'user', content: '数学は60分' }];
    expect(parse(input, ack).status).toBe('fallback');
  });

  it.each(['total_duration', 'duration_per_unit'])('does not turn %s into a session duration', kind => {
    const input = sessionInput();
    input.currentTurnGrounding!.acceptedFacts[0].data.kind = kind;
    (input.planningInformation!.effortEstimates as Record<string, unknown>[])[0].kind = kind;
    expect(parse(input, '英語の勉強は連続で1時間（1回あたり60分）ですね。').status).toBe('fallback');
  });

  it('checks continuous claims outside the mandatory ACK against active facts', () => {
    const input = sessionInput(); input.currentUserMessage += '。数学は60分、英語は90分。';
    const ack = '英語の勉強は1回あたり60分ですね。';
    for (const extra of ['数学は連続で60分ですね。', '英語の勉強は連続で90分（1回あたり60分）ですね。']) {
      expect(parse(input, ack, ack + extra).status).toBe('fallback');
    }
  });

  it('does not let accepted metadata replace a missing active session estimate', () => {
    const input = sessionInput();
    input.planningInformation!.effortEstimates = [];
    expect(parse(input, '英語の勉強は連続で1時間（1回あたり60分）ですね。').status).toBe('fallback');
  });

  it('requires approximate precision on both equivalent mentions', () => {
    const input = sessionInput();
    input.currentTurnGrounding!.acceptedFacts[0].data.precision = 'approximate';
    (input.planningInformation!.effortEstimates as Record<string, unknown>[])[0].precision = 'approximate';
    const ack = '英語の勉強は連続で約1時間（1回あたり約60分）ですね。';
    expect(parse(input, ack).status).toBe('rendered');
    expect(parse(input, ack.replace('約60分', '60分')).status).toBe('fallback');
  });

  it('allows the grounded confirmation to accompany the application-owned preview action', () => {
    const input = sessionInput();
    input.actionKind = 'preview_ready'; input.previewCount = 1;
    input.previewPromotionControlLabel = 'この内容で仮予定にする';
    const before = structuredClone(input);
    const ack = '英語の勉強は明日、連続で1時間（1回あたり60分）ですね。';
    expect(parse(input, ack, `${ack}1件の候補を用意しました。「この内容で仮予定にする」を選べます。`).status).toBe('rendered');
    expect(input).toEqual(before);
  });
});

describe('Issue #873 accepted display through the trace persistence boundary', () => {
  let restoreStorage: () => void;
  beforeEach(() => {
    restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningStableV5DebugTraceForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
  });
  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    resetWeeklyPlanningStableV5DebugTraceForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    restoreStorage();
  });

  it.each(['initial', 'oversized', 'repair', 'echo', 'correction'])('preserves the actual renderer request/reply through append failure, retry and Worker (%s)', async mode => {
    const oversized = mode === 'oversized';
    const applicationOwned = mode !== 'correction';
    const input = previewInput();
    const ack = canonicalAck;
    if (!applicationOwned) input.currentTurnGrounding!.hasCorrections = true;
    input.planningInformation!.futureSessionAckSentinel = 'keep-future-session-ack';
    if (oversized) input.planningInformation!.futureLargeDetail = 'あ'.repeat(30_000);
    const requestId = 'session-ack-request';
    beginWeeklyPlanningStableV5DebugTrace(requestId);
    let actualRequest = '';
    let calls = 0;
    const renderer = createWeeklyPlanningStableV5DialogueRendererCore({
      async createChatCompletion(request) {
        actualRequest = JSON.stringify(request);
        calls++;
        return JSON.stringify({ actionId: input.actionId, actionKind: input.actionKind, questionCode: null,
          groundingAcknowledgement: applicationOwned ? null : { factIds: ['session'], text: ack },
          text: mode === 'repair' && calls === 1 ? '1時間の希望も受け取りました。' + previewBody : mode === 'echo' || !applicationOwned ? canonicalAck + previewBody : previewBody });
      },
    }, { rememberPrompt: rememberWeeklyPlanningDialogueRendererPromptContext });
    recordWeeklyPlanningDialogueRendererRequestV5({ requestId, input });
    const rendered = await renderer.render(input);
    expect(rendered.status).toBe('rendered');
    expect(calls).toBe(mode === 'repair' ? 2 : 1);
    expect(actualRequest).toContain('session_duration');
    expect(actualRequest).toContain(applicationOwned ? 'sessionAcknowledgement' : 'hasCorrections');
    expect(actualRequest).toContain('keep-future-session-ack');
    recordWeeklyPlanningDialogueRendererResponseV5({ requestId, actionId: input.actionId, rendered, selfRepairNotice: null });
    if (rendered.status !== 'rendered') throw new Error('Expected the session acknowledgement to render');
    const dialogueRendererTrace = boundWeeklyPlanningDialogueRendererTraceForTransport(createWeeklyPlanningAiRenderedDialogueTrace({ actionId: input.actionId,
      actionKind: input.actionKind, questionCode: null, renderInput: input, rendered, finalMessage: rendered.text }));
    const writes: { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }[] = [];
    let firstWrite = true;
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(write) {
        if (firstWrite) { firstWrite = false; throw new Error('Injected session ACK append failure'); }
        writes.push(structuredClone(write));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const userId = 'session-ack-owner';
    const conversationId = 'weekly-conversation-323e4567-e89b-52d3-a456-426614174000';
    const turn = { userId, conversationId, requestId, userText: input.currentUserMessage,
      assistantMessage: rendered.text, responseSource: 'ai' as const, outcome: 'discuss', previewCount: 0,
      dialogueRendererTrace, debugTraceEvents: takeWeeklyPlanningStableV5DebugTrace(requestId) };
    await recordWeeklyPlanningStableV5TurnTrace(turn);
    expect(writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...turn, requestId: `${requestId}-retry`, debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toEqual([]);
    const entry = writes[0].entries[0];
    expect(entry.kind).toBe('turn_diagnostic');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: writes[0].session as unknown as Record<string, unknown>,
      entries: writes[0].entries as unknown as Record<string, unknown>[] },
    { token: `wpt_${'d'.repeat(43)}`, epoch: '103' },
    { sessionId: 'weekly-trace-323e4567-e89b-52d3-a456-426614174000', logicalConversationId: conversationId }, '2026-10-27T19:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const value of [entry, prepared.entries[0]]) {
      const serialized = JSON.stringify(value);
      expect(serialized).toContain(ack);
      if (oversized) expect(serialized).toMatch(/"traceTruncated":true|"applied":true|\[trace truncated\]/);
      else {
        expect(serialized).toContain('keep-future-session-ack');
        expect(serialized).toContain('session_duration');
        expect(serialized).toContain(previewBody);
        if (applicationOwned) {
          expect(serialized).toContain('sessionAcknowledgement');
          expect(serialized).toContain('applicationAcknowledgement');
          expect(serialized).toContain('"source":"application"');
        } else {
          expect(serialized).toContain('hasCorrections');
          expect(serialized).not.toContain('applicationAcknowledgement');
        }
        if (mode === 'repair') {
          expect(serialized).toContain('appendedMessages');
          expect(serialized).toContain('1時間の希望も受け取りました。');
        }
      }
    }
  });
});
