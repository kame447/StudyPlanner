import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_REQUIREMENT_IDS,
  aggregateWeeklyPlanningEvaluationMetrics,
  createDefaultRequirementMatrix,
  evaluateCasePassed,
  redactWeeklyPlanningReplay,
  validateRequirementMatrix,
  type WeeklyPlanningEvaluationCaseResult,
} from './weeklyPlanningConversationEvaluation';

function caseResult(overrides: Partial<WeeklyPlanningEvaluationCaseResult> = {}): WeeklyPlanningEvaluationCaseResult {
  return {
    caseId: 'case-1',
    requirementIds: ['DA-EVAL-001'],
    strictResults: [{ assertionId: 'assertion-1', passed: true }],
    rubricResults: [
      { rubricId: 'no_reask', score: 2 },
      { rubricId: 'concise', score: 1 },
    ],
    callCount: 2,
    latencyMs: 100,
    previewCompleted: true,
    ...overrides,
  };
}

describe('weeklyPlanningConversationEvaluation', () => {
  it('keeps every canonical requirement exactly once', () => {
    const matrix = createDefaultRequirementMatrix();
    expect(matrix.map((row) => row.requirementId)).toEqual(WEEKLY_PLANNING_REQUIREMENT_IDS);
    expect(validateRequirementMatrix(matrix)).toMatchObject({
      valid: true,
      missing: [],
      duplicates: [],
      unknown: [],
    });

    const duplicate = validateRequirementMatrix([...matrix, matrix[0]]);
    expect(duplicate.valid).toBe(false);
    expect(duplicate.duplicates).toEqual(['DA-GOAL-001']);
  });

  it('redacts prompt, token and nested secrets from replay fixtures', () => {
    expect(redactWeeklyPlanningReplay({
      userText: '英語を進めたい',
      prompt: 'private prompt',
      nested: { apiKey: 'abc', token: 'def', publicValue: 3 },
    })).toEqual({
      userText: '英語を進めたい',
      prompt: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', token: '[REDACTED]', publicValue: 3 },
    });
  });

  it('separates strict pass/fail from mentor rubric metrics', () => {
    const results = [
      caseResult(),
      caseResult({
        caseId: 'case-2',
        strictResults: [{ assertionId: 'assertion-2', passed: false }],
        rubricResults: [{ rubricId: 'no_reask', score: 0 }],
        providerFailure: true,
        fallbackCategory: 'interpreter_failure',
        latencyMs: 300,
      }),
    ];
    expect(evaluateCasePassed(results[0])).toBe(true);
    expect(evaluateCasePassed(results[1])).toBe(false);

    const metrics = aggregateWeeklyPlanningEvaluationMetrics(results);
    expect(metrics.strictPassRate).toBe(0.5);
    expect(metrics.rubricAverage).toBe(1);
    expect(metrics.noReaskRate).toBe(0.5);
    expect(metrics.fallbackRate).toBe(0.5);
    expect(metrics.providerFailureRate).toBe(0.5);
    expect(metrics.p50LatencyMs).toBe(100);
    expect(metrics.p95LatencyMs).toBe(300);
  });

  it('treats forbidden side effects as strict failure', () => {
    expect(evaluateCasePassed(caseResult({
      strictResults: [{
        assertionId: 'no-save-before-approval',
        passed: true,
        forbiddenResultObserved: true,
      }],
    }))).toBe(false);
  });
});
