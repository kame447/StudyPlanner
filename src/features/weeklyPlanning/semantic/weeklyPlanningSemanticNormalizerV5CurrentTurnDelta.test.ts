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
    expect(system).toContain('Context is not output');
    expect(system).toContain('Emit only current userText changes');
    expect(system).toContain('each sourceText must be supported by current userText');
    expect(system).toContain('New nested facts on existing entities need only a minimal shell with exact existingPublicId');
    expect(system).toContain('Interpret each current-turn contribution independently');
    expect(system).toContain('pendingQuestion binds only actual answers to its exact target');
    expect(system).toContain('cannot suppress other explicit contributions');
    expect(system).not.toContain('Current SemanticDocument is a delta');
  });

  it('rejects an AI-emitted planning window copied from context without deterministically reinterpreting raw user text', async () => {
    const emittedWindow = {
      localId: 'window-emitted',
      kind: 'relative_week' as const,
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週の予定',
    };
    const initial = currentTaskDocument(emittedWindow);
    const encoded = JSON.stringify(initial);
    const fake = client([encoded, encoded]);

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

    expect(result.status).toBe('rejected');
    expect(result.document).toBeNull();
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(fake.calls).toHaveLength(2);
    expect(result.diagnostics.validationErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('planningWindow.sourceText:not-grounded-in-current-user-text'),
      ]),
    );
    expect(result.diagnostics.algorithmicRepairs).not.toEqual(
      expect.arrayContaining([expect.stringContaining('copied-planning-window-removed')]),
    );
  });
});
