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
  it('stores a bounded stage projection instead of cloning the full runtime graph', () => {
    beginWeeklyPlanningStableV5DebugTrace('request-1');
    const source = {
      attempt: 'initial',
      requestBytes: 321,
      request: {
        messages: [
          { role: 'system', content: 'complete system instructions' },
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
        requestBytes: 321,
        request: {
          messages: expect.arrayContaining([
            expect.objectContaining({ content: 'complete system instructions' }),
          ]),
          purpose: 'weekly_planning_semantic_normalizer',
          maxCompletionTokens: 3200,
        },
      },
    });
    expect(JSON.stringify(recorded[0].data)).not.toContain('task-999');
    expect(JSON.stringify(recorded[0].data)).not.toContain('"graph"');
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
