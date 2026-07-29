import { describe, expect, it } from 'vitest';
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
    occurredAt: `2026-07-29T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    severity: 'debug',
    data,
  };
}

describe('createWeeklyPlanningTurnDiagnosticV2', () => {
  it('records parser precedence, rejected AI candidates and the applied fact diff', () => {
    const stateDiff = {
      fromRevision: 3,
      toRevision: 4,
      added: [{ kind: 'effort_estimate', id: 'effort-1' }],
      superseded: [],
      removed: [],
    };
    const events: WeeklyPlanningStableV5DebugTraceEvent[] = [
      event(0, 'runtime_turn_input', {
        inputCounts: { existingPlanCount: 500, scheduleTemplateCount: 20 },
      }),
      event(1, 'semantic_validation_result', {
        attempt: 'initial',
        accepted: true,
        errors: [],
        parsedDocument: {
          planningIntent: 'collect_requirements',
          planningWindow: null,
          tasks: [{ localId: 'task-1', sourceText: '英語を3時間' }],
          relations: [],
          availabilityDeclarations: [],
          constraintSourceRequests: [],
          uncertainties: [],
          corrections: [],
          decisions: [],
        },
      }),
      event(2, 'contextual_question_inference', {
        lastAssistantMessage: '合計でどれくらい時間がかかりますか？',
        rules: [{
          code: 'missing_effort_estimate',
          criterion: 'lastAssistantMessage.includes("合計でどれくらい時間")',
          matched: true,
        }],
        selectedQuestionCode: 'missing_effort_estimate',
      }),
      event(3, 'contextual_answer_binding_evaluated', {
        questionCode: 'missing_effort_estimate',
        contextualAnswerApplied: true,
        contextualAnswerResult: {
          status: 'accepted',
          diff: stateDiff,
        },
      }),
      event(4, 'semantic_canonicalization_evaluated', {
        branch: 'contextual_answer_binding',
        result: { status: 'applied' },
        adoptedOperations: stateDiff,
        rejectionErrors: [],
      }),
      event(5, 'runtime_scheduler_dialogue_evaluated', {
        schedulerInput: {
          externalSources: [{
            kind: 'existing_plan',
            events: [{
              start: { date: '2026-08-03', time: '18:00' },
              end: { date: '2026-08-03', time: '20:00' },
            }],
          }],
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
      observedAt: '2026-07-29T00:00:06.000Z',
      expireAt: '2027-01-25T00:00:00.000Z',
      userText: '3時間です',
      assistantMessage: '3時間として整理しました。',
      outcome: 'revision_pending',
      previewCount: 0,
      debugTraceEvents: events,
    });

    expect(diagnostic.parsers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parser: 'stable_v5_contextual_answer_binding',
        inputText: '3時間です',
        matchedText: '合計でどれくらい時間',
        accepted: true,
        reason: null,
      }),
    ]));
    expect(diagnostic.decision.acceptedOperations).toEqual([{
      source: 'parser',
      operation: stateDiff,
    }]);
    expect(diagnostic.decision.rejectedOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: expect.objectContaining({ source: 'ai' }),
        reason: expect.stringContaining('parser result took precedence'),
      }),
    ]));
    expect(diagnostic.decision.finalOperations).toEqual([stateDiff]);
    expect(diagnostic.decision.stateDiff).toEqual(stateDiff);
    expect(diagnostic.constraintContext).toEqual({
      existingPlanCount: 500,
      scheduleTemplateCount: 20,
      relevantBusyIntervals: [{
        date: '2026-08-03',
        start: '18:00',
        end: '20:00',
        source: 'existing_plan',
      }],
    });
  });

  it('records schema validation rejection without storing stack or full runtime state', () => {
    const diagnostic = createWeeklyPlanningTurnDiagnosticV2({
      id: 'trace-1-00000000',
      sessionId: 'trace-1',
      logicalConversationId: 'conversation-1',
      sequence: 0,
      turnIndex: 0,
      requestId: 'request-1',
      occurredAt: '2026-07-29T00:00:00.000Z',
      observedAt: '2026-07-29T00:00:02.000Z',
      expireAt: '2027-01-25T00:00:00.000Z',
      userText: '予定を作りたい',
      assistantMessage: '内容を言い換えてください。',
      outcome: 'stable_v5_normalization_rejected',
      previewCount: 0,
      errorCode: 'weekly_planning_normalization_rejected',
      debugTraceEvents: [
        event(0, 'semantic_validation_result', {
          attempt: 'repair',
          accepted: false,
          errors: ['tasks must be an array'],
          parsedDocument: null,
        }),
        event(1, 'semantic_provider_error', {
          error: {
            name: 'ProviderError',
            message: 'invalid response',
            stack: 'secret stack',
          },
        }),
      ],
    });

    expect(diagnostic.aiInterpreter.structuredResults).toEqual([{
      attempt: 'repair',
      accepted: false,
      errors: ['tasks must be an array'],
      structuredResult: null,
    }]);
    expect(diagnostic.decision.rejectedOperations).toEqual([{
      operation: {
        source: 'ai',
        attempt: 'repair',
        structuredResult: null,
      },
      reason: 'schema validation failed: tasks must be an array',
    }]);
    expect(diagnostic.aiInterpreter.error).toEqual({
      type: 'ProviderError',
      message: 'invalid response',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('secret stack');
    expect(JSON.stringify(diagnostic)).not.toContain('plans');
    expect(JSON.stringify(diagnostic)).not.toContain('scheduleTemplates');
    expect(JSON.stringify(diagnostic)).not.toContain('userId');
  });
});
