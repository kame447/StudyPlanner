import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from './semantic/weeklyPlanningSemanticPipelineV5';
import {
  resetWeeklyPlanningStableV5FailureDiagnosticsForTest,
} from './semantic/weeklyPlanningStableV5FailureDiagnostics';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from './weeklyPlanningReducer';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from './weeklyPlanningTurnController';
import {
  executeWeeklyPlanningTurn,
  type WeeklyPlanningTurnExecutionResult,
} from './weeklyPlanningTurnExecutor';
import type { PlanningState, WeeklyPlanningAction } from './types';

const { stableExecutorMock } = vi.hoisted(() => ({
  stableExecutorMock: vi.fn(),
}));

vi.mock('./application/weeklyPlanningStableV5RuntimeExecutor', () => ({
  executeWeeklyPlanningStableV5RuntimeTurn: stableExecutorMock,
}));

function intakeState(status: PlanningIntakeState['status']): PlanningIntakeState {
  return {
    status,
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [],
  };
}

function rejectedNormalizer() {
  return {
    normalize: async () => ({
      status: 'rejected' as const,
      document: null,
      diagnostics: {
        schemaVersion: 'weekly-planning-semantic-v5' as const,
        jsonSchemaName: 'weekly_planning_semantic_document_v5' as const,
        normalizerVersion: 'weekly-planning-semantic-normalizer-v5' as const,
        attemptCount: 2,
        repairAttempted: true,
        requestBytes: [100, 180],
        responseLengths: [30, 40],
        latencyMs: 12,
        validationErrors: [
          'initial:document:invalid-json',
          'repair:document.tasks[0].missing-key:sourceText',
        ],
        providerError: null,
      },
    }),
  };
}

describe('Stable V5 failure contract', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5FailureDiagnosticsForTest();
      stableExecutorMock.mockReset();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5FailureDiagnosticsForTest();
    });

  it('does not disguise normalization rejection as needs_scope and keeps only redacted diagnostics', async () => {
    const traceRequestId = 'conversation-1:request:1';
    const pipeline = createWeeklyPlanningSemanticPipelineV5(rejectedNormalizer());
    let pipelineStatus: string | null = null;
    stableExecutorMock.mockImplementation(async () => {
      const pipelineResult = await pipeline.run({
        conversationId: 'conversation-1',
        turnId: traceRequestId,
        expectedRevision: 0,
        userText: '今日の計画を立ててください',
        schedulerContext: {
          ownerId: 'owner-1',
          currentDate: '2026-07-24',
          planningStartDate: '2026-07-24',
          planningEndDate: '2026-07-24',
          timeZone: 'Asia/Tokyo',
          namedTimePeriods: {},
        },
      });
      pipelineStatus = pipelineResult.status;
      return {
        state: intakeState('needs_scope'),
        message: 'AIの構造化結果を安全に採用できませんでした。内容を少し言い換えて、もう一度送ってください。',
        draftCandidates: [],
      } satisfies WeeklyPlanningTurnExecutionResult;
    });

    const result = await executeWeeklyPlanningTurn({
      messages: [],
      userText: '今日の計画を立ててください',
      selectedDate: '2026-07-24',
      userId: 'owner-1',
      plans: [],
      scheduleTemplates: [],
      conversationId: 'conversation-1',
      traceRequestId,
    });

    expect(pipelineStatus).toBe('normalization_rejected');
    expect(result.state).toMatchObject({
      status: 'revision_pending',
      missing: [],
      questions: [],
      lastQuestionContext: undefined,
      shouldCreateDraft: false,
    });
    expect(result.failure).toEqual({
      code: 'stable_v5_normalization_rejected',
      userMessage: result.message,
      traceCode: 'stable_v5_normalization_rejected|attempts=2|repair=1|validation=invalid_json,missing_key',
      diagnostics: {
        attemptCount: 2,
        repairAttempted: true,
        validationErrorCategories: ['invalid_json', 'missing_key'],
        providerErrorCategory: null,
      },
    });
    expect(JSON.stringify(result.failure)).not.toContain('document.tasks');
    expect(JSON.stringify(result.failure)).not.toContain('sourceText');
  });

  it('routes a semantic rejection through fail_turn and preserves the previous intake state', async () => {
    const previousIntake = intakeState('draft_ready');
    let state: PlanningState = {
      ...createInitialPlanningState('2026-07-20'),
      intakeState: previousIntake,
    };
    const dispatch = (action: WeeklyPlanningAction) => {
      state = weeklyPlanningReducer(state, action);
      return state;
    };
    const failureTraceCode =
      'stable_v5_normalization_rejected|attempts=2|repair=1|validation=invalid_json';
    let failedError: unknown;
    let committedCalled = false;

    const submission = await submitWeeklyPlanningControlledTurn({
      session: createWeeklyPlanningControllerSession(
        'owner-1',
        '2026-07-20',
        'conversation-1',
      ),
      ownerId: 'owner-1',
      userText: '今日の計画を立ててください',
      getState: () => state,
      dispatch,
      async execute() {
        return {
          state: intakeState('revision_pending'),
          message: 'AIの構造化結果を安全に採用できませんでした。内容を少し言い換えて、もう一度送ってください。',
          draftCandidates: [],
          failure: {
            code: 'stable_v5_normalization_rejected',
            userMessage: 'AIの構造化結果を安全に採用できませんでした。内容を少し言い換えて、もう一度送ってください。',
            traceCode: failureTraceCode,
            diagnostics: {
              attemptCount: 2,
              repairAttempted: true,
              validationErrorCategories: ['invalid_json'],
              providerErrorCategory: null,
            },
          },
        };
      },
      onCommittedTurn() {
        committedCalled = true;
      },
      onFailedTurn({ error }) {
        failedError = error;
      },
      now: () => '2026-07-24T06:00:00.000Z',
    });

    expect(submission).toEqual({ accepted: true, draftCandidates: [] });
    expect(committedCalled).toBe(false);
    expect(state.pendingTurn).toBeUndefined();
    expect(state.intakeState).toBe(previousIntake);
    expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: '今日の計画を立ててください' },
      {
        role: 'assistant',
        content: 'AIの構造化結果を安全に採用できませんでした。内容を少し言い換えて、もう一度送ってください。',
      },
    ]);
    expect(failedError).toBeInstanceOf(Error);
    expect((failedError as Error).name).toBe(failureTraceCode);
  });
});
