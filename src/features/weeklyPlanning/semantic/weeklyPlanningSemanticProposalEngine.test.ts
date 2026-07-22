import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';
import { createEmptyWeeklyPlanningFactGraph } from './weeklyPlanningFactGraph';
import type {
  WeeklyPlanningSemanticNormalizer,
  WeeklyPlanningSemanticNormalizerResult,
} from './weeklyPlanningSemanticNormalizer';
import { proposeWeeklyPlanningSemanticTurn } from './weeklyPlanningSemanticProposalEngine';

function document(): WeeklyPlanningSemanticDocument {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-bookkeeping',
        category: 'study',
        title: '簿記の問題集',
        study: {
          purpose: 'exam',
          contextLabel: '簿記試験',
          components: [
            {
              localId: 'component-problems',
              parentLocalId: null,
              role: 'material',
              label: '問題集',
              workloads: [
                {
                  localId: 'workload-problems',
                  quantityRole: 'target',
                  amount: 20,
                  unitCode: 'problem',
                  unitLabel: '問',
                  rangeStart: null,
                  rangeEnd: null,
                  perOccurrence: false,
                  periodExpression: null,
                  sourceText: '20問進めたい',
                },
              ],
              sourceText: '簿記の問題集',
            },
          ],
        },
        workloads: [],
        effortEstimates: [
          {
            localId: 'estimate-problem',
            targetLocalId: 'component-problems',
            kind: 'duration_per_unit',
            minutes: 10,
            unitCode: 'problem',
            precision: 'approximate',
            sourceText: '1問10分くらい',
          },
        ],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '簿記の問題集を20問進めたいです。1問10分くらいかかります。',
      },
    ],
    relations: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function diagnostics() {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    attemptCount: 1,
    repairAttempted: false,
    requestBytes: [1000],
    responseLengths: [2000],
    latencyMs: 100,
    validationErrors: [],
    providerError: null,
  };
}

function normalizer(result: WeeklyPlanningSemanticNormalizerResult): WeeklyPlanningSemanticNormalizer {
  return { async normalize() { return result; } };
}

const input = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  userText: '簿記の問題集を20問進めたいです。1問10分くらいかかります。',
} as const;

describe('weekly planning semantic proposal engine', () => {
  it('builds an unsaved generic proposal through all deterministic stages', async () => {
    const baseGraph = createEmptyWeeklyPlanningFactGraph();
    const result = await proposeWeeklyPlanningSemanticTurn({
      graph: baseGraph,
      input,
      normalizer: normalizer({
        status: 'accepted',
        document: document(),
        diagnostics: diagnostics(),
      }),
    });

    expect(result.status).toBe('proposed');
    expect(result.baseGraph).toBe(baseGraph);
    expect(result.proposedGraph).not.toBe(baseGraph);
    expect(baseGraph.revision).toBe(0);
    expect(result.proposedGraph.revision).toBe(1);
    expect(result.compilation?.items[0]).toMatchObject({
      quantity: { amount: 20, unitCode: 'problem' },
      estimatedMinutes: 200,
    });
    expect(result.dialoguePolicy).toMatchObject({
      readinessStage: 'preview_ready',
      nextQuestion: null,
    });
  });

  it('returns the same graph reference on provider failure', async () => {
    const graph = createEmptyWeeklyPlanningFactGraph();
    const result = await proposeWeeklyPlanningSemanticTurn({
      graph,
      input,
      normalizer: normalizer({
        status: 'provider_failure',
        document: null,
        diagnostics: {
          ...diagnostics(),
          responseLengths: [],
          providerError: 'provider unavailable',
        },
      }),
    });

    expect(result).toMatchObject({
      status: 'provider_failure',
      diff: null,
      compilation: null,
      dialoguePolicy: null,
    });
    expect(result.baseGraph).toBe(graph);
    expect(result.proposedGraph).toBe(graph);
    expect(graph.revision).toBe(0);
  });

  it('returns the same graph reference when semantic repair is rejected', async () => {
    const graph = createEmptyWeeklyPlanningFactGraph();
    const result = await proposeWeeklyPlanningSemanticTurn({
      graph,
      input,
      normalizer: normalizer({
        status: 'rejected',
        document: null,
        diagnostics: {
          ...diagnostics(),
          attemptCount: 2,
          repairAttempted: true,
          validationErrors: ['repair:document.tasks'],
        },
      }),
    });

    expect(result.status).toBe('semantic_rejected');
    expect(result.proposedGraph).toBe(graph);
    expect(result.diff).toBeNull();
  });

  it('returns duplicate without compiling or changing an already applied turn', async () => {
    const first = await proposeWeeklyPlanningSemanticTurn({
      graph: createEmptyWeeklyPlanningFactGraph(),
      input,
      normalizer: normalizer({
        status: 'accepted',
        document: document(),
        diagnostics: diagnostics(),
      }),
    });
    const second = await proposeWeeklyPlanningSemanticTurn({
      graph: first.proposedGraph,
      input,
      normalizer: normalizer({
        status: 'accepted',
        document: document(),
        diagnostics: diagnostics(),
      }),
    });

    expect(second.status).toBe('duplicate');
    expect(second.proposedGraph).toBe(first.proposedGraph);
    expect(second.compilation).toBeNull();
    expect(second.dialoguePolicy).toBeNull();
  });
});
