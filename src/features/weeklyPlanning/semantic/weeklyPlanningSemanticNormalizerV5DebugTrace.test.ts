import { afterEach, describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function client(responses: string[]): OpenAiCompatibleClient {
  let index = 0;
  return {
    async createChatCompletion() {
      const response = responses[index++];
      if (response === undefined) throw new Error('fake response exhausted');
      return response;
    },
  };
}

afterEach(() => {
  resetWeeklyPlanningStableV5DebugTraceForTest();
});

describe('Stable V5 semantic normalizer debug trace', () => {
  it('records the complete provider request, raw response and parsed document', async () => {
    const rawResponse = JSON.stringify(document());
    const normalizer = createWeeklyPlanningSemanticNormalizerV5(client([rawResponse]));

    await normalizer.normalize({
      userText: '3時間ぐらいかな',
      recentConversation: [
        {
          role: 'assistant',
          content: '院試の過去問を指定した量だけ進めるのに、合計でどれくらい時間がかかりますか？',
        },
      ],
      publicStateSummary: {
        graphRevision: 2,
        lastAssistantMessage: '院試の過去問を指定した量だけ進めるのに、合計でどれくらい時間がかかりますか？',
      },
      traceRequestId: 'request-debug-1',
    });

    const events = takeWeeklyPlanningStableV5DebugTrace('request-debug-1');
    const request = events.find((event) => event.stage === 'semantic_provider_request');
    const response = events.find((event) => event.stage === 'semantic_provider_response');
    const validation = events.find((event) => event.stage === 'semantic_validation_result');

    expect(JSON.stringify(request?.data)).toContain('Use recentConversation and publicStateSummary');
    expect(JSON.stringify(request?.data)).toContain('3時間ぐらいかな');
    expect(response?.data).toMatchObject({
      attempt: 'initial',
      rawResponse,
    });
    expect(validation?.data).toMatchObject({
      attempt: 'initial',
      accepted: true,
      errors: [],
      parsedDocument: document(),
    });
  });

  it('records the invalid response, repair request and repaired response separately', async () => {
    const repaired = JSON.stringify(document());
    const normalizer = createWeeklyPlanningSemanticNormalizerV5(client(['not-json', repaired]));

    await normalizer.normalize({
      userText: '予定を見て',
      traceRequestId: 'request-debug-repair',
    });

    const events = takeWeeklyPlanningStableV5DebugTrace('request-debug-repair');
    expect(events.filter((event) => event.stage === 'semantic_provider_response')).toMatchObject([
      { data: { attempt: 'initial', rawResponse: 'not-json' } },
      { data: { attempt: 'repair', rawResponse: repaired } },
    ]);
    expect(events.find((event) => event.stage === 'semantic_repair_prepared')?.data).toMatchObject({
      invalidResponse: 'not-json',
      validationErrors: ['document:invalid-json'],
    });
  });
});
