import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticPromptAssemblyV5';
import {
  parseWeeklyPlanningSemanticDocumentV5,
  validateWeeklyPlanningSemanticValueV5,
} from './weeklyPlanningSemanticValidatorV5';

function createDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-22から2026-07-28',
      start: '2026-07-22',
      end: '2026-07-28',
      sourceText: '今週の計画',
    },
    tasks: [
      {
        localId: 'task-1',
        category: 'non_study',
        title: '研究資料を整理する',
        study: null,
        workloads: [
          {
            localId: 'workload-1',
            quantityRole: 'target',
            amount: 2,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '2時間整理する',
          },
        ],
        effortEstimates: [
          {
            localId: 'effort-1',
            targetLocalId: 'task-1',
            kind: 'total_duration',
            minutes: 120,
            unitCode: null,
            precision: 'exact',
            sourceText: '2時間',
          },
        ],
        temporalConstraints: [
          {
            localId: 'temporal-1',
            targetLocalId: 'task-1',
            kind: 'preferred_window',
            constraintLevel: 'soft',
            dateExpression: null,
            namedTimePeriod: 'evening',
            startTime: null,
            endTime: null,
            precision: 'unspecified',
            sourceText: '夕方にやりたい',
          },
          {
            localId: 'date-rule-1',
            targetLocalId: 'task-1',
            kind: 'allowed_date',
            constraintLevel: 'hard',
            dateExpression: '2026-07-24',
            namedTimePeriod: null,
            startTime: null,
            endTime: null,
            precision: 'exact',
            sourceText: '24日だけ行う',
          },
        ],
        recurrence: [
          {
            localId: 'recurrence-1',
            targetLocalId: 'task-1',
            kind: 'weekly',
            count: null,
            days: ['fri'],
            sourceText: '金曜日',
          },
        ],
        sourceText: '研究資料を整理する',
      },
    ],
    relations: [],
    availabilityDeclarations: [
      {
        localId: 'availability-1',
        kind: 'unavailable',
        dateExpression: '2026-07-23',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        recurrenceKind: null,
        days: [],
        constraintLevel: 'hard',
        sourceText: '23日は予定を入れない',
      },
    ],
    constraintSourceRequests: [
      {
        localId: 'source-request-1',
        kind: 'calendar',
        selector: 'active',
        requestedAction: 'use',
        sourceText: 'カレンダーも使って',
      },
    ],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 semantic document', () => {
  it('validates and parses the direct Stable V5 document', () => {
    const document = createDocument();
    expect(validateWeeklyPlanningSemanticValueV5(document)).toEqual({
      document,
      errors: [],
    });
    expect(parseWeeklyPlanningSemanticDocumentV5(JSON.stringify(document))).toEqual({
      document,
      errors: [],
    });
  });

  it('rejects Alpha identifiers and invalid task date rules', () => {
    const alphaVersion = {
      ...createDocument(),
      schemaVersion: 'weekly-planning-semantic-v5-alpha2',
    };
    expect(validateWeeklyPlanningSemanticValueV5(alphaVersion).errors).toContain(
      'document.schemaVersion',
    );

    const invalidDateRule = createDocument();
    invalidDateRule.tasks[0].temporalConstraints[1] = {
      ...invalidDateRule.tasks[0].temporalConstraints[1],
      constraintLevel: 'soft',
      startTime: '12:00',
    };
    const errors = validateWeeklyPlanningSemanticValueV5(invalidDateRule).errors;
    expect(errors).toContain(
      'document.tasks[0].temporalConstraints[1]:date-rule-cannot-have-clock',
    );
    expect(errors).toContain(
      'document.tasks[0].temporalConstraints[1].constraintLevel:date-rule-must-be-hard',
    );
  });

  it('canonicalizes every Stable V5 collection in one direct transaction', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    const document = createDocument();
    const context = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      expectedRevision: 0,
    };
    const result = canonicalizeWeeklyPlanningSemanticDocumentV5({
      graph,
      document,
      context,
    });

    expect(result.status).toBe('applied');
    expect(result.errors).toEqual([]);
    expect(result.graph.revision).toBe(1);
    expect(result.graph.temporalConstraints).toHaveLength(1);
    expect(result.graph.temporalConstraints[0]).toMatchObject({
      kind: 'preferred_window',
      constraintLevel: 'soft',
      namedTimePeriod: 'evening',
    });
    expect(result.graph.taskDateRules).toHaveLength(1);
    expect(result.graph.taskDateRules[0]).toMatchObject({
      kind: 'allowed_date',
      dateExpression: '2026-07-24',
      constraintLevel: 'hard',
    });
    expect(result.graph.availabilityDeclarations).toHaveLength(1);
    expect(result.graph.constraintSourceRequests).toHaveLength(1);
    expect(result.diff?.added.map((entry) => entry.kind)).toEqual(expect.arrayContaining([
      'planning_window',
      'task',
      'workload',
      'effort_estimate',
      'temporal_constraint',
      'task_date_rule',
      'recurrence',
      'availability_declaration',
      'constraint_source_request',
    ]));

    const duplicate = canonicalizeWeeklyPlanningSemanticDocumentV5({
      graph: result.graph,
      document,
      context: { ...context, expectedRevision: 1 },
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.graph).toBe(result.graph);
  });

  it('keeps the graph unchanged when direct validation rejects the document', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    const document = createDocument();
    document.tasks[0].temporalConstraints[1] = {
      ...document.tasks[0].temporalConstraints[1],
      dateExpression: '2026-02-30',
    };
    const result = canonicalizeWeeklyPlanningSemanticDocumentV5({
      graph,
      document,
      context: {
        conversationId: 'conversation-1',
        turnId: 'turn-invalid',
        expectedRevision: 0,
      },
    });
    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(graph);
    expect(result.diff).toBeNull();
  });

  it('keeps model-facing policy about semantic meaning rather than workflow ownership', () => {
    const system = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '来週の予定を作りたい',
    })[0]?.content ?? '';
    expect(system).toContain('current-turn meaning into semantic facts');
    expect(system).toContain('Emit relations only when stated');
    expect(system).not.toContain('schema and deterministic validators own canonical wire shape');
    expect(system).not.toContain('Do not emit application, scheduling, readiness, preview, save commands');
    expect(system).not.toContain('A concern requires explicit evidence');
  });
});
