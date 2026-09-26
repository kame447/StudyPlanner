import { describe, expect, it } from 'vitest';
import type { ExternalConstraintSourceSnapshot } from '../semantic/weeklyPlanningAvailabilityResolver';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningSemanticPipelineV5 } from '../semantic/weeklyPlanningSemanticPipelineV5';
import {
  defaultFixtureProviderResponse,
  runIssue152Conversation,
} from '../evals/__tests__/weeklyPlanningIssue152StoredRowsFixtures';

// Real run 36210926076 (semantic retention, initial response, accepted without repair): the model chose a
// calendar source for an ungrounded 「予定」 and emitted no constraintSource uncertainty.
const ambiguousSourceText = '来週の計画を作りたいです。予定を見て調整してください。';
const failedRealResponse = '{"schemaVersion":"weekly-planning-semantic-v5","planningIntent":"create_plan","planningWindow":{"localId":"window_1","kind":"relative_week","value":"next_week","start":null,"end":null,"sourceText":"来週"},"tasks":[],"relations":[],"availabilityDeclarations":[],"constraintSourceRequests":[{"localId":"source_request_1","kind":"calendar","selector":"active","requestedAction":"use","sourceText":"予定を見て調整してください"}],"userContextFacts":[],"uncertainties":[],"corrections":[],"decisions":[]}';

const userText = '来週、問題集を10ページ1時間で進めたい。予定を見て調整して';
const schedulerContext = {
  ownerId: 'owner-1',
  currentDate: '2026-07-27',
  planningStartDate: '2026-07-27',
  planningEndDate: '2026-08-02',
  timeZone: 'Asia/Tokyo',
};
const timetableSource: ExternalConstraintSourceSnapshot = {
  kind: 'timetable',
  status: 'success',
  ownerId: 'owner-1',
  activeSourceId: 'studyplanner-timetable:auto',
  attemptCount: 1,
  events: [{
    eventId: 'class-1',
    ownerId: 'owner-1',
    start: { date: '2026-07-28', time: '09:00' },
    end: { date: '2026-07-28', time: '10:30' },
    timeZone: 'Asia/Tokyo',
    constraintLevel: 'hard',
  }],
};

function taskDocument(params: {
  sourceRequest: boolean;
  sourceUncertainty: boolean;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-27/2026-08-02',
      start: '2026-07-27',
      end: '2026-08-02',
      sourceText: '来週',
    },
    tasks: [{
      localId: 'task-1',
      category: 'study',
      title: '問題集',
      study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [{
        localId: 'workload-1',
        quantityRole: 'target',
        amount: 10,
        unitCode: 'page',
        unitLabel: 'ページ',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '問題集を10ページ',
      }],
      effortEstimates: [{
        localId: 'effort-1',
        targetLocalId: 'task-1',
        kind: 'total_duration',
        minutes: 60,
        unitCode: null,
        precision: 'exact',
        sourceText: '1時間',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '問題集を10ページ',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: params.sourceRequest
      ? [{
          localId: 'source-1',
          kind: 'timetable',
          selector: 'active',
          requestedAction: 'use',
          sourceText: '予定を見て調整して',
        }]
      : [],
    uncertainties: params.sourceUncertainty
      ? [{
          localId: 'uncertainty-1',
          targetLocalId: 'document',
          field: 'constraintSource',
          reason: 'source_not_uniquely_grounded',
          sourceText: '予定を見て調整して',
        }]
      : [],
    corrections: [],
    decisions: [],
  };
}

function sourceAnswerDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...taskDocument({ sourceRequest: true, sourceUncertainty: false }),
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    constraintSourceRequests: [{
      localId: 'source-answer',
      kind: 'timetable',
      selector: 'active',
      requestedAction: 'use',
      sourceText: '時間割',
    }],
  };
}

function scriptedNormalizer(
  sequence: WeeklyPlanningSemanticDocumentV5[],
): WeeklyPlanningSemanticNormalizerV5 {
  let index = 0;
  return {
    async normalize() {
      const document = sequence[index++];
      if (!document) throw new Error('normalizer sequence exhausted');
      return {
        status: 'accepted',
        document,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5',
          normalizerVersion: 'weekly-planning-semantic-normalizer-v5',
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

describe('Issue 152 constraint source request lifecycle', () => {
  it('replays the failed Real calendar request without any import, preview, or draft', async () => {
    const observed = await runIssue152Conversation({
      conversationId: 'o6-ambiguous-calendar-replay',
      turns: [ambiguousSourceText],
      fakeProvider: true,
      providerResponse(input) {
        if (input.purpose !== 'weekly_planning_semantic_normalizer') {
          return defaultFixtureProviderResponse(input);
        }
        return failedRealResponse;
      },
    });
    const turn = observed.turns[0];
    expect(turn?.graph?.constraintSourceRequests.map((request) => request.kind)).toEqual(['calendar']);
    // Calendar is not a Stable V5 production source: the request resolves to a blocking unavailable issue.
    expect(turn?.lastQuestionContext).toMatchObject({ intent: 'constraint_source_unavailable' });
    expect(turn?.previewCount).toBe(0);
    expect(turn?.draftCount).toBe(0);
  });

  it('keeps a request that coexists with constraintSource uncertainty out of scheduler input', async () => {
    const pipeline = createWeeklyPlanningSemanticPipelineV5(scriptedNormalizer([
      taskDocument({ sourceRequest: true, sourceUncertainty: true }),
    ]));
    const result = await pipeline.run({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText,
      schedulerContext,
      externalSources: [timetableSource],
    });
    expect(result.status).toBe('scheduler_needs_resolution');
    expect(result.scheduler?.input).toBeNull();
    expect(result.scheduler?.issues).toContainEqual(expect.objectContaining({
      code: 'semantic_uncertainty',
      blocking: true,
      details: expect.objectContaining({ field: 'constraintSource' }),
    }));
  });

  it('imports the timetable only after the source question is answered (benign control)', async () => {
    const pipeline = createWeeklyPlanningSemanticPipelineV5(scriptedNormalizer([
      taskDocument({ sourceRequest: false, sourceUncertainty: true }),
      sourceAnswerDocument(),
    ]));
    const first = await pipeline.run({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText,
      schedulerContext,
      externalSources: [timetableSource],
    });
    expect(first.status).toBe('scheduler_needs_resolution');
    expect(first.scheduler?.input).toBeNull();
    const uncertainty = first.graph.uncertainties.find((fact) => fact.field === 'constraintSource');
    expect(uncertainty).toBeDefined();

    const second = await pipeline.run({
      graph: first.graph,
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: first.graph.revision,
      userText: '時間割',
      publicStateSummary: {
        pendingQuestion: {
          actionId: 'stable-v5:turn-1:semantic_uncertainty',
          questionCode: 'semantic_uncertainty',
          targetFactId: uncertainty?.id ?? null,
          graphRevision: first.graph.revision,
        },
      },
      schedulerContext,
      externalSources: [timetableSource],
    });
    expect(second.status).toBe('scheduler_ready');
    expect(second.graph.factLifecycles).toContainEqual(expect.objectContaining({
      factId: uncertainty?.id,
      status: 'removed',
    }));
    expect(second.scheduler?.input?.sourceSelections).toEqual([
      expect.objectContaining({ kind: 'timetable', status: 'selected' }),
    ]);
    expect(second.scheduler?.input?.availabilityWindows).toEqual([
      expect.objectContaining({ kind: 'occupied', sourceKind: 'timetable', sourceRef: 'class-1' }),
    ]);
  });

  it('imports an explicitly requested timetable in one turn (benign control)', async () => {
    const pipeline = createWeeklyPlanningSemanticPipelineV5(scriptedNormalizer([
      taskDocument({ sourceRequest: true, sourceUncertainty: false }),
    ]));
    const result = await pipeline.run({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText,
      schedulerContext,
      externalSources: [timetableSource],
    });
    expect(result.status).toBe('scheduler_ready');
    expect(result.scheduler?.input?.availabilityWindows).toEqual([
      expect.objectContaining({ kind: 'occupied', sourceKind: 'timetable', sourceRef: 'class-1' }),
    ]);
  });
});
