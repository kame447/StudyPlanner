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
  it('records full ordered stage data and consumes it once', () => {
    beginWeeklyPlanningStableV5DebugTrace('request-1');
    const source = {
      requestMessages: [
        { role: 'system', content: 'complete system instructions' },
        { role: 'user', content: '3時間ぐらいかな' },
      ],
      graph: { revision: 2, tasks: [{ id: 'task-1' }] },
    };

    recordWeeklyPlanningStableV5DebugTrace({
      requestId: 'request-1',
      stage: 'semantic_provider_request',
      data: source,
    });
    source.graph.revision = 99;
    recordWeeklyPlanningStableV5DebugTrace({
      requestId: 'request-1',
      stage: 'semantic_provider_response',
      data: { rawResponse: '{"schemaVersion":"weekly-planning-semantic-v5"}' },
    });

    expect(peekWeeklyPlanningStableV5DebugTraceForTest('request-1')).toMatchObject([
      {
        sequence: 0,
        stage: 'semantic_provider_request',
        data: {
          requestMessages: expect.arrayContaining([
            expect.objectContaining({ content: 'complete system instructions' }),
          ]),
          graph: { revision: 2, tasks: [{ id: 'task-1' }] },
        },
      },
      {
        sequence: 1,
        stage: 'semantic_provider_response',
        data: { rawResponse: '{"schemaVersion":"weekly-planning-semantic-v5"}' },
      },
    ]);

    const consumed = takeWeeklyPlanningStableV5DebugTrace('request-1');
    expect(consumed).toHaveLength(2);
    expect(takeWeeklyPlanningStableV5DebugTrace('request-1')).toEqual([]);
  });

  it('ignores instrumentation without a request id', () => {
    recordWeeklyPlanningStableV5DebugTrace({
      stage: 'orphan-stage',
      data: { value: 1 },
    });

    expect(peekWeeklyPlanningStableV5DebugTraceForTest('')).toEqual([]);
  });
});
