import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5 } from './weeklyPlanningSemanticNoOpCompletenessRetryV5';

const userText = '締切は明日の13時です';

function existingTaskShell(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task_report',
      existingPublicId: 'task-existing',
      decompositionStatus: 'atomic',
      category: 'study',
      title: '研究室のレポートを仕上げる',
      study: {
        purpose: 'research',
        activityKind: 'writing',
        contextLabel: null,
        components: [],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: userText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function recoveredDeadline(): WeeklyPlanningSemanticDocumentV5 {
  const value = existingTaskShell();
  value.tasks[0].temporalConstraints.push({
    localId: 'deadline_report',
    targetLocalId: 'task_report',
    kind: 'deadline',
    constraintLevel: 'hard',
    dateExpression: 'tomorrow',
    namedTimePeriod: null,
    startTime: null,
    endTime: '13:00',
    precision: 'exact',
    sourceText: userText,
  });
  return value;
}

function publicStateSummary() {
  return {
    graphRevision: 2,
    pendingQuestion: {
      questionCode: 'missing_schedulable_work',
      targetFactId: 'task-existing',
      graphRevision: 2,
    },
    tasks: [{
      publicId: 'task-existing',
      category: 'study',
      title: '研究室のレポートを仕上げる',
    }],
    components: [],
    workloads: [],
  };
}

function fakeClient(responses: string[]): {
  client: OpenAiCompatibleClient;
  calls: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]>;
} {
  let index = 0;
  const calls: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
  return {
    calls,
    client: {
      async createChatCompletion(input) {
        calls.push(input);
        const response = responses[index++];
        if (response === undefined) throw new Error('fake response exhausted');
        return response;
      },
    },
  };
}

describe('Stable V5 schema-valid no-op completeness retry', () => {
  it('treats an existing empty wrapper under a machine pending question as retry eligible', () => {
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: existingTaskShell(),
      publicStateSummary: publicStateSummary(),
    })).toBe(true);
  });

  it('does not retry when the first valid semantic document already carries a new fact', () => {
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: recoveredDeadline(),
      publicStateSummary: publicStateSummary(),
    })).toBe(false);
  });

  it('does not retry without a machine pending question', () => {
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: existingTaskShell(),
      publicStateSummary: {
        ...publicStateSummary(),
        pendingQuestion: null,
      },
    })).toBe(false);
  });

  it('re-reads a valid semantic no-op and accepts a fact omitted by the first Luna response', async () => {
    const fake = fakeClient([
      JSON.stringify(existingTaskShell()),
      JSON.stringify(recoveredDeadline()),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText,
      publicStateSummary: publicStateSummary(),
    });

    expect(fake.calls).toHaveLength(2);
    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 2,
      repairAttempted: false,
    });
    expect(result.document?.tasks[0].temporalConstraints).toEqual([
      expect.objectContaining({
        kind: 'deadline',
        dateExpression: 'tomorrow',
        endTime: '13:00',
        constraintLevel: 'hard',
      }),
    ]);
    const retryMessages = fake.calls[1].messages;
    const retryInstruction = retryMessages[retryMessages.length - 1]?.content ?? '';
    expect(retryInstruction).toContain('Re-read current userText');
    expect(retryInstruction).toContain('side contributions unrelated to the pending question');
  });
});
