import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticPipelineV5 } from './weeklyPlanningSemanticPipelineV5';
import { filterActiveWeeklyPlanningFactsV5 } from './weeklyPlanningFactLifecycleV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  type WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

const context = {
  ownerId: 'owner-document-uncertainty',
  currentDate: '2026-10-14',
  planningStartDate: '2026-10-14',
  planningEndDate: '2026-10-14',
  timeZone: 'Asia/Tokyo',
};

function document(
  overrides: Partial<WeeklyPlanningSemanticDocumentV5>,
): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
    ...overrides,
  };
}

function acceptedNormalizer(value: WeeklyPlanningSemanticDocumentV5): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize() {
      return {
        status: 'accepted' as const,
        document: value,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5',
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          attemptCount: 1,
          repairAttempted: false,
          requestBytes: [100],
          responseLengths: [100],
          latencyMs: 1,
          validationErrors: [],
          providerError: null,
        },
      };
    },
  };
}

async function run(
  turnId: string,
  doc: WeeklyPlanningSemanticDocumentV5,
  graph?: WeeklyPlanningFactGraphV5,
  publicStateSummary?: Record<string, unknown>,
) {
  return createWeeklyPlanningSemanticPipelineV5(acceptedNormalizer(doc)).run({
    graph,
    conversationId: 'conversation-document-uncertainty',
    turnId,
    expectedRevision: graph?.revision ?? 0,
    userText: turnId,
    ...(publicStateSummary ? { publicStateSummary } : {}),
    schedulerContext: context,
  });
}

function pendingTasksDocument(field = 'tasks'): WeeklyPlanningSemanticDocumentV5 {
  return document({
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'today-window',
      kind: 'absolute',
      value: '2026-10-14',
      start: '2026-10-14',
      end: '2026-10-14',
      sourceText: '今日',
    },
    uncertainties: [{
      localId: 'missing-tasks',
      targetLocalId: 'document',
      field,
      reason: '今日入れる活動がまだ特定されていない',
      sourceText: '今日の予定立てて',
    }],
  });
}

function typedTasksDocument(): WeeklyPlanningSemanticDocumentV5 {
  return document({
    tasks: [{
      localId: 'task-cleaning',
      category: 'non_study',
      title: '掃除',
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '掃除',
    }, {
      localId: 'task-research',
      category: 'study',
      title: '研究',
      study: { purpose: 'research', contextLabel: null, components: [] },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '研究を進めたい',
    }],
  });
}

function activeUncertainties(graph: WeeklyPlanningFactGraphV5) {
  return filterActiveWeeklyPlanningFactsV5(graph, graph.uncertainties);
}

describe('document-scoped missing-task evidence lifecycle', () => {
  it('retires the exact missing-task need after committing typed tasks, not merely after a reply', async () => {
    const first = await run('今日の予定立てて', pendingTasksDocument());
    expect(first.status).toBe('scheduler_needs_resolution');
    expect(activeUncertainties(first.graph)).toHaveLength(1);
    const uncertaintyId = first.graph.uncertainties[0].id;

    const vague = await run('まだ考え中', document({ planningIntent: 'discuss' }), first.graph);
    expect(activeUncertainties(vague.graph).map(fact => fact.id)).toEqual([uncertaintyId]);

    const withTasks = await run('掃除と研究進めたい', typedTasksDocument(), vague.graph);
    expect(withTasks.graph.tasks.map(task => task.title)).toEqual(['掃除', '研究']);
    expect(activeUncertainties(withTasks.graph)).toHaveLength(0);
    expect(withTasks.canonicalization?.diff?.removed).toContainEqual({
      kind: 'uncertainty',
      id: uncertaintyId,
    });
    expect(withTasks.scheduler?.issues.some(issue => issue.code === 'semantic_uncertainty')).toBe(false);

    const explanation = await run('どういうこと？', document({ planningIntent: 'discuss' }), withTasks.graph);
    expect(explanation.graph.tasks.map(task => task.title)).toEqual(['掃除', '研究']);
    expect(activeUncertainties(explanation.graph)).toHaveLength(0);
  });

  it('does not retire an unrelated document-level ambiguity when tasks are supplied', async () => {
    const first = await run('unresolved-other-field', pendingTasksDocument('unresolved_reference'));
    const next = await run('typed-tasks', typedTasksDocument(), first.graph);
    expect(activeUncertainties(next.graph).map(fact => fact.id))
      .toEqual([first.graph.uncertainties[0].id]);
  });

  it('retains a freshly repeated tasks uncertainty despite accepting independently stated tasks', async () => {
    const first = await run('missing-tasks', pendingTasksDocument());
    const next = await run('both-tasks-and-question', document({
      ...typedTasksDocument(),
      uncertainties: [{
        localId: 'another-task-uncertainty',
        targetLocalId: 'document',
        field: 'tasks',
        reason: 'ほかの予定の対象は未確定',
        sourceText: 'ほかの予定',
      }],
    }), first.graph);
    expect(activeUncertainties(next.graph).some(fact => fact.id === first.graph.uncertainties[0].id))
      .toBe(true);
    expect(activeUncertainties(next.graph).some(fact => fact.field === 'tasks')).toBe(true);
  });

  it('repairs a previously persisted stale need after tasks were already accepted in a later revision', async () => {
    const first = await run('today needs tasks', pendingTasksDocument());
    const taskTurn = await run('掃除と研究進めたい', typedTasksDocument(), first.graph);
    const uncertaintyId = first.graph.uncertainties[0].id;
    // Reconstruct the bad persisted lifecycle from the production incident:
    // accepted tasks exist, but the older document-level uncertainty stayed active.
    const staleGraph: WeeklyPlanningFactGraphV5 = {
      ...taskTurn.graph,
      factLifecycles: taskTurn.graph.factLifecycles.map(entry => entry.factId === uncertaintyId
        ? { ...entry, status: 'active' as const, terminalRevision: null, supersededByFactId: null }
        : entry),
    };
    expect(activeUncertainties(staleGraph).map(fact => fact.id)).toContain(uncertaintyId);

    const next = await run('説明してください', document({ planningIntent: 'discuss' }), staleGraph, {
      pendingQuestion: {
        actionId: 'previous-question',
        questionCode: 'semantic_uncertainty',
        targetFactId: uncertaintyId,
        graphRevision: staleGraph.revision,
      },
    });
    expect(next.canonicalization?.status).toBe('applied');
    expect(activeUncertainties(next.graph)).toHaveLength(0);
    expect(next.graph.tasks.map(task => task.title)).toEqual(['掃除', '研究']);
    expect(next.canonicalization?.diff?.removed).toContainEqual({
      kind: 'uncertainty', id: uncertaintyId,
    });
  });

  it('does not retire a newer activity need using only previously accepted tasks or an identity shell', async () => {
    const earlier = await run('already had some tasks', typedTasksDocument());
    const pending = await run('add more but not specified', pendingTasksDocument(), earlier.graph);
    const uncertaintyId = pending.graph.uncertainties[0].id;
    const notAnswered = await run('まだ具体的ではない', document({
      planningIntent: 'discuss',
      tasks: [{
        ...typedTasksDocument().tasks[0],
        localId: 'identity-only',
        existingPublicId: earlier.graph.tasks[0].id,
      }],
    }), pending.graph);
    expect(activeUncertainties(notAnswered.graph).map(fact => fact.id))
      .toContain(uncertaintyId);
  });
});
