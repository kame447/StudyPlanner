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
        pendingQuestion: {
          actionId: 'stable-v5:request-debug-1:missing_effort_estimate',
          questionCode: 'missing_effort_estimate',
          targetFactId: 'workload-1',
          graphRevision: 2,
        },
      },
      traceRequestId: 'request-debug-1',
    });

    const events = takeWeeklyPlanningStableV5DebugTrace('request-debug-1');
    const request = events.find((event) => event.stage === 'semantic_provider_request');
    const response = events.find((event) => event.stage === 'semantic_provider_response');
    const validation = events.find((event) => event.stage === 'semantic_validation_result');

    const requestData = request?.data as {
      request?: {
        messages?: Array<{ role: string; content: string }>;
      };
    } | undefined;
    const messages = requestData?.request?.messages ?? [];
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const user = messages.find((message) => message.role === 'user')?.content ?? '{}';
    const userPayload = JSON.parse(user) as {
      userText?: string;
      publicStateSummary?: {
        graphRevision?: number;
        pendingQuestion?: {
          questionCode?: string;
          targetFactId?: string;
          graphRevision?: number;
        };
      };
    };

    expect(system).toContain(
      'Treat publicStateSummary.pendingQuestion as authoritative',
    );
    expect(system).toContain('never infer its target from assistant wording');
    expect(system).toContain(
      'Every sourceText must be supported by current userText, not prior turns',
    );
    expect(system).toContain('target means the amount intended for this plan');
    expect(system).toContain('remaining means the full unfinished amount');
    expect(system).toContain('completed means the amount already done');
    expect(system).toContain('For quantity_role_unresolved');
    expect(system).toContain('Never keep uncertainty for a resolved role');
    expect(system).toContain('For semantic_uncertainty');
    expect(userPayload).toMatchObject({
      userText: '3時間ぐらいかな',
      publicStateSummary: {
        graphRevision: 2,
        pendingQuestion: {
          questionCode: 'missing_effort_estimate',
          targetFactId: 'workload-1',
          graphRevision: 2,
        },
      },
    });
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