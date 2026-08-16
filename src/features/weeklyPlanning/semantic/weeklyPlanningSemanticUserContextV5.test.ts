import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
  createWeeklyPlanningSemanticMeaningPolicyV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';
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

  it('keeps deadline semantics without pinning the contract to one English sentence', () => {
    const prompt = createWeeklyPlanningSemanticMeaningPolicyV5();
    expect(
      WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.some(
        (rule) => rule.id === 'temporal_scope_and_deadline',
      ),
    ).toBe(true);
    expect(prompt).not.toContain('otherwise an event date is a goal event');
    expect(prompt).not.toContain('goal event');
    expect(prompt).not.toContain('共通テスト模試');
    expect(prompt).not.toContain('2週間後');
  });
});
