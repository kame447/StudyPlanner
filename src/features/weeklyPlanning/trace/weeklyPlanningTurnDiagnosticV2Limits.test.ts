import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import type { WeeklyPlanningStableV5DebugTraceEvent } from './weeklyPlanningStableV5DebugTrace';
import { createWeeklyPlanningTurnDiagnosticV2 } from './weeklyPlanningTurnDiagnosticV2';

function event(
  sequence: number,
  stage: string,
  data: unknown,
): WeeklyPlanningStableV5DebugTraceEvent {
  return {
    schemaVersion: 1,
    sequence,
    stage,
    occurredAt: new Date(Date.UTC(2026, 6, 29) + sequence).toISOString(),
    severity: 'debug',
    data,
  };
}

describe('weekly planning turn diagnostic limits', () => {
  it('keeps a pathological turn below the client document target and records truncation', () => {
    const longText = '長い診断文字列'.repeat(2_000);
    const busyEvents = Array.from({ length: 500 }, (_, index) => ({
      start: { date: '2026-08-01', time: `${String(index % 24).padStart(2, '0')}:00` },
      end: { date: '2026-08-01', time: `${String((index + 1) % 24).padStart(2, '0')}:00` },
    }));
    const events: WeeklyPlanningStableV5DebugTraceEvent[] = [
      event(0, 'runtime_turn_input', {
        inputCounts: { existingPlanCount: 5_000, scheduleTemplateCount: 500 },
      }),
      event(1, 'semantic_pipeline_input', {
        recentConversation: Array.from({ length: 100 }, (_, index) => ({
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: longText,
        })),
        publicStateSummary: { summary: longText },
      }),
      ...Array.from({ length: 5 }, (_, index) => event(10 + index, 'semantic_provider_request', {
        attempt: `attempt-${index}`,
        requestBytes: 100_000,
        request: {
          messages: Array.from({ length: 20 }, () => ({ role: 'user', content: longText })),
          purpose: longText,
          responseFormat: { schema: longText },
          maxCompletionTokens: 10_000,
        },
      })),
      ...Array.from({ length: 5 }, (_, index) => event(20 + index, 'semantic_provider_response', {
        attempt: `attempt-${index}`,
        rawResponse: longText,
      })),
      ...Array.from({ length: 5 }, (_, index) => event(30 + index, 'semantic_validation_result', {
        attempt: `attempt-${index}`,
        accepted: index === 4,
        errors: Array.from({ length: 50 }, () => longText),
        parsedDocument: {
          tasks: Array.from({ length: 200 }, (_, taskIndex) => ({
            localId: `task-${taskIndex}`,
            sourceText: longText,
          })),
        },
      })),
      event(40, 'contextual_question_inference', {
        lastAssistantMessage: longText,
        rules: Array.from({ length: 100 }, (_, index) => ({
          code: `rule-${index}`,
          criterion: `lastAssistantMessage.includes("rule-${index}")`,
          matched: index === 0,
        })),
        selectedQuestionCode: 'rule-0',
      }),
      event(41, 'contextual_answer_binding_evaluated', {
        contextualAnswerApplied: true,
        contextualAnswerResult: { diff: longText },
      }),
      event(42, 'semantic_canonicalization_evaluated', {
        branch: 'contextual_answer_binding',
        result: { status: 'applied' },
        adoptedOperations: {
          fromRevision: 1,
          toRevision: 2,
          added: Array.from({ length: 200 }, () => ({ value: longText })),
          superseded: [],
          removed: [],
        },
        rejectionErrors: Array.from({ length: 100 }, () => longText),
      }),
      event(43, 'runtime_scheduler_dialogue_evaluated', {
        schedulerInput: {
          externalSources: [{ kind: 'existing_plan', events: busyEvents }],
        },
      }),
    ];

    const diagnostic = createWeeklyPlanningTurnDiagnosticV2({
      id: 'trace-1-00000000',
      sessionId: 'trace-1',
      logicalConversationId: 'conversation-1',
      sequence: 0,
      turnIndex: 0,
      requestId: 'request-1',
      occurredAt: '2026-07-29T00:00:00.000Z',
      observedAt: '2026-07-29T00:00:01.000Z',
      expireAt: '2027-01-25T00:00:00.000Z',
      userText: longText,
      assistantMessage: longText,
      outcome: 'revision_pending',
      previewCount: 0,
      debugTraceEvents: events,
    });
    const truncation = (diagnostic.diagnostics as typeof diagnostic.diagnostics & {
      truncation: {
        applied: boolean;
        fields: string[];
        originalCounts: Record<string, number>;
      };
    }).truncation;

    expect(measureWeeklyPlanningTraceJsonBytes(diagnostic))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    expect(truncation.applied).toBe(true);
    expect(truncation.fields).toContain('constraintContext.relevantBusyIntervals');
    expect(truncation.originalCounts['constraintContext.relevantBusyIntervals']).toBe(500);
    expect(diagnostic.constraintContext.relevantBusyIntervals.length).toBeLessThanOrEqual(100);
    expect(diagnostic.aiInterpreter.rawResponses.length).toBeLessThanOrEqual(2);
    expect(diagnostic.aiInterpreter.input.requests.length).toBeLessThanOrEqual(2);
  });
});
