import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningDialogueRendererTrace } from '../trace/weeklyPlanningDialogueRendererTrace';
import {
  evaluateWeeklyPlanningConversationTurnAiUsage,
  maximumWeeklyPlanningRealEvalRequestsForTurns,
  shouldContinueWeeklyPlanningRealEvalAfterScenario,
  summarizeWeeklyPlanningConversationEvalAiUsage,
  WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_API_REQUESTS,
  WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS,
  WEEKLY_PLANNING_REAL_EVAL_MAX_API_REQUESTS_PER_TURN,
  WEEKLY_PLANNING_REAL_EVAL_MAX_TURNS_PER_SCENARIO,
} from './weeklyPlanningConversationEvalExecutionPolicy';

function rendererTrace(params: {
  status?: 'rendered' | 'fallback' | 'bypassed';
  branch?: 'ai_rendered' | 'deterministic_fallback' | 'system_message_bypass';
  responseSource?: 'ai' | 'deterministic_fallback' | 'rules' | 'system';
  withRequest?: boolean;
} = {}): WeeklyPlanningDialogueRendererTrace {
  const status = params.status ?? 'rendered';
  const branch = params.branch ?? 'ai_rendered';
  const responseSource = params.responseSource ?? 'ai';
  return {
    actionId: 'action-1',
    actionKind: 'question',
    questionCode: 'missing_effort_estimate',
    request: params.withRequest === false
      ? null
      : {
          purpose: 'weekly_planning_renderer',
          requiredLabels: [],
          fallbackText: 'どれくらいかかりますか？',
          previewCount: 0,
        },
    response: {
      status,
      reason: status === 'rendered' ? null : 'provider_error',
      rawResponse: status === 'rendered' ? '{}' : null,
      renderedText: status === 'rendered' ? 'どれくらいかかりますか？' : null,
    },
    decision: {
      branch,
      responseSource,
      finalMessage: 'どれくらいかかりますか？',
    },
  };
}

function validUsage() {
  return evaluateWeeklyPlanningConversationTurnAiUsage({
    responseSource: 'ai',
    semanticTrace: [{ stage: 'semantic_provider_request' }],
    dialogueRendererTrace: rendererTrace(),
  });
}

describe('weekly planning real API execution policy', () => {
  it('accepts one semantic request and one AI-rendered response', () => {
    expect(validUsage()).toEqual({
      semanticRequestCount: 1,
      rendererRequestCount: 1,
      totalRequestCount: 2,
      meaningInterpretationUsedAi: true,
      assistantResponseUsedAi: true,
      withinPerTurnRequestBudget: true,
      errors: [],
    });
  });

  it('allows one semantic repair but rejects more than two semantic requests', () => {
    const repaired = evaluateWeeklyPlanningConversationTurnAiUsage({
      responseSource: 'ai',
      semanticTrace: [
        { stage: 'semantic_provider_request', data: { attempt: 'initial' } },
        { stage: 'semantic_provider_request', data: { attempt: 'repair' } },
      ],
      dialogueRendererTrace: rendererTrace(),
    });
    expect(repaired.totalRequestCount).toBe(
      WEEKLY_PLANNING_REAL_EVAL_MAX_API_REQUESTS_PER_TURN,
    );
    expect(repaired.withinPerTurnRequestBudget).toBe(true);

    const excessive = evaluateWeeklyPlanningConversationTurnAiUsage({
      responseSource: 'ai',
      semanticTrace: [
        { stage: 'semantic_provider_request' },
        { stage: 'semantic_provider_request' },
        { stage: 'semantic_provider_request' },
      ],
      dialogueRendererTrace: rendererTrace(),
    });
    expect(excessive.withinPerTurnRequestBudget).toBe(false);
    expect(excessive.errors).toContain(
      'api-request-budget-exceeded:3:1:4',
    );
  });

  it('does not treat deterministic renderer fallback as a successful AI conversation', () => {
    const result = evaluateWeeklyPlanningConversationTurnAiUsage({
      responseSource: 'deterministic_fallback',
      semanticTrace: [{ stage: 'semantic_provider_request' }],
      dialogueRendererTrace: rendererTrace({
        status: 'fallback',
        branch: 'deterministic_fallback',
        responseSource: 'deterministic_fallback',
      }),
    });

    expect(result.meaningInterpretationUsedAi).toBe(true);
    expect(result.assistantResponseUsedAi).toBe(false);
    expect(result.errors).toContain('assistant-response-did-not-use-ai-renderer');
  });

  it('requires a semantic provider request for every accepted turn', () => {
    const result = evaluateWeeklyPlanningConversationTurnAiUsage({
      responseSource: 'ai',
      semanticTrace: [{ stage: 'semantic_pipeline_input' }],
      dialogueRendererTrace: rendererTrace(),
    });

    expect(result.meaningInterpretationUsedAi).toBe(false);
    expect(result.errors).toContain('meaning-interpretation-did-not-use-ai');
  });

  it('stops after the first failed scenario', () => {
    expect(shouldContinueWeeklyPlanningRealEvalAfterScenario('passed')).toBe(true);
    expect(shouldContinueWeeklyPlanningRealEvalAfterScenario('failed')).toBe(false);
  });

  it('caps the suite at eight turns per scenario and 120 total requests', () => {
    expect(WEEKLY_PLANNING_REAL_EVAL_MAX_TURNS_PER_SCENARIO).toBe(8);
    expect(WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS).toBe(40);
    expect(WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_API_REQUESTS).toBe(120);
    expect(maximumWeeklyPlanningRealEvalRequestsForTurns(0)).toBe(0);
    expect(maximumWeeklyPlanningRealEvalRequestsForTurns(16)).toBe(48);
    expect(maximumWeeklyPlanningRealEvalRequestsForTurns(40)).toBe(120);
    expect(maximumWeeklyPlanningRealEvalRequestsForTurns(41)).toBe(120);
    expect(() => maximumWeeklyPlanningRealEvalRequestsForTurns(-1)).toThrow(
      'Invalid turn count: -1',
    );
  });

  it('aggregates only executed turns and carries turn-level AI violations', () => {
    const first = validUsage();
    const second = evaluateWeeklyPlanningConversationTurnAiUsage({
      responseSource: 'deterministic_fallback',
      semanticTrace: [
        { stage: 'semantic_provider_request' },
        { stage: 'semantic_provider_request' },
      ],
      dialogueRendererTrace: rendererTrace({
        status: 'fallback',
        branch: 'deterministic_fallback',
        responseSource: 'deterministic_fallback',
      }),
    });

    expect(summarizeWeeklyPlanningConversationEvalAiUsage([first, second])).toEqual({
      turnCount: 2,
      semanticRequestCount: 3,
      rendererRequestCount: 2,
      totalRequestCount: 5,
      maximumAllowedRequestCount: 6,
      absoluteMaximumTurnCount: 40,
      absoluteMaximumRequestCount: 120,
      allTurnsUsedRequiredAiPaths: false,
      withinSuiteRequestBudget: true,
      errors: ['turn-2:assistant-response-did-not-use-ai-renderer'],
    });
  });

  it('fails the suite summary when the absolute turn budget is exceeded', () => {
    const turns = Array.from(
      { length: WEEKLY_PLANNING_REAL_EVAL_ABSOLUTE_MAX_TURNS + 1 },
      () => validUsage(),
    );
    const summary = summarizeWeeklyPlanningConversationEvalAiUsage(turns);

    expect(summary.withinSuiteRequestBudget).toBe(false);
    expect(summary.errors).toContain('suite-turn-budget-exceeded:41:40');
  });
});
