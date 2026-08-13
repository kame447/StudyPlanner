import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

describe('Stable V5 component parent normalization integration', () => {
  it('normalizes a containing task parent without consuming the AI repair attempt', async () => {
    const response = JSON.stringify({
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      planningIntent: 'update_plan',
      planningWindow: null,
      tasks: [{
        localId: 'task-math-study',
        category: 'study',
        title: '数学の勉強',
        study: {
          purpose: 'self_study',
          contextLabel: null,
          components: [{
            localId: 'component-math',
            parentLocalId: 'task-math-study',
            role: 'subject',
            label: '数学',
            workloads: [],
            durableContextSignals: [],
            sourceText: '数学を勉強したいです',
          }],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [],
        sourceText: '数学を勉強したいです',
      }],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    });
    let calls = 0;
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        calls += 1;
        return response;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '数学を勉強したいです',
    });

    expect(result.status).toBe('accepted');
    expect(calls).toBe(1);
    expect(result.diagnostics).toMatchObject({
      attemptCount: 1,
      repairAttempted: false,
    });
    expect(result.diagnostics.algorithmicRepairs).toContain(
      'component-parent-task-reference-normalized:task-math-study:component-math',
    );
    expect(result.document?.tasks[0]?.study?.components[0]?.parentLocalId).toBeNull();
  });
});
