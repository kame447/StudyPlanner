import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';

function createRepositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return { repository, writes };
}

function debugEvent(params: {
  sequence: number;
  stage: string;
  data: unknown;
  severity?: 'debug' | 'info' | 'warn' | 'error';
}) {
  return {
    schemaVersion: 2 as const,
    sequence: params.sequence,
    stage: params.stage,
    occurredAt: `2026-07-29T00:00:${String(params.sequence).padStart(2, '0')}.000Z`,
    severity: params.severity ?? 'debug' as const,
    data: params.data,
  };
}

function diagnostic(entries: WeeklyPlanningTraceEntry[]): WeeklyPlanningTraceTurnDiagnosticEntry {
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  if (entry.kind !== 'turn_diagnostic') throw new Error('expected turn diagnostic');
  return entry;
}

beforeEach(() => {
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});

afterEach(() => {
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
});

describe('Stable V5 compact diagnostic projection', () => {
  it('stores actual AI request, raw response, parsed operations and validation separately', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-1',
      requestId: 'conversation-1:request:4',
      userText: '来週、英語を3時間やりたい',
      assistantMessage: '条件を整理しました。',
      outcome: 'revision_pending',
      debugTraceEvents: [
        debugEvent({
          sequence: 0,
          stage: 'runtime_configuration_evaluated',
          data: { provider: 'openai', model: 'gpt-test' },
        }),
        debugEvent({
          sequence: 1,
          stage: 'semantic_normalizer_prepared',
          data: { normalizerVersion: 'weekly-planning-semantic-normalizer-v5' },
        }),
        debugEvent({
          sequence: 2,
          stage: 'semantic_pipeline_input',
          data: {
            userText: '来週、英語を3時間やりたい',
            recentConversation: [{ role: 'assistant', content: '何をしますか？' }],
            publicStateSummary: { graphRevision: 3, taskCount: 0 },
          },
        }),
        debugEvent({
          sequence: 3,
          stage: 'semantic_provider_request',
          data: {
            attempt: 'initial',
            requestBytes: 321,
            request: {
              messages: [
                { role: 'system', content: 'actual system prompt' },
                { role: 'user', content: 'actual structured user prompt' },
              ],
              purpose: 'weekly_planning_semantic_normalizer',
              responseFormat: { type: 'json_schema' },
              maxCompletionTokens: 3200,
            },
          },
        }),
        debugEvent({
          sequence: 4,
          stage: 'semantic_provider_response',
          data: {
            attempt: 'initial',
            rawResponse: '{"planningWindow":{"sourceText":"来週"},"tasks":[{"sourceText":"英語を3時間"}]}',
          },
        }),
        debugEvent({
          sequence: 5,
          stage: 'semantic_validation_result',
          data: {
            attempt: 'initial',
            accepted: true,
            errors: [],
            parsedDocument: {
              planningIntent: 'collect_requirements',
              planningWindow: { sourceText: '来週' },
              tasks: [{ sourceText: '英語を3時間' }],
              relations: [],
              availabilityDeclarations: [],
              constraintSourceRequests: [],
              uncertainties: [],
              corrections: [],
              decisions: [],
            },
          },
        }),
        debugEvent({
          sequence: 6,
          stage: 'semantic_canonicalization_evaluated',
          data: {
            branch: 'semantic_canonicalizer',
            result: { status: 'accepted' },
            adoptedOperations: [
              { operation: 'set_planning_window', sourceText: '来週' },
              { operation: 'add_task', sourceText: '英語を3時間' },
            ],
            rejectionErrors: [],
          },
        }),
      ],
      previewCount: 0,
    });

    const entry = diagnostic(harness.writes[0].entries);
    expect(entry.aiInterpreter).toMatchObject({
      provider: 'openai',
      model: 'gpt-test',
      promptVersion: 'weekly-planning-semantic-normalizer-v5',
    });
    expect(entry.aiInterpreter.input).toMatchObject({
      userText: '来週、英語を3時間やりたい',
      conversationContext: [{ role: 'assistant', content: '何をしますか？' }],
      planningStateSummary: { graphRevision: 3, taskCount: 0 },
    });
    expect(entry.aiInterpreter.input.requests[0].messages).toEqual([
      { role: 'system', content: 'actual system prompt' },
      { role: 'user', content: 'actual structured user prompt' },
    ]);
    expect(entry.aiInterpreter.rawResponses[0]).toMatchObject({
      attempt: 'initial',
      text: expect.stringContaining('planningWindow'),
      truncated: false,
    });
    expect(entry.aiInterpreter.structuredResults).toEqual([
      expect.objectContaining({ attempt: 'initial', accepted: true, errors: [] }),
    ]);
    expect(entry.aiInterpreter.candidateOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'planning_window' }),
      expect.objectContaining({ kind: 'task' }),
    ]));
  });

  it('persists entry routing plus generic semantic repair without dropping the third provider call', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const attempts = ['entry_routing', 'initial', 'repair'] as const;
    const events = attempts.flatMap((attempt, index) => [
      debugEvent({
        sequence: index * 3,
        stage: 'semantic_provider_request',
        data: {
          attempt,
          requestBytes: 300 + index,
          request: {
            messages: [
              { role: 'system', content: `${attempt} system prompt` },
              { role: 'user', content: `${attempt} user prompt` },
            ],
            purpose: attempt === 'entry_routing'
              ? 'weekly_planning_interpreter'
              : 'weekly_planning_semantic_normalizer',
            responseFormat: { type: 'json_schema' },
            maxCompletionTokens: attempt === 'entry_routing' ? 40 : 3200,
          },
        },
      }),
      debugEvent({
        sequence: index * 3 + 1,
        stage: 'semantic_provider_response',
        data: {
          attempt,
          rawResponse: JSON.stringify({ attempt }),
        },
      }),
      debugEvent({
        sequence: index * 3 + 2,
        stage: 'semantic_validation_result',
        data: {
          attempt,
          accepted: attempt !== 'initial',
          errors: attempt === 'initial' ? ['repair required'] : [],
          parsedDocument: { attempt },
        },
      }),
    ]);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-three-provider-calls',
      requestId: 'conversation-three-provider-calls:request:1',
      userText: '来週の勉強予定を立てたい',
      assistantMessage: '何を進めますか？',
      outcome: 'revision_pending',
      debugTraceEvents: events,
      previewCount: 0,
    });

    const entry = diagnostic(harness.writes[0].entries);
    expect(entry.aiInterpreter.input.requests.map((request) => request.attempt)).toEqual(attempts);
    expect(entry.aiInterpreter.rawResponses.map((response) => response.attempt)).toEqual(attempts);
    expect(entry.aiInterpreter.structuredResults.map((result) => result.attempt)).toEqual(attempts);
    expect(entry.diagnostics.truncation?.fields ?? []).not.toEqual(expect.arrayContaining([
      'aiInterpreter.input.requests',
      'aiInterpreter.rawResponses',
      'aiInterpreter.structuredResults',
    ]));
  });

  it('records parser name, matched text, candidate, acceptance and reason', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-parser',
      requestId: 'conversation-parser:request:1',
      userText: '3時間です',
      assistantMessage: '条件を整理しました。',
      outcome: 'revision_pending',
      debugTraceEvents: [
        debugEvent({
          sequence: 0,
          stage: 'contextual_question_inference',
          data: {
            lastAssistantMessage: '英語を指定した量だけ進めるのに、合計でどれくらい時間がかかりますか？',
            rules: [{
              code: 'missing_effort_estimate',
              criterion: 'lastAssistantMessage.includes("合計でどれくらい時間")',
              matched: true,
            }],
            selectedQuestionCode: 'missing_effort_estimate',
          },
        }),
        debugEvent({
          sequence: 1,
          stage: 'contextual_answer_binding_evaluated',
          data: {
            questionCode: 'missing_effort_estimate',
            contextualAnswerApplied: true,
            contextualAnswerResult: {
              status: 'accepted',
              diff: [{ operation: 'set_effort_minutes', minutes: 180 }],
            },
          },
        }),
        debugEvent({
          sequence: 2,
          stage: 'semantic_canonicalization_evaluated',
          data: {
            branch: 'contextual_answer_binding',
            result: { status: 'accepted' },
            adoptedOperations: [{ operation: 'set_effort_minutes', minutes: 180 }],
            rejectionErrors: [],
          },
        }),
      ],
      previewCount: 0,
    });

    const entry = diagnostic(harness.writes[0].entries);
    expect(entry.parsers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parser: 'stable_v5_contextual_question',
        matchedText: '合計でどれくらい時間',
        accepted: true,
      }),
      expect.objectContaining({
        parser: 'stable_v5_contextual_answer_binding',
        matchedText: '合計でどれくらい時間',
        accepted: true,
      }),
    ]));
  });

  it('stores a large raw AI response as head-tail metadata without chunks', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const rawResponse = `HEAD-${'あ'.repeat(10_000)}-TAIL`;

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-large',
      requestId: 'conversation-large:request:1',
      userText: '応答を記録する',
      assistantMessage: '記録しました。',
      outcome: 'revision_pending',
      debugTraceEvents: [debugEvent({
        sequence: 0,
        stage: 'semantic_provider_response',
        data: { attempt: 'initial', rawResponse },
      })],
      previewCount: 0,
    });

    const entry = diagnostic(harness.writes[0].entries);
    const response = entry.aiInterpreter.rawResponses[0];
    const serialized = JSON.stringify(entry);
    expect(response.truncated).toBe(true);
    expect(response.originalBytes).toBe(new TextEncoder().encode(rawResponse).byteLength);
    expect(response.checksum).toMatch(/^fnv1a32:/);
    expect(response.text).toContain('HEAD-');
    expect(response.text).toContain('-TAIL');
    expect(response.text).not.toBe(rawResponse);
    expect(serialized).not.toContain('dataChunk');
    expect(serialized).not.toContain('chunkIndex');
    expect(serialized).not.toContain('base64_utf8_json_chunk');
  });

  it('records stale disposal inside the same logical diagnostic record', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-stale',
      requestId: 'conversation-stale:request:1',
      userText: 'この条件で予定を作って',
      outcome: 'discarded_stale',
      debugTraceEvents: [debugEvent({
        sequence: 0,
        stage: 'runtime_branch_selected',
        data: { branch: 'preview_ready' },
      })],
      previewCount: 0,
      errorCode: 'stale_async_result_discarded',
    });

    const entry = diagnostic(harness.writes[0].entries);
    expect(entry.assistantOutput.text).toBeNull();
    expect(entry.assistantOutput.responseSource).toBe('system');
    expect(entry.diagnostics).toMatchObject({
      stale: true,
      previewCount: 0,
      error: {
        type: 'stale_async_result_discarded',
        message: 'stale_async_result_discarded',
      },
    });
    expect(harness.writes[0].session).toMatchObject({
      entryCount: 1,
      turnCount: 1,
      hasPreview: false,
      hasError: true,
    });
  });
});
