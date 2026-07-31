import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function document(includePlanningWindow: boolean): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: includePlanningWindow
      ? {
          localId: 'window-tomorrow',
          kind: 'relative_day',
          value: 'tomorrow',
          start: null,
          end: null,
          sourceText: '明日',
        }
      : null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function client(sequence: string[]): {
  value: OpenAiCompatibleClient;
  calls: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][];
} {
  const calls: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
  let index = 0;
  return {
    calls,
    value: {
      async createChatCompletion(input) {
        calls.push(input);
        const next = sequence[index++];
        if (next === undefined) throw new Error('fake sequence exhausted');
        return next;
      },
    },
  };
}

describe('Stable V5 planning-window pending question contract', () => {
  it('repairs a short 明日 answer from machine state without reading the rendered wording', async () => {
    const fake = client([
      JSON.stringify(document(false)),
      JSON.stringify(document(true)),
    ]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '明日',
      recentConversation: [{
        role: 'assistant',
        content: '対象範囲だけ先に決めさせてください。',
      }],
      publicStateSummary: {
        lastAssistantMessage: '期間判定用の固定文言を含まない',
        pendingQuestion: {
          actionId: 'stable-v5:turn-1:invalid_planning_horizon',
          questionCode: 'invalid_planning_horizon',
          targetFactId: null,
          graphRevision: 0,
        },
      },
      traceRequestId: 'trace-machine-pending-window',
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toMatchObject({
      kind: 'relative_day',
      value: 'tomorrow',
    });
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: true,
      validationErrors: ['document.planningWindow:direct-user-range-omitted:tomorrow'],
    });
    const firstUserPrompt = JSON.parse(fake.calls[0].messages[1].content) as {
      publicStateSummary?: Record<string, unknown>;
    };
    expect(firstUserPrompt.publicStateSummary).toMatchObject({
      pendingQuestion: {
        questionCode: 'invalid_planning_horizon',
        graphRevision: 0,
      },
    });
  });

  it('does not treat the same short answer as a planning window without machine pending state', async () => {
    const fake = client([JSON.stringify(document(false))]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '明日',
      recentConversation: [{
        role: 'assistant',
        content: 'どの期間の予定を立てましょうか？',
      }],
      publicStateSummary: {},
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toBeNull();
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });
});
