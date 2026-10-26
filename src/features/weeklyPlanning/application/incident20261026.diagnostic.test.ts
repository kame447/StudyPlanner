import { describe, expect, it } from 'vitest';
import { executeIsolatedWeeklyPlanningTurn } from './weeklyPlanningIsolatedTurn';
import { durableReceipt } from './weeklyPlanningDurableTurn.testUtils';
import { createWeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';
import { readWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { createWeeklyPlanningTurnDiagnosticV2 } from '../trace/weeklyPlanningTurnDiagnosticV2ResponseSource';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';

const userText = '明日の予定にいれて欲しいんだけど、バンドAの合わせが9~10:30\nバンドBの合わせが16~17:30で、全体ゼミが13~15、15~16時が領域ゼミで17~21時までカンファレンスになりそうです';
const events = [
  ['バンドAの合わせ', '09:00', '10:30'],
  ['バンドBの合わせ', '16:00', '17:30'],
  ['全体ゼミ', '13:00', '15:00'],
  ['領域ゼミ', '15:00', '16:00'],
  ['カンファレンス', '17:00', '21:00'],
];
function reading(movableConference: boolean): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-10-27', start: '2026-10-27', end: '2026-10-27', sourceText: '明日' },
    tasks: events.map(([title, startTime, endTime], i) => ({
      localId: `event-${i}`, category: 'non_study', title, study: null, sourceText: userText,
      workloads: movableConference && i === 4 ? [{ localId: 'conference-work', quantityRole: 'target', amount: 240,
        unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: userText }] : [],
      effortEstimates: [], recurrence: [],
      temporalConstraints: [{ localId: `time-${i}`, targetLocalId: `event-${i}`,
        kind: movableConference && i === 4 ? 'preferred_window' : 'fixed_interval',
        constraintLevel: movableConference && i === 4 ? 'soft' : 'hard',
        dateExpression: '2026-10-27', namedTimePeriod: null, startTime, endTime,
        precision: movableConference && i === 4 ? 'approximate' : 'exact', sourceText: userText }],
    })),
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
    conversationActs: [{ kind: 'request_event_registration', targetPublicId: null }],
  };
}
async function run(movableConference: boolean) {
  const payload = durableReceipt().payload;
  payload.input.userText = userText;
  payload.input.selectedDate = '2026-10-26';
  payload.input.traceRequestId = `incident-offline:${movableConference}`;
  payload.input.requestContext = createWeeklyPlanningTurnRequestContext({
    startedAtIso: '2026-10-26T07:59:00.000Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday',
  });
  payload.weekStartDate = '2026-10-26';
  let recordedStages: string[] = [];
  const calls: string[] = [];
  const client: OpenAiCompatibleClient = { async createChatCompletion(request) {
    calls.push(request.responseFormat?.json_schema.name ?? request.purpose ?? 'unknown');
    if (request.purpose === 'weekly_planning_semantic_normalizer') return JSON.stringify(reading(movableConference));
    recordedStages = readWeeklyPlanningStableV5DebugTrace(payload.input.traceRequestId).map(e => e.stage);
    const prompt = JSON.parse([...request.messages].reverse().find(m => m.role === 'user')!.content);
    const text = movableConference ? '候補が3件できています。「この内容で仮予定にする」から進められます。'
      : '指定された予定は「予定」から「予定を追加」を開いて入力できます。';
    return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
      questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text });
  } };
  const output = await executeIsolatedWeeklyPlanningTurn(payload, client);
  return { output, calls, recordedStages, afterStages: readWeeklyPlanningStableV5DebugTrace(payload.input.traceRequestId), payload };
}

describe('Offline incident diagnosis; model response is injected, no external calls', () => {
  it('loses interpretation and scheduling diagnostics across isolated execution', async () => {
    const r = await run(true);
    expect(r.output.result.failure).toBeUndefined();
    expect(r.recordedStages).toContain('semantic_provider_response');
    expect(r.recordedStages).toContain('semantic_validation_result');
    expect(r.afterStages).toEqual([]);
    expect(r.output).not.toHaveProperty('debugTraceEvents');
    expect(r.output.result).not.toHaveProperty('debugTraceEvents');
    const diagnostic = createWeeklyPlanningTurnDiagnosticV2({
      id: 'offline', sessionId: 'offline', logicalConversationId: 'offline', requestId: r.payload.input.traceRequestId,
      sequence: 0, turnIndex: 0, occurredAt: '2026-10-26T08:00:24.347Z', observedAt: '2026-10-26T08:00:24.352Z',
      expireAt: '2027-04-24T08:00:25.872Z', userText,
      assistantMessage: r.output.result.message, outcome: 'preview_ready', previewCount: r.output.result.draftCandidates.length,
      dialogueRendererTrace: r.output.result.dialogueRendererTrace, responseSource: r.output.result.responseSource,
      debugTraceEvents: r.afterStages,
    });
    expect(diagnostic.aiInterpreter.input.requests).toEqual([]);
    expect(diagnostic.aiInterpreter.rawResponses).toEqual([]);
    expect(diagnostic.aiInterpreter.structuredResults).toEqual([]);
    expect(diagnostic.constraintContext.scheduler?.preview).toBeNull();
    expect(diagnostic.diagnostics.truncation?.applied).toBe(false);
    expect(diagnostic.diagnostics.dialogueRenderer?.response.renderedText).toBeTruthy();
    console.log('TRACE_PROOF', JSON.stringify({ during: r.recordedStages, after: r.afterStages.length,
      returnKeys: Object.keys(r.output), requests: diagnostic.aiInterpreter.input.requests.length,
      responses: diagnostic.aiInterpreter.rawResponses.length, truncated: diagnostic.diagnostics.truncation?.applied,
      rendererRetained: Boolean(diagnostic.diagnostics.dialogueRenderer) }));
  });
  it('correct fixed-event interpretation still produces no registration candidates', async () => {
    const r = await run(false);
    expect(r.output.result.failure).toBeUndefined();
    expect(r.output.result.stableV5Graph?.tasks).toHaveLength(5);
    expect(r.output.result.draftCandidates).toEqual([]);
    expect(r.output.result.communicationFacts?.statusReason).toBe('fixed_event_manual_entry');
    console.log('FIXED_PROOF', JSON.stringify({ tasks: r.output.result.stableV5Graph?.tasks.length,
      candidates: r.output.result.draftCandidates.length, communication: r.output.result.communicationFacts, calls: r.calls }));
  });
  it('one movable conference reproduces three conference chunks while fixed events disappear from preview', async () => {
    const r = await run(true);
    expect(r.output.result.failure).toBeUndefined();
    const candidates = r.output.result.draftCandidates;
    console.log('MIXED_PROOF', JSON.stringify({ tasks: r.output.result.stableV5Graph?.tasks.length,
      candidates: candidates.map(c => ({ title: c.title, date: c.date, start: c.startTime, end: c.endTime, minutes: c.durationMinutes })),
      communication: r.output.result.communicationFacts, calls: r.calls }));
    expect(candidates).toHaveLength(3);
    expect(candidates.every(c => c.title.includes('カンファレンス'))).toBe(true);
    expect(candidates.reduce((n, c) => n + c.durationMinutes, 0)).toBe(240);
  });
});
