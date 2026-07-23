import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';
import { createEmptyWeeklyPlanningFactGraph } from './weeklyPlanningFactGraph';
import { canonicalizeWeeklyPlanningSemanticDocument } from './weeklyPlanningSemanticCanonicalizer';

function createDocument(): WeeklyPlanningSemanticDocument {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-study',
        category: 'study',
        title: '院試の過去問',
        study: {
          purpose: 'exam',
          contextLabel: '大学院入試',
          components: [
            {
              localId: 'component-os-network',
              parentLocalId: null,
              role: 'field',
              label: 'OSとネットワーク',
              workloads: [
                {
                  localId: 'workload-os-network',
                  quantityRole: 'declared',
                  amount: 1,
                  unitCode: 'exam_year',
                  unitLabel: '年分',
                  rangeStart: null,
                  rangeEnd: null,
                  perOccurrence: false,
                  periodExpression: null,
                  sourceText: 'OSとネットワークは1年分',
                },
              ],
              sourceText: 'OSとネットワーク',
            },
            {
              localId: 'component-human-science',
              parentLocalId: null,
              role: 'field',
              label: 'ヒューマンサイエンス',
              workloads: [
                {
                  localId: 'workload-human-science',
                  quantityRole: 'declared',
                  amount: 2,
                  unitCode: 'exam_year',
                  unitLabel: '年分',
                  rangeStart: null,
                  rangeEnd: null,
                  perOccurrence: false,
                  periodExpression: null,
                  sourceText: 'ヒューマンサイエンスは2年分',
                },
              ],
              sourceText: 'ヒューマンサイエンス',
            },
          ],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '院試の過去問を進めたい',
      },
      {
        localId: 'task-research',
        category: 'non_study',
        title: '研究',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [
          {
            localId: 'constraint-research-end',
            targetLocalId: 'task-research',
            kind: 'latest_end',
            dateExpression: null,
            startTime: null,
            endTime: '15:00',
            precision: 'approximate',
            sourceText: '研究も15時くらいまで',
          },
        ],
        recurrence: [],
        sourceText: '研究も15時くらいまで進めないといけません',
      },
    ],
    relations: [
      {
        localId: 'relation-research-before-study',
        kind: 'before',
        fromLocalId: 'task-research',
        toLocalId: 'task-study',
        sourceText: 'その前に研究',
      },
    ],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

const context = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  expectedRevision: 0,
} as const;

describe('weekly planning semantic canonicalizer', () => {
  it('creates generic facts and preserves component workload ownership', () => {
    const result = canonicalizeWeeklyPlanningSemanticDocument({
      document: createDocument(),
      context,
    });

    expect(result.status).toBe('applied');
    expect(result.errors).toEqual([]);
    expect(result.graph.revision).toBe(1);
    expect(result.graph.tasks).toHaveLength(2);
    expect(result.graph.studyContexts).toHaveLength(1);
    expect(result.graph.components).toHaveLength(2);
    expect(result.graph.workloads).toHaveLength(2);

    const osComponentId = result.localToFactId['component-os-network'];
    const humanComponentId = result.localToFactId['component-human-science'];
    expect(result.graph.workloads.find((fact) => fact.amount === 1)?.componentId)
      .toBe(osComponentId);
    expect(result.graph.workloads.find((fact) => fact.amount === 2)?.componentId)
      .toBe(humanComponentId);
  });

  it('preserves a partial latest-end constraint', () => {
    const result = canonicalizeWeeklyPlanningSemanticDocument({
      document: createDocument(),
      context,
    });

    expect(result.graph.temporalConstraints[0]).toMatchObject({
      kind: 'latest_end',
      startTime: null,
      endTime: '15:00',
      precision: 'approximate',
    });
  });

  it('maps task relations to canonical task IDs', () => {
    const result = canonicalizeWeeklyPlanningSemanticDocument({
      document: createDocument(),
      context,
    });

    expect(result.graph.relations[0]).toMatchObject({
      fromTaskId: result.localToFactId['task-research'],
      toTaskId: result.localToFactId['task-study'],
    });
  });

  it('is deterministic for the same conversation, turn, and document', () => {
    const first = canonicalizeWeeklyPlanningSemanticDocument({
      graph: createEmptyWeeklyPlanningFactGraph(),
      document: createDocument(),
      context,
    });
    const second = canonicalizeWeeklyPlanningSemanticDocument({
      graph: createEmptyWeeklyPlanningFactGraph(),
      document: createDocument(),
      context,
    });

    expect(first.localToFactId).toEqual(second.localToFactId);
    expect(first.graph).toEqual(second.graph);
  });

  it('rejects a stale expected revision without mutating the graph', () => {
    const graph = createEmptyWeeklyPlanningFactGraph();
    const result = canonicalizeWeeklyPlanningSemanticDocument({
      graph,
      document: createDocument(),
      context: { ...context, expectedRevision: 1 },
    });

    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(graph);
    expect(result.diff).toBeNull();
    expect(result.errors).toEqual(['revision-mismatch:expected=1:actual=0']);
  });

  it('rejects an invalid semantic document atomically', () => {
    const graph = createEmptyWeeklyPlanningFactGraph();
    const document = createDocument();
    const workload = document.tasks[0].study?.components[0].workloads[0];
    if (!workload) throw new Error('fixture must have workload');
    workload.amount = 0;

    const result = canonicalizeWeeklyPlanningSemanticDocument({ graph, document, context });

    expect(result.status).toBe('rejected');
    expect(result.graph).toBe(graph);
    expect(result.graph.revision).toBe(0);
    expect(result.diff).toBeNull();
    expect(result.errors).toContain(
      'document.tasks[0].study.components[0].workloads[0].amount',
    );
  });

  it('does not apply the same turn twice', () => {
    const first = canonicalizeWeeklyPlanningSemanticDocument({
      document: createDocument(),
      context,
    });
    const second = canonicalizeWeeklyPlanningSemanticDocument({
      graph: first.graph,
      document: createDocument(),
      context: { ...context, expectedRevision: 1 },
    });

    expect(second.status).toBe('duplicate');
    expect(second.graph).toBe(first.graph);
    expect(second.diff).toBeNull();
  });

  it('maps correction references without applying destructive mutation', () => {
    const document = createDocument();
    document.corrections.push({
      localId: 'correction-replace-research',
      target: {
        kind: 'task',
        publicId: null,
        localId: 'task-research',
        mention: null,
      },
      operation: 'replace',
      replacementLocalId: 'task-study',
      sourceText: '研究ではなく院試の方です',
    });

    const result = canonicalizeWeeklyPlanningSemanticDocument({ document, context });

    expect(result.status).toBe('applied');
    expect(result.graph.correctionIntents[0]).toMatchObject({
      target: { factId: result.localToFactId['task-research'] },
      replacementFactId: result.localToFactId['task-study'],
    });
    expect(result.graph.tasks).toHaveLength(2);
  });
});
