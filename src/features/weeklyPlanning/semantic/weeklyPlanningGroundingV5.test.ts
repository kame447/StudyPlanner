import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningGroundingRecord } from '../intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { reconcileWeeklyPlanningGroundingRecordsV5 } from './weeklyPlanningGroundingV5';

function graphWithWindow(params: {
  id: string;
  value: string;
  revision: number;
}) {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = params.revision;
  graph.planningWindows = [{
    id: params.id,
    kind: 'relative_week',
    value: params.value,
    start: null,
    end: null,
    source: {
      conversationId: 'conversation-1',
      turnId: `request-${params.revision}`,
      semanticLocalId: `window-${params.revision}`,
      sourceText: '来週',
      origin: 'user',
    },
    createdRevision: params.revision,
  }];
  graph.factLifecycles = [{
    factId: params.id,
    status: 'active',
    createdRevision: params.revision,
    terminalRevision: null,
    supersededByFactId: null,
  }];
  return graph;
}

describe('Stable V5 interaction grounding', () => {
  it('creates a proposed absolute interpretation for a newly introduced relative window', () => {
    const records = reconcileWeeklyPlanningGroundingRecordsV5({
      previousRecords: [],
      previousGraph: createEmptyWeeklyPlanningFactGraphV5(),
      nextGraph: graphWithWindow({ id: 'window-1', value: 'next_week', revision: 1 }),
      resolvedHorizon: { startDate: '2026-08-17', endDate: '2026-08-23' },
      currentTurnId: 'request-1',
      continuationAccepted: false,
    });

    expect(records).toEqual([
      expect.objectContaining({
        targetFactId: 'window-1',
        interpretationKind: 'relative_date_resolution',
        status: 'proposed',
        startDate: '2026-08-17',
        endDate: '2026-08-23',
        proposedAtTurnId: 'request-1',
      }),
    ]);
  });

  it('promotes a previous proposal when the user continues with the projected next activity', () => {
    const previous: WeeklyPlanningGroundingRecord[] = [{
      id: 'grounding:window-1:2026-08-17:2026-08-23',
      targetFactId: 'window-1',
      interpretationKind: 'relative_date_resolution',
      status: 'proposed',
      sourceExpression: 'next_week',
      startDate: '2026-08-17',
      endDate: '2026-08-23',
      proposedAtTurnId: 'request-1',
      acceptedAtTurnId: null,
    }];
    const graph = graphWithWindow({ id: 'window-1', value: 'next_week', revision: 1 });

    const records = reconcileWeeklyPlanningGroundingRecordsV5({
      previousRecords: previous,
      previousGraph: graph,
      nextGraph: graph,
      resolvedHorizon: { startDate: '2026-08-17', endDate: '2026-08-23' },
      currentTurnId: 'request-2',
      continuationAccepted: true,
    });

    expect(records[0]).toMatchObject({
      status: 'continuation_accepted',
      acceptedAtTurnId: 'request-2',
    });
  });

  it('does not treat an unrelated continuation as acceptance', () => {
    const previous: WeeklyPlanningGroundingRecord[] = [{
      id: 'grounding:window-1:2026-08-17:2026-08-23',
      targetFactId: 'window-1',
      interpretationKind: 'relative_date_resolution',
      status: 'proposed',
      sourceExpression: 'next_week',
      startDate: '2026-08-17',
      endDate: '2026-08-23',
      proposedAtTurnId: 'request-1',
      acceptedAtTurnId: null,
    }];
    const graph = graphWithWindow({ id: 'window-1', value: 'next_week', revision: 1 });

    const records = reconcileWeeklyPlanningGroundingRecordsV5({
      previousRecords: previous,
      previousGraph: graph,
      nextGraph: graph,
      resolvedHorizon: { startDate: '2026-08-17', endDate: '2026-08-23' },
      currentTurnId: 'request-unrelated',
      continuationAccepted: false,
    });

    expect(records[0]?.status).toBe('proposed');
  });

  it('rejects the old proposal when its source planning window is superseded', () => {
    const previousGraph = graphWithWindow({ id: 'window-old', value: 'next_week', revision: 1 });
    const nextGraph = graphWithWindow({ id: 'window-new', value: 'next_week', revision: 2 });
    nextGraph.planningWindows = [...previousGraph.planningWindows, ...nextGraph.planningWindows];
    nextGraph.factLifecycles = [
      {
        factId: 'window-old', status: 'superseded', createdRevision: 1,
        terminalRevision: 2, supersededByFactId: 'window-new',
      },
      {
        factId: 'window-new', status: 'active', createdRevision: 2,
        terminalRevision: null, supersededByFactId: null,
      },
    ];
    const previous: WeeklyPlanningGroundingRecord[] = [{
      id: 'grounding:window-old:2026-08-17:2026-08-23',
      targetFactId: 'window-old', interpretationKind: 'relative_date_resolution', status: 'proposed',
      sourceExpression: 'next_week', startDate: '2026-08-17', endDate: '2026-08-23',
      proposedAtTurnId: 'request-1', acceptedAtTurnId: null,
    }];

    const records = reconcileWeeklyPlanningGroundingRecordsV5({
      previousRecords: previous,
      previousGraph,
      nextGraph,
      resolvedHorizon: { startDate: '2026-08-24', endDate: '2026-08-30' },
      currentTurnId: 'request-2',
      continuationAccepted: false,
    });

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetFactId: 'window-old', status: 'rejected' }),
      expect.objectContaining({
        targetFactId: 'window-new', status: 'proposed',
        startDate: '2026-08-24', endDate: '2026-08-30',
      }),
    ]));
  });
});
