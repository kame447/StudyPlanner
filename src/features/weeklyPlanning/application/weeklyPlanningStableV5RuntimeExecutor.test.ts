import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningStableV5RuntimeSessionState } from './weeklyPlanningStableV5RuntimeSession';
import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from './weeklyPlanningStableV5RuntimeExecutor';
import {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  resetWeeklyPlanningStableV5RuntimeProviderForTest,
  setWeeklyPlanningStableV5RuntimeProviderForTest,
} from './weeklyPlanningStableV5RuntimeProvider';

const normalizeMock = vi.fn();

vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', async () => {
  const actual = await vi.importActual<typeof import('../semantic/weeklyPlanningSemanticNormalizerV5')>(
    '../semantic/weeklyPlanningSemanticNormalizerV5',
  );
  return {
    ...actual,
    normalizeWeeklyPlanningSemanticV5: (...args: unknown[]) => normalizeMock(...args),
  };
});

function acceptedResult(document: WeeklyPlanningSemanticDocumentV5) {
  return {
    status: 'accepted' as const,
    transportStatus: 'direct' as const,
    rawResponse: JSON.stringify(document),
    document,
    validation: { valid: true as const, errors: [] },
    validationErrors: [],
    repairAttempted: false,
    basePromptSnapshot: null,
    repairPromptSnapshot: null,
    metrics: null,
  };
}

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function recognizedTasksWithoutWorkloadsDocument(): WeeklyPlanningSemanticDocumentV5 {
  const document = emptyDocument();
  return {
    ...document,
    planningIntent: 'create_plan',
    tasks: [
      {
        localId: 'task-research',
        decompositionStatus: 'atomic',
        category: 'study',
        title: '午前：研究を進める',
        study: {
          purpose: 'research',
          activityKind: 'writing',
          contextLabel: null,
          components: [],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '午前中は研究進める',
      },
      {
        localId: 'task-exam',
        decompositionStatus: 'atomic',
        category: 'study',
        title: '午後：院試の勉強',
        study: {
          purpose: 'exam',
          activityKind: 'mixed',
          contextLabel: null,
          components: [],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '午後は院試の勉強',
      },
    ],
  };
}

function planningWindowDocument(): WeeklyPlanningSemanticDocumentV5 {
  const document = emptyDocument();
  return {
    ...document,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-today',
      kind: 'relative_day',
      value: 'today',
      start: null,
      end: null,
      sourceText: '今日',
    },
  };
}

function exactTaskDocument(): WeeklyPlanningSemanticDocumentV5 {
  const document = emptyDocument();
  return {
    ...document,
    planningIntent: 'create_plan',
    tasks: [{
      localId: 'task-writing',
      decompositionStatus: 'atomic',
      category: 'study',
      title: 'レポートを書く',
      study: {
        purpose: 'homework',
        activityKind: 'writing',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-writing',
        quantityRole: 'target',
        amount: 2,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '2時間',
      }],
      effortEstimates: [{
        localId: 'effort-writing',
        targetLocalId: 'workload-writing',
        kind: 'total_duration',
        minutes: 120,
        unitCode: null,
        precision: 'exact',
        sourceText: '2時間',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: 'レポートを2時間やりたい',
    }],
  };
}

function providerState(): WeeklyPlanningStableV5RuntimeSessionState {
  return {
    graph: {
      version: 'weekly-planning-fact-graph-v5',
      revision: 0,
      planningWindows: [],
      tasks: [],
      components: [],
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      taskDateRules: [],
      recurrences: [],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      uncertainties: [],
      studyContexts: [],
      durableContextSignals: [],
      factLifecycles: [],
      appliedTurnKeys: [],
    },
    semanticMemory: null,
  };
}

describe('Stable V5 runtime executor', () => {
  beforeEach(() => {
    normalizeMock.mockReset();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    resetWeeklyPlanningStableV5DebugTraceForTest();
    resetWeeklyPlanningStableV5RuntimeProviderForTest();
    setWeeklyPlanningStableV5RuntimeProviderForTest({
      loadSession: vi.fn(async () => providerState()),
      saveSession: vi.fn(async () => undefined),
    });
  });

  it('keeps empty non-planning turns in a deterministic no-op state', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(emptyDocument()));
    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '雑談です',
      selectedDate: '2026-07-30',
      userId: 'owner-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-empty',
      traceRequestId: 'request-empty',
    });
    expect(result.failure).toBeUndefined();
    expect(result.draftCandidates).toEqual([]);
  });

  it('resolves a planning horizon without inventing work', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(planningWindowDocument()));
    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '今日は予定を立てたい',
      selectedDate: '2026-07-30',
      userId: 'owner-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-today',
      traceRequestId: 'request-today',
    });

    expect(result.draftCandidates).toEqual([]);
    expect(takeWeeklyPlanningStableV5DebugTrace('request-today')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'runtime_branch_selected',
          data: expect.objectContaining({ branch: 'nothing_to_schedule' }),
        }),
      ]),
    );
  });

  it('acknowledges recognized tasks and asks adaptive progress for the first missing workload', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(recognizedTasksWithoutWorkloadsDocument()));

    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: '午前中は研究進めるのと、午後は院試の勉強かな',
      selectedDate: '2026-07-30',
      userId: 'owner-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-recognized-tasks',
      traceRequestId: 'request-recognized-tasks',
    });

    expect(result.state).toMatchObject({
      status: 'revision_pending',
      shouldCreateDraft: false,
      draftGenerationIntent: 'user_authorized',
      lastQuestionContext: {
        targetSlot: 'stable_v5:missing_schedulable_work',
        intent: 'missing_schedulable_work',
        topicId: expect.any(String),
      },
    });
    expect(result.message).toContain('「午前：研究を進める」');
    expect(result.message).not.toContain('「午後：院試の勉強」');
    expect(result.message).toContain('100%');
    expect(result.message).toContain('進んでいますか');
    expect(result.message).not.toContain('全体の範囲');
    expect(result.message).not.toContain('どこまで進めたいですか');
    expect(result.message).not.toContain('それぞれ');
    expect(result.message).not.toBe(
      '予定に入れる作業がまだありません。まず一つ、何を進めたいか教えてください。',
    );
    expect(result.draftCandidates).toEqual([]);

    expect(takeWeeklyPlanningStableV5DebugTrace('request-recognized-tasks')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'runtime_branch_selected',
          data: expect.objectContaining({
            branch: 'nothing_to_schedule',
            basis: expect.objectContaining({
              compilationStatus: 'needs_resolution',
              dialogueStatus: 'nothing_to_schedule',
            }),
            output: expect.objectContaining({
              message: expect.stringContaining('「午前：研究を進める」'),
              stateStatus: 'revision_pending',
              questionCount: 1,
            }),
          }),
        }),
      ]),
    );
  });

  it('produces a draft when exact schedulable work has an estimate', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(exactTaskDocument()));
    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState: undefined,
      messages: [],
      userText: 'レポートを2時間やりたい',
      selectedDate: '2026-07-30',
      userId: 'owner-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-exact',
      traceRequestId: 'request-exact',
    });
    expect(result.failure).toBeUndefined();
  });
});
