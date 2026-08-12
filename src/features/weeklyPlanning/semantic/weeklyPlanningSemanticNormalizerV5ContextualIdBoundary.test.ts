import { describe, expect, it } from 'vitest';
import type {
  OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

type ClientRequest = Parameters<OpenAiCompatibleClient['createChatCompletion']>[0];

function focusedFallback(): string {
  return JSON.stringify({
    decision: 'fallback',
    minutes: null,
    precision: null,
    quantityRole: null,
  });
}

function invalidPublicIdUncertainty(): string {
  return JSON.stringify({
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [{
      localId: 'uncertainty-role',
      targetLocalId: 'wpf_workload_existing-public-id',
      field: 'quantityRole',
      reason: 'The current answer resolves the role to target.',
      sourceText: '今回進めたい量です',
    }],
    corrections: [],
    decisions: [],
  });
}

function repairedLocalAnswer(): string {
  return JSON.stringify({
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'answer-task',
      category: 'study',
      title: '直前の質問対象',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'answer-workload',
        quantityRole: 'target',
        amount: 2,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '今回進めたい量です',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '今回進めたい量です',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 contextual ID boundary', () => {
  it('keeps public-ID repair in the generic fallback path without treating public IDs as local IDs', async () => {
    const calls: ClientRequest[] = [];
    const responses = [focusedFallback(), invalidPublicIdUncertainty(), repairedLocalAnswer()];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(request) {
        calls.push(request);
        const response = responses.shift();
        if (!response) throw new Error('response sequence exhausted');
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '今回進めたい量です',
      publicStateSummary: {
        graphRevision: 2,
        pendingQuestion: {
          actionId: 'ask-quantity-role',
          questionCode: 'quantity_role_unresolved',
          targetFactId: 'wpf_workload_existing-public-id',
          graphRevision: 2,
        },
        workloads: [{
          publicId: 'wpf_workload_existing-public-id',
          quantityRole: 'declared',
          amount: 2,
          unitCode: 'hour',
          unitLabel: '時間',
        }],
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
    });
    expect(result.document?.uncertainties).toEqual([]);
    expect(result.document?.tasks).toEqual([
      expect.objectContaining({
        localId: 'answer-task',
        study: expect.objectContaining({
          purpose: 'self_study',
        }),
        workloads: [
          expect.objectContaining({
            localId: 'answer-workload',
            quantityRole: 'target',
            amount: 2,
            unitCode: 'hour',
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(result.document)).not.toContain(
      'wpf_workload_existing-public-id',
    );
    expect(calls).toHaveLength(3);
    expect(calls[0]?.responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_focused_contextual_answer_v5' },
    });

    const systemPrompt = calls[1]?.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('fresh localIds');
    expect(systemPrompt).toContain(
      'target means the amount intended for this plan',
    );
    expect(systemPrompt).toContain(
      'Never keep uncertainty for a resolved role',
    );
    expect(systemPrompt).toContain(
      'public Fact IDs in targetLocalId',
    );

    const repairMessages = calls[2]?.messages ?? [];
    const repairMessage = repairMessages[repairMessages.length - 1]?.content ?? '{}';
    const repairPayload = JSON.parse(repairMessage) as {
      requiredChanges?: string[];
    };
    expect(repairPayload.requiredChanges).toEqual([
      expect.stringContaining(
        'Never copy a publicStateSummary publicId into targetLocalId',
      ),
    ]);
    expect(repairPayload.requiredChanges).toEqual([
      expect.stringContaining(
        'remove the uncertainty and emit one minimal local task and workload',
      ),
    ]);
  });
});
