import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

function currentTaskDocument(planningWindow: WeeklyPlanningSemanticDocumentV5['planningWindow']): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow,
    tasks: [{
      localId: 'task-current',
      category: 'study',
      title: '数学',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学を進めたい',
    }],
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
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  let index = 0;
  return {
    calls,
    value: {
      async createChatCompletion(input) {
        calls.push(input as unknown as Record<string, unknown>);
        const response = sequence[index++];
        if (response === undefined) throw new Error('fake sequence exhausted');
        return response;
      },
    },
  };
}

describe('Stable V5 current-turn semantic delta contract', () => {
  it('tells the normalizer that accepted state is context and a pending question cannot suppress side contributions', async () => {
    const fake = client([JSON.stringify(currentTaskDocument(null))]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '数学を進めたい',
      recentConversation: [
        { role: 'user', content: '来週の予定を立てたい' },
        { role: 'assistant', content: '何を進めたいですか？' },
      ],
      publicStateSummary: {
        planningWindows: [{
          publicId: 'window-accepted',
          kind: 'relative_week',
          value: 'next_week',
        }],
        pendingQuestion: {
          questionCode: 'missing_schedulable_work',
          graphRevision: 1,
        },
      },
    });

    expect(result.status).toBe('accepted');
    const messages = fake.calls[0].messages as Array<{ role: string; content: string }>;
    const system = messages[0]?.content ?? '';
    expect(system).toContain('publicStateSummary and recentConversation are context, not output');
    expect(system).toContain('Emit only facts stated or changed in current userText');
    expect(system).toContain('every sourceText must be supported by current userText');
    expect(system).toContain(
      'a new nested fact on an existing task/component needs only a minimal containing shell bound by exact existingPublicId',
    );
    expect(system).toContain('Interpret current-turn meaning into semantic facts independently');
    expect(system).toContain('pendingQuestion as authoritative only for an actual answer');
    expect(system).toContain('It must not suppress other explicit contributions');
    expect(system).toContain('leave an unanswered question pending');
    expect(system).not.toContain('Current SemanticDocument is a delta');
  });

  it('does not reinterpret an AI-emitted planning window from raw current-turn text after the semantic boundary', async () => {
    const emittedWindow = {
      localId: 'window-emitted',
      kind: 'relative_week' as const,
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週の予定',
    };
    const initial = currentTaskDocument(emittedWindow);
    const fake = client([JSON.stringify(initial)]);

    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '数学を進めたい',
      publicStateSummary: {
        pendingQuestion: {
          actionId: 'ask-work',
          questionCode: 'missing_schedulable_work',
          graphRevision: 1,
        },
        planningWindows: [{
          publicId: 'window-accepted',
          kind: 'relative_week',
          value: 'next_week',
        }],
      },
    });

    expect(result.status).toBe('accepted');
    expect(result.document?.planningWindow).toEqual(emittedWindow);
    expect(result.document?.tasks).toHaveLength(1);
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(result.diagnostics.algorithmicRepairs).not.toEqual(
      expect.arrayContaining([expect.stringContaining('copied-planning-window-removed')]),
    );
  });
});
