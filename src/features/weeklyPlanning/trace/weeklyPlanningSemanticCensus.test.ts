import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCensusObservedWeeklyPlanningNormalizer, weeklyPlanningSemanticCensusMetadata } from './weeklyPlanningSemanticCensus';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { beginWeeklyPlanningStableV5DebugTrace, peekWeeklyPlanningStableV5DebugTraceForTest, resetWeeklyPlanningStableV5DebugTraceForTest } from './weeklyPlanningStableV5DebugTrace';
import * as censusModule from '../../productObservability/semanticTurnCensus';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { createSemanticTurnCensusScope } from '../../productObservability/semanticTurnCensus';
import type { SemanticCensusEvent } from '../../../../shared/semanticTurnCensus';
import { WeeklyPlanningSemanticNormalizerRunV5 } from '../semantic/weeklyPlanningSemanticNormalizerRunV5';
import { createWeeklyPlanningTurnDiagnosticV2 } from './weeklyPlanningTurnDiagnosticV2ResponseSource';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetWeeklyPlanningStableV5DebugTraceForTest(); });
describe('normalizer-boundary census privacy exclusion', () => {
  it('projects pending state without inspecting utterance, labels or source IDs', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5(); graph.revision = 3;
    const input = { userText: 'private-text', committedGraph: graph, publicStateSummary: { pendingQuestion: { actionId: 'private-action-id', questionCode: 'quantity_role_unresolved', targetFactId: 'private-target-id', graphRevision: 3 } } };
    const result = weeklyPlanningSemanticCensusMetadata(input);
    expect(result).toMatchObject({ questionCode: 'quantity_role_unresolved', targetCount: 1, freshness: 'matched', propositionCount: null, binding: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('private-');
    input.publicStateSummary.pendingQuestion.graphRevision = 2;
    expect(weeklyPlanningSemanticCensusMetadata(input).freshness).toBe('stale');
  });
  it('adds random join metadata after trace capture, leaving provider trace free of census IDs/stage', async () => {
    const traceRequestId = 'existing-private-trace-id'; const events: SemanticCensusEvent[] = [];
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => 'generated-response') };
    const scope = createSemanticTurnCensusScope({ client, domain: 'weekly-planning', enabled: true, sink: { async write(event) { events.push(event); } } });
    beginWeeklyPlanningStableV5DebugTrace(traceRequestId);
    const run = new WeeklyPlanningSemanticNormalizerRunV5(scope.client, { userText: '生の発話', traceRequestId });
    await run.callGeneric([{ role: 'user', content: '生の発話' }], 'repair'); scope.finish('success');
    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    expect(request.semanticCensus).toMatchObject({ stage: 'repair' });
    const trace = JSON.stringify(peekWeeklyPlanningStableV5DebugTraceForTest(traceRequestId));
    expect(trace).not.toContain('semanticCensus');
    expect(trace).not.toContain(request.semanticCensus!.turnId);
    expect(trace).not.toContain(request.semanticCensus!.requestId);
    expect(JSON.stringify(events)).not.toContain(traceRequestId);
    const sessionId = 'weekly-trace-523e4567-e89b-52d3-a456-426614174000';
    const logicalConversationId = 'weekly-conversation-523e4567-e89b-52d3-a456-426614174000';
    const occurredAt = '2026-10-05T00:00:00.000Z';
    const entry = createWeeklyPlanningTurnDiagnosticV2({ id: `${sessionId}-00000000`, sessionId, logicalConversationId,
      sequence: 0, turnIndex: 0, requestId: traceRequestId, occurredAt, observedAt: occurredAt, expireAt: '2027-04-03T00:00:00.000Z',
      userText: '生の発話', assistantMessage: '返答', responseSource: 'ai', outcome: 'revision_pending', previewCount: 0,
      debugTraceEvents: peekWeeklyPlanningStableV5DebugTraceForTest(traceRequestId) });
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: { id: sessionId, logicalConversationId, status: 'active', startedAt: occurredAt, lastActivityAt: occurredAt,
        turnCount: 1, entryCount: 1, hasPreview: false, hasApprovalFailure: false, hasFallback: false, hasError: false, appVersion: 'test', schemaVersion: 2 },
      entries: [entry as unknown as Record<string, unknown>],
    }, { token: `wpt_${'e'.repeat(43)}`, epoch: '104' }, { sessionId, logicalConversationId }, occurredAt);
    const persisted = JSON.stringify(prepared);
    expect(persisted).toContain('生の発話'); // existing trace contract still carries the actual semantic request
    expect(persisted).not.toContain('semanticCensus');
    expect(persisted).not.toContain(request.semanticCensus!.turnId);
    expect(persisted).not.toContain(request.semanticCensus!.requestId);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);

  });
  it('preserves factory-closed options and joins independent Choice/fallback transports through the observed client', async () => {
    const events: SemanticCensusEvent[] = [];
    vi.spyOn(censusModule, 'productionSemanticCensusOptions').mockReturnValue({ enabled: true, sink: { async write(event) { events.push(event); } } });
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => JSON.stringify({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null, tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] })) };
    const options = { independentlyOwnedPort: vi.fn(async () => 'none') };
    const factory = vi.fn((observed: OpenAiCompatibleClient) => ({ async normalize(input: Parameters<ReturnType<typeof createWeeklyPlanningSemanticNormalizerV5>['normalize']>[0]) {
      await observed.semanticCensusObserver!.observe('focused', options.independentlyOwnedPort);
      return createWeeklyPlanningSemanticNormalizerV5(observed).normalize(input);
    } }));
    const result = await createCensusObservedWeeklyPlanningNormalizer(client, factory).normalize({ userText: '予定を作って', publicStateSummary: { graphRevision: 2 } });
    expect(result.status).toBe('accepted'); expect(factory).toHaveBeenCalledTimes(1); expect(options.independentlyOwnedPort).toHaveBeenCalledTimes(1);
    const closure = events[1]; if (closure.kind !== 'closure') throw new Error('Missing closure');
    expect(closure.requestIds).toHaveLength(2); expect(new Set(closure.requestIds).size).toBe(2);
    expect(vi.mocked(client.createChatCompletion).mock.calls[0][0].semanticCensus!.turnId).toBe(closure.turnId);
    expect(closure.semanticResolution).toBe('success');
  });
  it('preserves source-off normalizer behavior and arguments', async () => {
    vi.stubEnv('VITE_SEMANTIC_CENSUS_MODE', 'off');
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => JSON.stringify({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null, tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] })) };
    const result = await createCensusObservedWeeklyPlanningNormalizer(client, createWeeklyPlanningSemanticNormalizerV5).normalize({ userText: '予定を作って', publicStateSummary: { graphRevision: 2 } });
    expect(result.status).toBe('accepted');
    const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
    expect(request).not.toHaveProperty('semanticCensus'); expect(request).not.toHaveProperty('semanticCensusStage');
  });
});
