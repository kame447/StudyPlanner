import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

const authorizationDocument = JSON.stringify({
  schemaVersion: 'weekly-planning-semantic-v5',
  planningIntent: 'create_plan',
  planningWindow: null,
  tasks: [],
  relations: [],
  availabilityDeclarations: [],
  constraintSourceRequests: [],
  uncertainties: [],
  corrections: [],
  decisions: [],
});

describe('Stable V5 creation authorization ownership', () => {
  it('accepts creation authorization when the AI explicitly returns create_plan', async () => {
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => authorizationDocument),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: 'この条件で予定を作って',
      publicStateSummary: {
        graphRevision: 2,
        tasks: [{ publicId: 'task-1', title: '問題集' }],
      },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      document: {
        planningIntent: 'create_plan',
        planningWindow: null,
        tasks: [],
      },
      diagnostics: {
        attemptCount: 1,
        repairAttempted: false,
        validationErrors: [],
      },
    });
    expect(result.diagnostics.algorithmicRepairs ?? []).not.toContain(
      'creation-authorization-grounded-from-user-text',
    );
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not replace an invalid AI response with a rule-generated authorization document', async () => {
    const invalid = JSON.stringify({
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'create_plan',
      planningWindow: null,
    });
    const client: OpenAiCompatibleClient = {
      createChatCompletion: vi.fn(async () => invalid),
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: 'この条件で予定を作って',
      publicStateSummary: { graphRevision: 2 },
    });

    expect(result.status).toBe('rejected');
    expect(client.createChatCompletion).toHaveBeenCalledTimes(2);
  });
});
