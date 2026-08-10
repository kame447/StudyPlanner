import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticEvidenceV5,
} from './weeklyPlanningSemanticEvidenceV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  validateWeeklyPlanningSemanticValueV5,
} from './weeklyPlanningSemanticValidatorV5';

function baseDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
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

describe('Stable V5 durable user planning context semantic boundary', () => {
  it('requires userContextFacts at the provider JSON schema boundary', () => {
    const schema = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toContain('userContextFacts');
    expect(schema.properties).toHaveProperty('userContextFacts');
  });

  it('accepts event occurrence and concern as owner context without a work deadline', () => {
    const value = {
      ...baseDocument(),
      tasks: [{
        localId: 'task-exam-prep',
        category: 'study',
        title: '模試の勉強',
        study: {
          purpose: 'exam',
          contextLabel: '模試',
          components: [{
            localId: 'component-math',
            parentLocalId: null,
            role: 'subject',
            label: '数学',
            workloads: [],
            sourceText: '数学の勉強も進めたい',
          }],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '模試の勉強も進めたい',
      }],
      userContextFacts: [
        {
          localId: 'context-event',
          kind: 'goal_event',
          label: '模試',
          value: null,
          dateExpression: 'custom:2週間後',
          sourceText: '2週間後に模試がある',
        },
        {
          localId: 'context-concern',
          kind: 'concern',
          label: '数学',
          value: '不安があり優先度が高い',
          dateExpression: null,
          sourceText: '数学がかなり不安',
        },
      ],
    };

    const validation = validateWeeklyPlanningSemanticValueV5(value);
    expect(validation.errors).toEqual([]);
    expect(validation.document?.tasks[0]?.temporalConstraints).toEqual([]);
    expect(validation.document?.userContextFacts).toHaveLength(2);
  });

  it('keeps current-turn grounding for durable context even outside pending-question turns', () => {
    const document: WeeklyPlanningSemanticDocumentV5 = {
      ...baseDocument(),
      userContextFacts: [{
        localId: 'context-event',
        kind: 'goal_event',
        label: '資格試験',
        value: null,
        dateExpression: 'next_week',
        sourceText: '来週資格試験がある',
      }],
    };
    expect(validateWeeklyPlanningSemanticEvidenceV5({
      document,
      input: { userText: '今日は英語を進めたいです' },
    })).toEqual([
      'document.userContextFacts[0].sourceText:not-grounded-in-current-user-text',
    ]);
  });

  it('removes a copied stored user-context fact deterministically without a second AI call', async () => {
    const stale = JSON.stringify({
      ...baseDocument(),
      userContextFacts: [{
        localId: 'stale-context',
        kind: 'concern',
        label: '数学',
        value: '苦手',
        dateExpression: null,
        sourceText: '数学が苦手です',
      }],
    });
    let callCount = 0;
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        callCount += 1;
        return stale;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '今日は英語を進めたいです',
      publicStateSummary: {
        userPlanningContext: [{
          id: 'stored-context',
          kind: 'concern',
          label: '数学',
          value: '苦手',
        }],
      },
    });

    expect(result.status).toBe('accepted');
    expect(callCount).toBe(1);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
    });
    expect(result.diagnostics.algorithmicRepairs).toContain(
      'copied-user-context-fact-removed:0:concern:数学',
    );
    expect(result.document?.userContextFacts ?? []).toEqual([]);
  });

  it('states the generic event-vs-work-deadline rule without scenario-specific patches', () => {
    const prompt = createWeeklyPlanningSemanticSystemPromptV5();
    expect(prompt).toContain('event itself occurs is not a work deadline');
    expect(prompt).toContain('goal_event');
    expect(prompt).toContain('concern');
    expect(prompt).not.toContain('共通テスト模試');
    expect(prompt).not.toContain('2週間後');
  });
});