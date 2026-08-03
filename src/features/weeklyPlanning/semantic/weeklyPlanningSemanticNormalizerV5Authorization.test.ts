import { describe, expect, it } from 'vitest';
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

describe('Stable V5 creation authorization prompt', () => {
  it('keeps accepted public facts out of a pure authorization response', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client: OpenAiCompatibleClient = {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        return authorizationDocument;
      },
    };

    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: 'この条件で予定を作って',
      publicStateSummary: {
        graphRevision: 2,
        tasks: [{ publicId: 'task-1', title: '問題集' }],
      },
    });

    expect(result.document).toMatchObject({
      planningIntent: 'create_plan',
      tasks: [],
    });
    const messages = calls[0].messages as Array<{ role: string; content: string }>;
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('set planningIntent to create_plan');
    expect(system).toContain('without repeating accepted facts');
    expect(system).toContain('Include only facts explicitly added or changed in the current utterance');
    expect(system).not.toContain('Do not copy accepted tasks or constraints');
  });
});
