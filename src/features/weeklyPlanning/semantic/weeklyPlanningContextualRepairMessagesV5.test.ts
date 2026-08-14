import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';

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

function invalidOldBreakdown(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      existingPublicId: 'task-public',
      decompositionStatus: 'needs_breakdown',
      category: 'study',
      title: '提出課題',
      study: { purpose: 'homework', contextLabel: '提出課題', components: [] },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '提出課題が残っている',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [{
      localId: 'uncertainty-1',
      targetLocalId: 'task-1',
      field: 'work_breakdown',
      reason: 'constituents unknown',
      sourceText: '提出課題が残っている',
    }],
    corrections: [],
    decisions: [],
  });
}

function resolvedBreakdown(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      existingPublicId: 'task-public',
      decompositionStatus: 'decomposed',
      category: 'study',
      title: '提出課題',
      study: {
        purpose: 'homework',
        contextLabel: '提出課題',
        components: [
          {
            localId: 'component-1',
            existingPublicId: null,
            parentLocalId: null,
            role: 'material',
            label: '英語レポート',
            workloads: [],
            durableContextSignals: [],
            sourceText: '英語レポート',
          },
          {
            localId: 'component-2',
            existingPublicId: null,
            parentLocalId: null,
            role: 'material',
            label: '化学プリント',
            workloads: [],
            durableContextSignals: [],
            sourceText: '化学プリント',
          },
        ],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '英語レポートと化学プリントが残っています',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

const breakdownState = {
  pendingQuestion: {
    questionCode: 'semantic_uncertainty',
    targetFactId: 'uncertainty-public',
    graphRevision: 1,
  },
  tasks: [{ publicId: 'task-public', category: 'study', title: '提出課題' }],
  uncertainties: [{
    publicId: 'uncertainty-public',
    targetPublicId: 'task-public',
    field: 'work_breakdown',
    sourceText: '提出課題が残っている',
  }],
};

describe('Stable V5 contextual repair messages', () => {
  it('uses the generic pending-question contract for work-breakdown repair', async () => {
    const fake = client([invalidOldBreakdown(), resolvedBreakdown()]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '英語レポートと化学プリントが残っています',
      publicStateSummary: breakdownState,
    });

    expect(result.status).toBe('accepted');
    expect(fake.calls).toHaveLength(2);
    const repairMessages = fake.calls[1].messages as Array<{ role: string; content: string }>;
    expect(repairMessages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(repairMessages[0]?.content).toContain('pendingQuestion as authoritative');
    expect(repairMessages[0]?.content).not.toContain('work_breakdown target');
    expect(repairMessages[2]?.content).toBe(invalidOldBreakdown());

    const repairPayload = JSON.parse(repairMessages[3]?.content ?? '{}') as {
      requiredChanges: string[];
    };
    expect(repairPayload.requiredChanges).toEqual([
      'Correct only the listed validation failures; preserve unrelated current-turn meaning.',
    ]);
  });

  it('keeps invalid-response-assisted repair for an ordinary schema error', async () => {
    const fake = client(['not-json', resolvedBreakdown()]);
    await createWeeklyPlanningSemanticNormalizerV5(fake.value).normalize({
      userText: '英語レポートと化学プリントが残っています',
    });

    const repairMessages = fake.calls[1].messages as Array<{ role: string; content: string }>;
    expect(repairMessages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(repairMessages[2]?.content).toBe('not-json');
  });
});
