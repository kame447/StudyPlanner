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
import { canonicalizeWeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticCanonicalizerV5';
import recordedEffortResponses from './testFixtures/recordedEffortSemanticResponses.json';

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
  it.each([
    { runId: 38057573433, expected: [
      { kind: 'duration_per_unit', minutes: 3, targetLocalId: 'workload-1' },
      { kind: 'session_duration', minutes: 30, targetLocalId: 'task-1' },
    ] },
    { runId: 38064978826, expected: [] },
  ])('preserves captured effort facts without manufacturing missing facts: run $runId', async ({ runId, expected }) => {
    // Recorded provider output is a fixed offline input, not evidence that the new prompt works.
    const captured = recordedEffortResponses.cases.find((row) => row.sourceRunId === runId)!;
    const requests: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
    const normalizer = createWeeklyPlanningSemanticNormalizerV5({
      async createChatCompletion(request) {
        requests.push(request);
        return captured.rawSemanticResponse;
      },
    });
    const normalized = await normalizer.normalize({
      userText: recordedEffortResponses.userText,
      traceRequestId: `captured-effort-${runId}`,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ temperature: 0, maxCompletionTokens: 3200 });
    expect(JSON.parse(requests[0].messages[1].content).userText).toBe(recordedEffortResponses.userText);
    expect(requests[0].messages[0].content).toContain('co-stated kinds remain separate');
    expect(normalized.status).toBe('accepted');
    expect(normalized.document?.tasks.flatMap((task) => task.effortEstimates).map(
      ({ kind, minutes, targetLocalId }) => ({ kind, minutes, targetLocalId }),
    )).toEqual(expected);
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentV5({
      document: normalized.document!,
      context: { conversationId: 'captured-effort', turnId: `turn-${runId}`, expectedRevision: 0,
        userText: recordedEffortResponses.userText },
    });
    expect(canonical.status).toBe('applied');
    expect(canonical.graph.effortEstimates.map(({ kind, minutes, targetFactId }) =>
      ({ kind, minutes, targetFactId }))).toEqual(expected.map(({ kind, minutes, targetLocalId }) =>
      ({ kind, minutes, targetFactId: canonical.localToFactId[targetLocalId] })));
    expect(canonical.graph.workloads).toEqual([
      expect.objectContaining({ amount: 20, quantityRole: 'target', unitCode: 'problem' }),
    ]);
    // This is only the canonicalizer's no-invention boundary. It imposes no future
    // scheduler/recovery policy that every empty effort array must ask a question.
  });

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

    expect(system).toContain('pendingQuestion binds only actual answers to its exact target');
    expect(system).toContain('cannot suppress other explicit contributions');
    expect(system).not.toContain('fresh localIds');
    expect(system).toContain('each sourceText must be supported by current userText');
    expect(system).toContain('target=plan amount');
    expect(system).toContain('remaining=unfinished');
    expect(system).toContain('completed=done');
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
