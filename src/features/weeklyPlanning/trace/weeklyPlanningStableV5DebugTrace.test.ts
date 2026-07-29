import { afterEach, describe, expect, it } from 'vitest';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  peekWeeklyPlanningStableV5DebugTraceForTest,
  recordWeeklyPlanningStableV5DebugTrace,
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from './weeklyPlanningStableV5DebugTrace';

afterEach(() => {
  resetWeeklyPlanningStableV5DebugTraceForTest();
});

describe('Stable V5 debug trace collector', () => {
  it('stores a bounded provider projection without cloning the runtime graph', () => {
    beginWeeklyPlanningStableV5DebugTrace('request-1');
    const prompt = `${'system-rule\n'.repeat(1_200)}Use recentConversation and publicStateSummary`;
    const source = {
      attempt: 'initial',
      requestBytes: new TextEncoder().encode(prompt).byteLength,
      request: {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: '3時間ぐらいかな' },
        ],
        purpose: 'weekly_planning_semantic_normalizer',
        responseFormat: { type: 'json_schema' },
        maxCompletionTokens: 3200,
      },
      graph: {
        revision: 2,
        tasks: Array.from({ length: 1_000 }, (_, index) => ({ id: `task-${index}` })),
      },
    };

    recordWeeklyPlanningStableV5DebugTrace({
      requestId: 'request-1',
      stage: 'semantic_provider_request',
      data: source,
    });
    source.graph.revision = 99;

    const recorded = peekWeeklyPlanningStableV5DebugTraceForTest('request-1');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      sequence: 0,
      stage: 'semantic_provider_request',
      data: {
        attempt: 'initial',
        request: {
          messages: expect.arrayContaining([
            expect.objectContaining({ content: expect.stringContaining(
              'Use recentConversation and publicStateSummary',
            ) }),
            expect.objectContaining({ content: '3時間ぐらいかな' }),
          ]),
          purpose: 'weekly_planning_semantic_normalizer',
          maxCompletionTokens: 3200,
        },
      },
    });
    expect(JSON.stringify(recorded[0].data)).not.toContain('task-999');
    expect(recorded[0].data).not.toHaveProperty('graph');
  });

  it('removes full graph and scheduler input from every heavy runtime stage', () => {
    beginWeeklyPlanningStableV5DebugTrace('request-heavy');
    const graph = {
      revision: 7,
      tasks: Array.from({ length: 1_000 }, (_, index) => ({ id: `task-${index}` })),
    };
    const schedulerInput = {
      horizon: { startDate: '2026-07-29', endDate: '2026-08-04', timeZone: 'Asia/Tokyo' },
      graphRevision: 7,
      movableWorkItems: Array.from({ length: 500 }, (_, index) => ({ id: `work-${index}` })),
      availabilityWindows: [],
      fixedTaskReservations: [],
      sourceSelections: [],
    };

    recordWeeklyPlanningStableV5DebugTrace({
      requestId: 'request-heavy',
      stage: 'scheduler_compilation_evaluated',
      data: {
        input: { context: { currentDate: '2026-07-29', timeZone: 'Asia/Tokyo' }, graph },
        result: { status: 'ready', input: schedulerInput, issues: [] },
        selectedPipelineStatus: 'scheduler_ready',
      },
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: 'request-heavy',
      stage: 'runtime_semantic_result_received',
      data: {
        graph,
        normalization: { status: 'accepted', document: { planningIntent: 'create_plan', tasks: [] } },
        canonicalization: { status: 'applied', diff: { fromRevision: 6, toRevision: 7 }, graph },
        scheduler: { status: 'ready', input: schedulerInput, issues: [] },
        status: 'scheduler_ready',
      },
    });
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: 'request-heavy',
      stage: 'runtime_graph_staged',
      data: {
        previousGraphRevision: 6,
        canonicalization: { status: 'applied', diff: { fromRevision: 6, toRevision: 7 }, graph },
      },
    });

    const events = peekWeeklyPlanningStableV5DebugTraceForTest('request-heavy');
    expect(events).toHaveLength(3);
    for (const event of events) {
      const serialized = JSON.stringify(event.data);
      expect(serialized).not.toContain('task-999');
      expect(serialized).not.toContain('work-499');
    }
    expect(events[0]?.data).not.toHaveProperty('input');
    expect(events[1]?.data).not.toHaveProperty('graph');
    expect(events[2]?.data).not.toHaveProperty('canonicalization.graph');
  });

  it('keeps the head, tail, original byte count and checksum for a large AI response', () => {
    beginWeeklyPlanningStableV5DebugTrace('request-large');
    const response = `HEAD-${'あ'.repeat(3_000)}-TAIL`;

    recordWeeklyPlanningStableV5DebugTrace({
      requestId: 'request-large',
      stage: 'semantic_provider_response',
      data: { attempt: 'initial', rawResponse: response },
    });

    const event = peekWeeklyPlanningStableV5DebugTraceForTest('request-large')[0];
    const data = event.data as Record<string, unknown>;
    expect(data.rawResponseTruncated).toBe(true);
    expect(data.rawResponseOriginalBytes).toBe(new TextEncoder().encode(response).byteLength);
    expect(data.rawResponseChecksum).toMatch(/^fnv1a32:/);
    expect(String(data.rawResponse)).toContain('HEAD-');
    expect(String(data.rawResponse)).toContain('-TAIL');
    expect(String(data.rawResponse)).not.toBe(response);
  });

  it('consumes recorded projections once', () => {
    beginWeeklyPlanningStableV5DebugTrace('request-consume');
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: 'request-consume',
      stage: 'runtime_turn_input',
      data: { userText: '予定を作る', selectedDate: '2026-07-29' },
    });

    expect(takeWeeklyPlanningStableV5DebugTrace('request-consume')).toHaveLength(1);
    expect(takeWeeklyPlanningStableV5DebugTrace('request-consume')).toEqual([]);
  });

  it('ignores instrumentation without a request id', () => {
    recordWeeklyPlanningStableV5DebugTrace({
      stage: 'orphan-stage',
      data: { value: 1 },
    });

    expect(peekWeeklyPlanningStableV5DebugTraceForTest('')).toEqual([]);
  });
});
