import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  type WeeklyPlanningSemanticNormalizerResultV5,
  type WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from './weeklyPlanningSemanticPipelineV5';
import {
  decideWeeklyPlanningStableDialogueV5,
} from './weeklyPlanningStableDialoguePolicyV5';
import {
  filterActiveWeeklyPlanningFactsV5,
} from './weeklyPlanningFactLifecycleV5';

function acceptedNormalizer(
  document: WeeklyPlanningSemanticDocumentV5,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
      return {
        status: 'accepted',
        document,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5',
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          attemptCount: 1,
          repairAttempted: false,
          requestBytes: [1],
          responseLengths: [1],
          latencyMs: 1,
          validationErrors: [],
          providerError: null,
        },
      };
    },
  };
}

function ambiguousPlanningWindowDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-report',
      category: 'study',
      title: 'レポート',
      study: {
        purpose: 'homework',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-report-hour',
        quantityRole: 'target',
        amount: 1,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: 'レポートを1時間進める',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: 'レポートを1時間進めたい',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [{
      localId: 'uncertainty-planning-window',
      targetLocalId: 'document',
      field: 'planningWindow',
      reason: '来週と再来週のどちらを計画期間にするか一意に決まらない',
      sourceText: '来週か再来週に',
    }],
    corrections: [],
    decisions: [],
  };
}

function resolvedPlanningWindowDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: {
      localId: 'window-next-week',
      kind: 'absolute',
      value: '2026-08-10/2026-08-16',
      start: '2026-08-10',
      end: '2026-08-16',
      sourceText: '来週です',
    },
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function unresolvedReplyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

const schedulerContext = {
  ownerId: 'owner-partial-acceptance',
  currentDate: '2026-08-03',
  planningStartDate: '2026-08-10',
  planningEndDate: '2026-08-16',
  timeZone: 'Asia/Tokyo',
};

async function initialAmbiguousResult() {
  return createWeeklyPlanningSemanticPipelineV5(
    acceptedNormalizer(ambiguousPlanningWindowDocument()),
  ).run({
    conversationId: 'conversation-partial-acceptance',
    turnId: 'turn-ambiguous',
    expectedRevision: 0,
    userText: '来週か再来週にレポートを1時間進めたい',
    schedulerContext,
  });
}

describe('Stable V5 partial semantic acceptance', () => {
  it('keeps resolved work while selecting the active semantic uncertainty as the first question', async () => {
    const result = await initialAmbiguousResult();

    expect(result.status).toBe('scheduler_needs_resolution');
    expect(result.graph.tasks).toHaveLength(1);
    expect(result.graph.workloads).toHaveLength(1);
    expect(result.graph.uncertainties).toHaveLength(1);
    expect(result.scheduler?.input).toBeNull();
    expect(result.scheduler?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domain: 'semantic_uncertainty',
        code: 'semantic_uncertainty',
        blocking: true,
        factId: result.graph.uncertainties[0]?.id,
      }),
    ]));

    const dialogue = decideWeeklyPlanningStableDialogueV5(result.scheduler!);
    expect(dialogue).toMatchObject({
      status: 'ask_question',
      question: {
        domain: 'semantic_uncertainty',
        code: 'semantic_uncertainty',
        factId: result.graph.uncertainties[0]?.id,
      },
      previewEligible: false,
    });
  });

  it('keeps asking without mutating resolved facts when the answer still contains no resolution', async () => {
    const first = await initialAmbiguousResult();
    const uncertaintyId = first.graph.uncertainties[0]?.id;
    if (!uncertaintyId) throw new Error('uncertainty was not created');

    const second = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(unresolvedReplyDocument()),
    ).run({
      graph: first.graph,
      conversationId: 'conversation-partial-acceptance',
      turnId: 'turn-still-ambiguous',
      expectedRevision: first.graph.revision,
      userText: 'まだどちらか決めていません',
      publicStateSummary: {
        pendingQuestion: {
          actionId: 'ask-semantic-uncertainty',
          questionCode: 'semantic_uncertainty',
          targetFactId: uncertaintyId,
          graphRevision: first.graph.revision,
        },
      },
      schedulerContext,
    });

    expect(second.status).toBe('scheduler_needs_resolution');
    expect(second.graph.tasks).toEqual(first.graph.tasks);
    expect(second.graph.workloads).toEqual(first.graph.workloads);
    expect(filterActiveWeeklyPlanningFactsV5(
      second.graph,
      second.graph.uncertainties,
    ).map((fact) => fact.id)).toEqual([uncertaintyId]);
  });

  it('adds the resolved meaning and removes only the targeted uncertainty', async () => {
    const first = await initialAmbiguousResult();
    const uncertaintyId = first.graph.uncertainties[0]?.id;
    if (!uncertaintyId) throw new Error('uncertainty was not created');

    const resolved = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(resolvedPlanningWindowDocument()),
    ).run({
      graph: first.graph,
      conversationId: 'conversation-partial-acceptance',
      turnId: 'turn-resolved',
      expectedRevision: first.graph.revision,
      userText: '来週です',
      publicStateSummary: {
        pendingQuestion: {
          actionId: 'ask-semantic-uncertainty',
          questionCode: 'semantic_uncertainty',
          targetFactId: uncertaintyId,
          graphRevision: first.graph.revision,
        },
      },
      schedulerContext,
    });

    expect(resolved.status).toBe('scheduler_ready');
    expect(resolved.graph.tasks).toEqual(first.graph.tasks);
    expect(resolved.graph.workloads).toEqual(first.graph.workloads);
    expect(filterActiveWeeklyPlanningFactsV5(
      resolved.graph,
      resolved.graph.uncertainties,
    )).toEqual([]);
    expect(filterActiveWeeklyPlanningFactsV5(
      resolved.graph,
      resolved.graph.planningWindows,
    )).toEqual([
      expect.objectContaining({
        start: '2026-08-10',
        end: '2026-08-16',
      }),
    ]);
    expect(resolved.canonicalization?.diff?.removed).toContainEqual({
      kind: 'uncertainty',
      id: uncertaintyId,
    });
    expect(resolved.scheduler?.input?.movableWorkItems).toEqual([
      expect.objectContaining({ estimatedMinutes: 60 }),
    ]);
  });
});
