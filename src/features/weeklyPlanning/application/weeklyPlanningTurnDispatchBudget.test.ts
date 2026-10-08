import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { tryWeeklyPlanningDenseTurnCompletenessRetryV5 } from '../semantic/weeklyPlanningSemanticDenseTurnCompletenessV5';
import { tryWeeklyPlanningSemanticNoOpCompletenessRetryV5 } from '../semantic/weeklyPlanningSemanticNoOpCompletenessRetryV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerRunV5 } from '../semantic/weeklyPlanningSemanticNormalizerRunV5';
import {
  beginWeeklyPlanningTurnDispatchBudget,
  createWeeklyPlanningTurnDispatchBudget,
  endWeeklyPlanningTurnDispatchBudget,
  getWeeklyPlanningTurnDispatchBudget,
  WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT,
  WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE,
  WeeklyPlanningTurnDispatchBudgetExceededError,
  withWeeklyPlanningTurnDispatchBudget,
} from './weeklyPlanningTurnDispatchBudget';

function fakeClient(): OpenAiCompatibleClient & { createChatCompletion: ReturnType<typeof vi.fn> } {
  return { createChatCompletion: vi.fn(async () => '{}') };
}

describe('turn-level AI dispatch budget', () => {
  it('is one pool: semantic and renderer clients of the same turn draw from the same limit', async () => {
    const budget = beginWeeklyPlanningTurnDispatchBudget('turn-1');
    const semantic = withWeeklyPlanningTurnDispatchBudget(fakeClient(), getWeeklyPlanningTurnDispatchBudget('turn-1'), 'semantic');
    const renderer = withWeeklyPlanningTurnDispatchBudget(fakeClient(), getWeeklyPlanningTurnDispatchBudget('turn-1'), 'renderer');
    const semanticCeiling = WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT - WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE;
    for (let i = 0; i < semanticCeiling; i += 1) await semantic.createChatCompletion({ messages: [] });

    await expect(semantic.createChatCompletion({ messages: [] }))
      .rejects.toBeInstanceOf(WeeklyPlanningTurnDispatchBudgetExceededError);
    await expect(renderer.createChatCompletion({ messages: [] })).resolves.toBe('{}');
    await expect(renderer.createChatCompletion({ messages: [] }))
      .rejects.toBeInstanceOf(WeeklyPlanningTurnDispatchBudgetExceededError);
    expect(budget.used).toBe(WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT);
    endWeeklyPlanningTurnDispatchBudget('turn-1');
  });

  it('does not reach the provider once exhausted, and turns do not share a pool', async () => {
    const inner = fakeClient();
    const exhausted = createWeeklyPlanningTurnDispatchBudget(1 + WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE);
    const client = withWeeklyPlanningTurnDispatchBudget(inner, exhausted, 'semantic');
    await client.createChatCompletion({ messages: [] });
    await expect(client.createChatCompletion({ messages: [] })).rejects.toThrow(/budget exhausted/);
    expect(inner.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(beginWeeklyPlanningTurnDispatchBudget('turn-a')).not.toBe(beginWeeklyPlanningTurnDispatchBudget('turn-b'));
    expect(getWeeklyPlanningTurnDispatchBudget('turn-a').used).toBe(0);
    endWeeklyPlanningTurnDispatchBudget('turn-a');
    endWeeklyPlanningTurnDispatchBudget('turn-b');
  });

  it('keeps a valid no-op result instead of failing the turn when the retry budget is exhausted', async () => {
    const document = {
      schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null, tasks: [],
      relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
      uncertainties: [], corrections: [], decisions: [],
    } as unknown as WeeklyPlanningSemanticDocumentV5;
    const recordDecision = vi.fn();
    const run = {
      input: {
        userText: 'うーん', traceRequestId: 'turn-x',
        publicStateSummary: { pendingQuestion: { questionCode: 'missing_effort_estimate', graphRevision: 1 } },
      },
      callTracked: vi.fn(async () => { throw new WeeklyPlanningTurnDispatchBudgetExceededError('semantic', 8); }),
      diagnostics: vi.fn((value: unknown) => value),
      recordDecision,
      addAlgorithmicRepairs: vi.fn(),
    } as unknown as WeeklyPlanningSemanticNormalizerRunV5;

    const result = await tryWeeklyPlanningSemanticNoOpCompletenessRetryV5({
      run, baseMessages: [], initialResponse: '{}', initialDocument: document,
    });

    expect(result?.status).toBe('accepted');
    expect(result?.document).toBe(document);
  });

  it('never reports budget exhaustion in the dense completeness path as a connectivity failure', async () => {
    const turnId = 'turn-dense';
    beginWeeklyPlanningTurnDispatchBudget(turnId);
    const budget = getWeeklyPlanningTurnDispatchBudget(turnId);
    for (let i = 0; i < WEEKLY_PLANNING_TURN_AI_DISPATCH_LIMIT - WEEKLY_PLANNING_TURN_AI_RENDERER_RESERVE; i += 1) {
      budget.consume('semantic');
    }
    const client = withWeeklyPlanningTurnDispatchBudget(fakeClient(), budget, 'semantic');
    const document = {
      schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null, tasks: [],
      relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
      uncertainties: [], corrections: [], decisions: [],
    } as unknown as WeeklyPlanningSemanticDocumentV5;
    const run = {
      input: { userText: 'あ'.repeat(4_000), traceRequestId: turnId, publicStateSummary: {} },
      callTracked: vi.fn(async () => client.createChatCompletion({ messages: [] })),
      callGeneric: vi.fn(async () => client.createChatCompletion({ messages: [] })),
      diagnostics: vi.fn((value: unknown) => value),
      recordDecision: vi.fn(),
      addAlgorithmicRepairs: vi.fn(),
      // A real normalizer run always carries these lists (initialized to []).
      algorithmicRepairs: [],
      responseLengths: [],
    } as unknown as WeeklyPlanningSemanticNormalizerRunV5;

    // null = keep the already valid initial document (not a provider_failure result).
    await expect(tryWeeklyPlanningDenseTurnCompletenessRetryV5({
      run, baseMessages: [], initialResponse: '{}', initialDocument: document,
    })).resolves.toBeNull();
    expect(run.callTracked).toHaveBeenCalledTimes(1);
    endWeeklyPlanningTurnDispatchBudget(turnId);
  });
});
