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
  it('tells the normalizer that accepted state is context rather than output snapshot', async () => {
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
      },
    });

    expect(result.status).toBe('accepted');
    const messages = fake.calls[0].messages as Array<{ role: string; content: string }>;
    const system = messages[0]?.content ?? '';
    expect(system).toContain('Current SemanticDocument is a delta');
    expect(system).toContain('publicStateSummary/recentConversation are context, not facts to copy');
    expect(system).toContain('planningWindow must be null');
    expect(system).toContain('Emit only facts stated or changed in current userText');
  });

  it('repairs a copied accepted planning window during a contextual turn while preserving current-turn facts', async () => {
    const staleWindow = {
      localId: 'window-copied',
      kind: 'relative_week' as const,
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週の予定',
    };
    const initial = currentTaskDocument(staleWindow);
    const repaired = currentTaskDocument(null);
    const fake = client([
      JSON.stringify(initial),
      JSON.stringify(repaired),
    ]);

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
    expect(result.document?.planningWindow).toBeNull();
    expect(result.document?.tasks).toHaveLength(1);
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(fake.calls).toHaveLength(2);

    const repairMessages = fake.calls[1].messages as Array<{ role: string; content: string }>;
    const repairPayload = JSON.parse(repairMessages[repairMessages.length - 1]?.content ?? '{}') as {
      instruction?: string;
      requiredChanges?: string[];
    };
    expect(repairPayload.instruction).toContain('does not mean restating the accepted plan');
    expect(repairPayload.instruction).toContain('delta for current userText');
    expect(repairPayload.requiredChanges?.join('\n')).toContain('Set an unstated planningWindow to null');
    expect(repairPayload.requiredChanges?.join('\n')).toContain('Keep newly stated current-turn facts');
  });
});
