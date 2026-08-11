import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import {
  buildWeeklyPlanningGraphSourceMemoryV5,
} from './weeklyPlanningEpisodicMemoryV5';
import {
  createWeeklyPlanningSemanticPublicStateSummaryV5,
} from './weeklyPlanningSemanticPublicStateV5';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticPromptAssemblyV5';

const CONVERSATION_ID = 'conversation-memory';

function graphWithHistory() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 4;
  graph.tasks = [
    {
      id: 'task-math-old',
      category: 'study',
      title: '数学',
      source: {
        conversationId: CONVERSATION_ID,
        turnId: `${CONVERSATION_ID}:request:1`,
        semanticLocalId: 'task-math-old-local',
        sourceText: '来週は数学を進めたい',
        origin: 'user',
      },
      createdRevision: 1,
    },
    {
      id: 'task-math',
      category: 'study',
      title: '数学ワーク',
      source: {
        conversationId: CONVERSATION_ID,
        turnId: `${CONVERSATION_ID}:request:2`,
        semanticLocalId: 'task-math-local',
        sourceText: '数学はワークを進める',
        origin: 'user',
      },
      createdRevision: 2,
    },
  ];
  graph.workloads = [{
    id: 'workload-math',
    taskId: 'task-math',
    componentId: null,
    quantityRole: 'remaining',
    amount: 50,
    unitCode: 'page',
    unitLabel: 'ページ',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: {
      conversationId: CONVERSATION_ID,
      turnId: `${CONVERSATION_ID}:request:3`,
      semanticLocalId: 'workload-math-local',
      sourceText: '残り50ページです',
      origin: 'user',
    },
    createdRevision: 3,
  }];
  graph.temporalConstraints = [{
    id: 'time-math',
    taskId: 'task-math',
    targetFactId: 'task-math',
    kind: 'preferred_window',
    constraintLevel: 'soft',
    dateExpression: 'weekday:tuesday',
    namedTimePeriod: 'evening',
    startTime: null,
    endTime: null,
    precision: 'unspecified',
    source: {
      conversationId: CONVERSATION_ID,
      turnId: `${CONVERSATION_ID}:request:4`,
      semanticLocalId: 'time-math-local',
      sourceText: '数学は火曜の夜がいい',
      origin: 'user',
    },
    createdRevision: 4,
  }];
  graph.factLifecycles = [
    {
      factId: 'task-math-old',
      status: 'superseded',
      createdRevision: 1,
      terminalRevision: 2,
      supersededByFactId: 'task-math',
    },
    {
      factId: 'task-math',
      status: 'active',
      createdRevision: 2,
      terminalRevision: null,
      supersededByFactId: null,
    },
    {
      factId: 'workload-math',
      status: 'active',
      createdRevision: 3,
      terminalRevision: null,
      supersededByFactId: null,
    },
    {
      factId: 'time-math',
      status: 'active',
      createdRevision: 4,
      terminalRevision: null,
      supersededByFactId: null,
    },
  ];
  return graph;
}

describe('Stable V5 graph-backed episodic memory', () => {
  it('recovers only active fact provenance and prioritizes the pending target source', () => {
    const memory = buildWeeklyPlanningGraphSourceMemoryV5({
      graph: graphWithHistory(),
      priorityFactId: 'workload-math',
    });

    expect(memory.items).toHaveLength(3);
    expect(memory.items[0]).toMatchObject({
      sourceRequestId: `${CONVERSATION_ID}:request:3`,
      sourceSequence: 3,
      factIds: ['workload-math'],
      userMessage: null,
      sourceExcerpts: ['残り50ページです'],
      recoveredFrom: 'fact_source',
    });
    expect(memory.items.flatMap((item) => item.sourceExcerpts)).not.toContain(
      '来週は数学を進めたい',
    );
  });

  it('surfaces episodic evidence through public state and the actual semantic request payload', () => {
    const graph = graphWithHistory();
    const summary = createWeeklyPlanningSemanticPublicStateSummaryV5({
      pendingQuestion: {
        questionCode: 'missing_effort_estimate',
        targetFactId: 'workload-math',
        graphRevision: graph.revision,
      },
    }, graph);

    const episodicMemory = summary.episodicMemory as {
      items: Array<{ factIds: string[]; sourceExcerpts: string[] }>;
    };
    expect(episodicMemory.items[0]).toMatchObject({
      factIds: ['workload-math'],
      sourceExcerpts: ['残り50ページです'],
    });

    const requestMessages = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: 'それってどれくらいかかりそう？',
      recentConversation: [],
      publicStateSummary: summary,
    });
    const requestPayload = JSON.parse(requestMessages[1].content) as {
      publicStateSummary: {
        episodicMemory: {
          items: Array<{ sourceRequestId: string; sourceExcerpts: string[] }>;
        };
      };
    };
    expect(requestPayload.publicStateSummary.episodicMemory.items[0]).toMatchObject({
      sourceRequestId: `${CONVERSATION_ID}:request:3`,
      sourceExcerpts: ['残り50ページです'],
    });
  });
});
