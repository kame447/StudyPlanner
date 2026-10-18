import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../shared/weeklyPlanningTraceContract';
import {
  prepareWeeklyPlanningTraceServerWrite,
} from './weeklyPlanningTracePrivacy';

const SESSION_ID = 'weekly-trace-123e4567-e89b-12d3-a456-426614174000';
const CONVERSATION_ID = 'weekly-conversation-323e4567-e89b-12d3-a456-426614174000';
const OCCURRED_AT = '2026-07-30T00:00:00.000Z';
const FUTURE_FIELD_SENTINEL = 'renderer-prompt-field-added-after-trace-contract';

function rendererDiagnostic() {
  return {
    id: `${SESSION_ID}-00000000`,
    sessionId: SESSION_ID,
    logicalConversationId: CONVERSATION_ID,
    sequence: 0,
    requestId: 'request-1',
    occurredAt: OCCURRED_AT,
    observedAt: OCCURRED_AT,
    schemaVersion: 2,
    kind: 'turn_diagnostic',
    traceSchema: 'weekly-planning-turn-diagnostic-v2',
    turnIndex: 0,
    userInput: { text: '院試の勉強を進めたい' },
    aiInterpreter: {
      provider: 'openai',
      model: 'gpt-test',
      promptVersion: 'v5',
      input: {
        userText: '院試の勉強を進めたい',
        conversationContext: [],
        planningStateSummary: null,
        requests: [],
      },
      rawResponses: [],
      structuredResults: [],
      candidateOperations: [],
      error: null,
    },
    parsers: [],
    decision: {
      status: 'revision_pending',
      acceptedOperations: [],
      rejectedOperations: [],
      finalOperations: [],
      precedence: null,
      reason: null,
      stateDiff: null,
    },
    constraintContext: {
      existingPlanCount: 0,
      scheduleTemplateCount: 0,
      relevantBusyIntervals: [],
    },
    assistantOutput: {
      text: '今回進めたい量ですか？',
      responseSource: 'ai',
    },
    diagnostics: {
      durationMs: 100,
      fallback: null,
      error: null,
      outcome: 'revision_pending',
      previewCount: 0,
      stale: false,
      dialogueRenderer: {
        actionId: 'stable-v5:request-1:quantity_role_unresolved',
        actionKind: 'question',
        questionCode: 'quantity_role_unresolved',
        request: {
          purpose: 'weekly_planning_renderer',
          requiredLabels: ['院試の勉強'],
          fallbackText: '今回進めたい量か、残っている全体量か教えてください。',
          previewCount: 0,
          promptContext: {
            messages: [
              { role: 'system', content: '返答を考えてください。' },
              { role: 'user', content: '{"currentUserMessage":"どういうこと？"}' },
            ],
            requestBytes: 256,
            futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
          },
        },
        response: {
          status: 'rendered',
          reason: null,
          rawResponse: '{"actionId":"stable-v5:request-1:quantity_role_unresolved","text":"今回進めたい量ですか？"}',
          renderedText: '今回進めたい量ですか？',
        },
        decision: {
          branch: 'ai_rendered',
          responseSource: 'ai',
          finalMessage: '今回進めたい量ですか？',
        },
      },
    },
  };
}

describe('weekly planning renderer diagnostic Worker compatibility', () => {
  it('accepts and preserves the renderer diagnostic after server preparation', () => {
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: {
        id: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
        status: 'active',
        startedAt: OCCURRED_AT,
        lastActivityAt: OCCURRED_AT,
        turnCount: 1,
        entryCount: 1,
        hasPreview: false,
        hasApprovalFailure: false,
        hasFallback: false,
        hasError: false,
        appVersion: 'test',
        schemaVersion: 2,
      },
      entries: [rendererDiagnostic()],
    }, { token: 'wpt_fixture', epoch: '100' }, {
      sessionId: SESSION_ID,
      logicalConversationId: CONVERSATION_ID,
    }, OCCURRED_AT);

    const diagnostics = prepared.entries[0].diagnostics as Record<string, unknown>;
    const renderer = diagnostics.dialogueRenderer as Record<string, unknown>;
    const request = renderer.request as Record<string, unknown>;
    expect(renderer).toMatchObject({
      actionKind: 'question',
      questionCode: 'quantity_role_unresolved',
      decision: {
        branch: 'ai_rendered',
        responseSource: 'ai',
      },
    });
    expect(request.promptContext).toMatchObject({
      futurePromptFieldAddedWithoutTraceSchemaChange: FUTURE_FIELD_SENTINEL,
    });
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});