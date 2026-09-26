import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import {
  createDenseTurnCompletenessAuditMessagesV5,
  createDenseTurnCompletenessRetryMessagesV5,
  denseTurnCompletenessAuditEligibleV5,
  parseDenseTurnCompletenessAuditDecisionV5,
} from './weeklyPlanningSemanticDenseTurnCompletenessV5';

function candidateDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-math',
      existingPublicId: null,
      category: 'study',
      title: '数学',
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '数学を勉強する',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 dense-turn semantic completeness audit', () => {
  it('only enables the extra audit for dense user input', () => {
    expect(denseTurnCompletenessAuditEligibleV5('短い予定です')).toBe(false);
    expect(denseTurnCompletenessAuditEligibleV5('長文'.repeat(700))).toBe(true);
  });

  it('parses complete and incomplete decisions strictly', () => {
    expect(parseDenseTurnCompletenessAuditDecisionV5(JSON.stringify({
      decision: 'complete',
      missingFacts: [],
    }))).toEqual({ decision: 'complete', missingFacts: [] });

    expect(parseDenseTurnCompletenessAuditDecisionV5(JSON.stringify({
      decision: 'incomplete',
      missingFacts: ['物理の学習タスク', '平日の学習可能時間'],
    }))).toEqual({
      decision: 'incomplete',
      missingFacts: ['物理の学習タスク', '平日の学習可能時間'],
    });

    expect(parseDenseTurnCompletenessAuditDecisionV5(JSON.stringify({
      decision: 'complete',
      missingFacts: ['何か'],
    }))).toBeNull();
    expect(parseDenseTurnCompletenessAuditDecisionV5(JSON.stringify({
      decision: 'incomplete',
      missingFacts: [],
    }))).toBeNull();
  });

  it('tells the audit not to reinterpret assessment score as textbook progress', () => {
    const messages = createDenseTurnCompletenessAuditMessagesV5({
      userText: '数学の模試は55%ですが、基礎問題精講を一周したいです。'.repeat(30),
      candidateDocument: candidateDocument(),
    });
    expect(messages[0]?.content).toMatch(/assessment\/mock-exam scores/i);
    expect(messages[0]?.content).toContain('not textbook completion');
    expect(messages[1]?.content).toContain('candidateDocument');
  });

  it('treats an explicit daily total as supported capacity without inventing clocks', () => {
    const messages = createDenseTurnCompletenessAuditMessagesV5({
      userText: '土日は基本的に1日8時間勉強できます。'.repeat(40),
      candidateDocument: candidateDocument(),
    });
    expect(messages[0]?.content).toContain('daily capacity');
    expect(messages[0]?.content).toContain('kind=capacity');
    expect(messages[0]?.content).toContain('capacityMinutes');
    expect(messages[0]?.content).toContain('without inventing a clock window');
  });

  it('asks a retry to regenerate the whole semantic document instead of patching', () => {
    const retry = createDenseTurnCompletenessRetryMessagesV5({
      baseMessages: [{ role: 'system', content: 'base' }],
      priorResponse: '{"prior":true}',
      userText: '数学と物理を進める',
      missingFacts: ['物理の学習タスク'],
    });
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: 'assistant', content: '{"prior":true}' });
    expect(retry[2]?.content).toContain('one complete semantic document, not a patch');
    expect(retry[2]?.content).toContain('物理の学習タスク');
    expect(retry[2]?.content).toContain('Do not convert assessment/mock-exam scores');
  });
});
