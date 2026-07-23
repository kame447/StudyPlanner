import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
  type WeeklyPlanningSemanticDocumentV2,
} from './weeklyPlanningSemanticDocumentV2';
import { createEmptyWeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import { canonicalizeWeeklyPlanningSemanticDocumentV2 } from './weeklyPlanningSemanticCanonicalizerV2';

function document(): WeeklyPlanningSemanticDocumentV2 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-dinner',
        category: 'non_study',
        title: '夕食',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [
          {
            localId: 'constraint-dinner',
            targetLocalId: 'task-dinner',
            kind: 'fixed_interval',
            constraintLevel: 'hard',
            dateExpression: null,
            namedTimePeriod: null,
            startTime: '18:00',
            endTime: '19:00',
            precision: 'exact',
            sourceText: '18時から19時まで夕食',
          },
          {
            localId: 'constraint-before-sleep',
            targetLocalId: 'task-dinner',
            kind: 'preferred_window',
            constraintLevel: 'soft',
            dateExpression: null,
            namedTimePeriod: 'before_sleep',
            startTime: null,
            endTime: null,
            precision: 'unspecified',
            sourceText: '寝る前がやりやすい',
          },
          {
            localId: 'date-rule-skip-25',
            targetLocalId: 'task-dinner',
            kind: 'excluded_date',
            constraintLevel: 'hard',
            dateExpression: '2026-07-25',
            namedTimePeriod: null,
            startTime: null,
            endTime: null,
            precision: 'exact',
            sourceText: '25日は夕食の予定を入れない',
          },
        ],
        recurrence: [],
        sourceText: '18時から19時まで夕食',
      },
    ],
    relations: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
    availabilityDeclarations: [
      {
        localId: 'availability-weekdays',
        kind: 'unavailable',
        dateExpression: null,
        namedTimePeriod: null,
        startTime: null,
        endTime: '18:00',
        recurrenceKind: 'weekdays',
        days: [],
        constraintLevel: 'hard',
        sourceText: '平日は18時まで勉強できない',
      },
      {
        localId: 'availability-weekend-morning',
        kind: 'preferred',
        dateExpression: null,
        namedTimePeriod: 'morning',
        startTime: null,
        endTime: null,
        recurrenceKind: 'weekends',
        days: [],
        constraintLevel: 'soft',
        sourceText: '土日の午前中がやりやすい',
      },
    ],
    constraintSourceRequests: [
      {
        localId: 'source-timetable',
        kind: 'timetable',
        selector: 'active',
        requestedAction: 'use',
        sourceText: '時間割も使って',
      },
    ],
  };
}

const context = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  expectedRevision: 0,
} as const;

describe('weekly planning semantic alpha2 canonicalizer', () => {
  it('preserves temporal, task-date, and availability extensions as separate facts', () => {
    const result = canonicalizeWeeklyPlanningSemanticDocumentV2({
      graph: createEmptyWeeklyPlanningFactGraphV2(),
      document: document(),
      context,
    });

    expect(result.status).toBe('applied');
    expect(result.errors).toEqual([]);
    expect(result.graph.revision).toBe(1);
    expect(result.graph.temporalConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'fixed_interval',
        constraintLevel: 'hard',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '19:00',
      }),
      expect.objectContaining({
        kind: 'preferred_window',
        constraintLevel: 'soft',
        namedTimePeriod: 'before_sleep',
      }),
    ]));
    expect(result.graph.temporalConstraints.map((fact) => fact.kind))
      .not.toContain('excluded_date');
    expect(result.graph.taskDateRules).toEqual([
      expect.objectContaining({
        taskId: result.localToFactId['task-dinner'],
        targetFactId: result.localToFactId['task-dinner'],
        kind: 'excluded_date',
        dateExpression: '2026-07-25',
        constraintLevel: 'hard',
      }),
    ]);
    expect(result.graph.availabilityDeclarations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'unavailable',
        recurrenceKind: 'weekdays',
        namedTimePeriod: null,
        constraintLevel: 'hard',
        resolutionStatus: 'unresolved',
      }),
      expect.objectContaining({
        kind: 'preferred',
        recurrenceKind: 'weekends',
        namedTimePeriod: 'morning',
        constraintLevel: 'soft',
        resolutionStatus: 'unresolved',
      }),
    ]));
    expect(result.graph.constraintSourceRequests[0]).toMatchObject({
      kind: 'timetable',
      selector: 'active',
      requestedAction: 'use',
      resolutionStatus: 'unresolved',
    });
  });

  it('assigns canonical IDs and records new fact kinds in the diff', () => {
    const result = canonicalizeWeeklyPlanningSemanticDocumentV2({
      graph: createEmptyWeeklyPlanningFactGraphV2(),
      document: document(),
      context,
    });

    expect(result.localToFactId['date-rule-skip-25'])
      .toMatch(/^wpf_task_date_rule_/);
    expect(result.localToFactId['availability-weekdays']).toMatch(/^wpf_availability_/);
    expect(result.localToFactId['source-timetable']).toMatch(/^wpf_source_request_/);
    expect(result.diff?.added).toEqual(expect.arrayContaining([
      {
        kind: 'task_date_rule',
        id: result.localToFactId['date-rule-skip-25'],
      },
      {
        kind: 'availability_declaration',
        id: result.localToFactId['availability-weekdays'],
      },
      {
        kind: 'constraint_source_request',
        id: result.localToFactId['source-timetable'],
      },
    ]));
  });

  it('does not fabricate authoritative external event contents', () => {
    const result = canonicalizeWeeklyPlanningSemanticDocumentV2({
      graph: createEmptyWeeklyPlanningFactGraphV2(),
      document: document(),
      context,
    });

    const request = result.graph.constraintSourceRequests[0] as unknown as Record<string, unknown>;
    expect(request.eventId).toBeUndefined();
    expect(request.startDateTime).toBeUndefined();
    expect(request.endDateTime).toBeUndefined();
    expect(request.ownerId).toBeUndefined();
  });

  it('is deterministic for the same empty graph, document, and context', () => {
    const first = canonicalizeWeeklyPlanningSemanticDocumentV2({
      graph: createEmptyWeeklyPlanningFactGraphV2(),
      document: document(),
      context,
    });
    const second = canonicalizeWeeklyPlanningSemanticDocumentV2({
      graph: createEmptyWeeklyPlanningFactGraphV2(),
      document: document(),
      context,
    });

    expect(first.localToFactId).toEqual(second.localToFactId);
    expect(first.graph).toEqual(second.graph);
  });

  it('does not apply the same turn twice', () => {
    const first = canonicalizeWeeklyPlanningSemanticDocumentV2({
      graph: createEmptyWeeklyPlanningFactGraphV2(),
      document: document(),
      context,
    });
    const second = canonicalizeWeeklyPlanningSemanticDocumentV2({
      graph: first.graph,
      document: document(),
      context: { ...context, expectedRevision: 1 },
    });

    expect(second.status).toBe('duplicate');
    expect(second.graph).toBe(first.graph);
    expect(second.diff).toBeNull();
  });

  it('rejects invalid availability atomically', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV2();
    const invalid = document();
    invalid.availabilityDeclarations[0].constraintLevel = 'soft';

    const result = canonicalizeWeeklyPlanningSemanticDocumentV2({
      graph,
      document: invalid,
      context,
    });

    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(graph);
    expect(result.graph.revision).toBe(0);
    expect(result.diff).toBeNull();
    expect(result.errors).toContain(
      'document.availabilityDeclarations[0].constraintLevel:soft-unavailable-use-avoided',
    );
  });
});
