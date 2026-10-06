import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import {
  getLatestWeeklyPlanningTurnMeasurement,
  getWeeklyPlanningTurnMeasurements,
  resetWeeklyPlanningTurnMeasurementsForTest,
  startWeeklyPlanningTurnMeasurement,
  subscribeWeeklyPlanningTurnMeasurements,
} from './weeklyPlanningTurnMeasurement';
import {
  beginWeeklyPlanningTurnDispatchBudget,
  getWeeklyPlanningTurnDispatchBudget,
  WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT,
  WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE,
  WeeklyPlanningTurnDispatchBudgetExceededError,
} from './weeklyPlanningTurnDispatchBudget';

afterEach(() => resetWeeklyPlanningTurnMeasurementsForTest());

function fakeClock(...ticks: number[]) {
  const queue = [...ticks];
  return vi.fn(() => queue.shift() ?? ticks[ticks.length - 1]!);
}

function result(overrides: Partial<WeeklyPlanningTurnExecutionResult> = {}): WeeklyPlanningTurnExecutionResult {
  return {
    state: { status: 'revision_pending', missing: [], questions: [], sourceTurns: [] } as never,
    message: 'm',
    draftCandidates: [],
    ...overrides,
  };
}

describe('turn dispatch counting is independent of enforcement', () => {
  it('counts without refusing when the pool is not enforced (legacy), well past the interaction limit', () => {
    const budget = beginWeeklyPlanningTurnDispatchBudget('legacy-turn', { enforce: false });
    for (let index = 0; index < WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT + 5; index += 1) budget.consume('semantic');
    budget.consume('renderer');
    expect(budget.usage()).toMatchObject({
      total: WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT + 6,
      semantic: WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT + 5,
      renderer: 1,
      enforced: false,
      refused: 0,
    });
  });

  it('refuses and reports the refusal when enforced (interaction); refusals are not counted as dispatches', () => {
    const budget = beginWeeklyPlanningTurnDispatchBudget('interaction-turn', { enforce: true });
    const ceiling = WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT - WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE;
    for (let index = 0; index < ceiling; index += 1) budget.consume('semantic');
    expect(() => budget.consume('semantic')).toThrow(WeeklyPlanningTurnDispatchBudgetExceededError);
    expect(budget.usage()).toMatchObject({ total: ceiling, enforced: true, refused: 1 });
    expect(getWeeklyPlanningTurnDispatchBudget('interaction-turn')).toBe(budget);
  });
});

describe('turn measurement', () => {
  it('measures elapsed time with the injected clock and reads the turn\'s own dispatch usage', () => {
    const budget = beginWeeklyPlanningTurnDispatchBudget('req-1', { enforce: false });
    budget.consume('semantic');
    budget.consume('semantic');
    budget.consume('renderer');
    const timer = startWeeklyPlanningTurnMeasurement({
      architecture: 'legacy_v5', requestId: 'req-1', turnId: 'turn-1', previousState: undefined,
      clock: fakeClock(1_000, 1_742), enforcesBudget: false,
    });
    const measurement = timer.finish({ status: 'committed', result: result() });
    expect(measurement).toMatchObject({
      architecture: 'legacy_v5', requestId: 'req-1', turnId: 'turn-1', elapsedMs: 742, status: 'committed',
      aiDispatches: { total: 3, semantic: 2, renderer: 1, enforced: false, refused: 0 },
      interactionOutcome: null, resultKind: 'status', failureCode: null, pendingQuestion: 'none',
    });
  });

  it('records exactly once per turn and never from another turn\'s pool', () => {
    beginWeeklyPlanningTurnDispatchBudget('req-a', { enforce: true }).consume('semantic');
    beginWeeklyPlanningTurnDispatchBudget('req-b', { enforce: true });
    const timer = startWeeklyPlanningTurnMeasurement({
      architecture: 'interaction_v1', requestId: 'req-b', turnId: 't', previousState: undefined,
      clock: fakeClock(0, 5), enforcesBudget: true,
    });
    expect(timer.finish({ status: 'committed' })?.aiDispatches.total).toBe(0);
    expect(timer.finish({ status: 'failed' })).toBeNull();
    expect(getWeeklyPlanningTurnMeasurements()).toHaveLength(1);
  });

  it('classifies failure, interaction outcome and question presentation without reading text', () => {
    const question = { kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate', topicId: 't', actionId: 'a' } as never;
    const previousState = { lastQuestionContext: question } as never;
    const content = {
      responseSource: 'ai', currentTurnGrounding: 'none', selfRepairNotice: false,
      groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false,
    } as never;

    const explained = startWeeklyPlanningTurnMeasurement({
      architecture: 'interaction_v1', requestId: 'r1', turnId: 't1', previousState, clock: fakeClock(0, 1), enforcesBudget: true,
    }).finish({
      status: 'committed',
      result: result({
        state: { lastQuestionContext: question } as never,
        questionPresentationContent: content,
        interactionOutcome: { kind: 'explain_pending_question', consultationDeferred: false },
      }),
    });
    expect(explained).toMatchObject({ interactionOutcome: 'explain_pending_question', resultKind: 'question', pendingQuestion: 're_presented' });

    const recovered = startWeeklyPlanningTurnMeasurement({
      architecture: 'interaction_v1', requestId: 'r2', turnId: 't2', previousState, clock: fakeClock(0, 1), enforcesBudget: true,
    }).finish({
      status: 'failed',
      result: result({
        interactionOutcome: { kind: 'recover', failure: 'semantic', representedQuestion: true },
        failure: { code: 'stable_v5_normalization_rejected', userMessage: 'x', traceCode: 'detail|attempts=2', diagnostics: {} as never },
      }),
    });
    expect(recovered).toMatchObject({
      status: 'failed', resultKind: 'failure', pendingQuestion: 're_presented',
      failureCode: 'stable_v5_normalization_rejected',
    });

    const asideTurn = startWeeklyPlanningTurnMeasurement({
      architecture: 'interaction_v1', requestId: 'r3', turnId: 't3', previousState, clock: fakeClock(0, 1), enforcesBudget: true,
    }).finish({
      status: 'committed',
      result: result({
        state: { lastQuestionContext: question } as never,
        interactionOutcome: { kind: 'aside', consultationDeferred: false },
      }),
    });
    // A retained-but-not-presented question is not "presented".
    expect(asideTurn).toMatchObject({ resultKind: 'status', pendingQuestion: 'none' });
  });

  it('keeps a bounded in-memory history, notifies subscribers, and carries no user text', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWeeklyPlanningTurnMeasurements(listener);
    for (let index = 0; index < 25; index += 1) {
      startWeeklyPlanningTurnMeasurement({
        architecture: 'legacy_v5', requestId: `r-${index}`, turnId: `t-${index}`, previousState: undefined,
        clock: fakeClock(0, 1), enforcesBudget: false,
      }).finish({ status: 'committed', result: result({ message: 'SECRET USER TEXT' }) });
    }
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(25);
    expect(getWeeklyPlanningTurnMeasurements()).toHaveLength(20);
    expect(getLatestWeeklyPlanningTurnMeasurement()?.sequence).toBe(25);
    expect(JSON.stringify(getWeeklyPlanningTurnMeasurements())).not.toContain('SECRET USER TEXT');
  });
});
