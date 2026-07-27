import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from './weeklyPlanningSemanticPipelineV5';

function minuteTask(localId: string, title: string, minutes: number): SemanticTaskV5 {
  return {
    localId,
    category: 'study',
    title,
    study: {
      purpose: title.includes('夏原稿') ? 'research' : 'review',
      contextLabel: null,
      components: [],
    },
    workloads: [{
      localId: `${localId}-workload`,
      quantityRole: 'target',
      amount: minutes,
      unitCode: 'minute',
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: title,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: title,
  };
}

function document(params: {
  windowLocalId: string;
  sourceText: string;
  tasks: SemanticTaskV5[];
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: params.windowLocalId,
      kind: 'relative_day',
      value: 'today',
      start: null,
      end: null,
      sourceText: params.sourceText,
    },
    tasks: params.tasks,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

const schedulerContext = {
  ownerId: 'owner-1',
  currentDate: '2026-07-27',
  planningStartDate: '2026-07-27',
  planningEndDate: '2026-07-27',
  timeZone: 'Asia/Tokyo',
};

function acceptedResult(documentValue: WeeklyPlanningSemanticDocumentV5) {
  return {
    status: 'accepted' as const,
    document: documentValue,
    diagnostics: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5' as const,
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5' as const,
      attemptCount: 1,
      repairAttempted: false,
      requestBytes: [1],
      responseLengths: [1],
      latencyMs: 1,
      validationErrors: [],
      providerError: null,
    },
  };
}

describe('Stable V5 planning window replacement', () => {
  it('supersedes the previous active planning window when a new window is accepted', () => {
    const first = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document({
        windowLocalId: 'window-old',
        sourceText: '以前の今日の計画',
        tasks: [minuteTask('task-old', '以前の復習', 30)],
      }),
      context: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        expectedRevision: 0,
      },
    });
    if (first.status !== 'applied') throw new Error(first.errors.join(','));

    const second = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: first.graph,
      document: document({
        windowLocalId: 'window-new',
        sourceText: '今日の計画を更新',
        tasks: [minuteTask('task-new', '新しい復習', 45)],
      }),
      context: {
        conversationId: 'conversation-1',
        turnId: 'turn-2',
        expectedRevision: first.graph.revision,
      },
    });
    if (second.status !== 'applied') throw new Error(second.errors.join(','));

    const oldWindowId = first.localToFactId['window-old'];
    const newWindowId = second.localToFactId['window-new'];
    expect(second.diff?.superseded).toContainEqual({
      kind: 'planning_window',
      id: oldWindowId,
    });
    expect(second.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        factId: oldWindowId,
        status: 'superseded',
        terminalRevision: second.graph.revision,
        supersededByFactId: newWindowId,
      }),
      expect.objectContaining({
        factId: newWindowId,
        status: 'active',
      }),
    ]));
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(second.graph).planningWindows)
      .toEqual([expect.objectContaining({ id: newWindowId })]);
  });

  it('does not report an ambiguous planning window when the user submits a new today plan', async () => {
    const firstDocument = document({
      windowLocalId: 'window-old',
      sourceText: '以前の今日の計画',
      tasks: [minuteTask('task-old', '以前の復習', 30)],
    });
    const currentDocument = document({
      windowLocalId: 'window-current',
      sourceText: '今日の計画',
      tasks: [
        minuteTask('task-exam', '院試の過去問を1年分', 60),
        minuteTask('task-os-network', 'OSとネットワークの復習', 60),
        minuteTask('task-paper', '夏原稿の続き', 60),
        minuteTask('task-studyplanner', 'StudyPlannerを少し進める', 30),
      ],
    });
    const results = [acceptedResult(firstDocument), acceptedResult(currentDocument)];
    let callIndex = 0;
    const pipeline = createWeeklyPlanningSemanticPipelineV5({
      normalize: async () => results[callIndex++]!,
    });

    const first = await pipeline.run({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      conversationId: 'conversation-2',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText: '今日の復習予定を作って',
      recentConversation: [],
      publicStateSummary: {},
      schedulerContext,
    });

    const second = await pipeline.run({
      graph: first.graph,
      conversationId: 'conversation-2',
      turnId: 'turn-2',
      expectedRevision: first.graph.revision,
      userText: '今日は院試の過去問を1年分進めたい。あと、OSとネットワークの復習と、夏原稿の続きもやりたい。余裕があればStudyPlannerも少し進めたい。',
      recentConversation: [],
      publicStateSummary: {},
      schedulerContext,
    });

    expect(second.scheduler?.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ambiguous_planning_window' }),
    ]));
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(second.graph).planningWindows)
      .toHaveLength(1);
  });
});
