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
    startTime: '13:00',
    endTime: null,
    precision: 'exact',
    sourceText: userText,
  });
  return value;
}

function focusedDeadline(): string {
  return JSON.stringify({
    decision: 'temporal_constraint',
    kind: 'deadline',
    constraintLevel: 'hard',
    dateExpression: 'tomorrow',
    namedTimePeriod: null,
    startTime: '13:00',
    endTime: null,
    precision: 'exact',
  });
}

function focusedFallback(): string {
  return JSON.stringify({
    decision: 'fallback',
    kind: null,
    constraintLevel: null,
    dateExpression: null,
    namedTimePeriod: null,
    startTime: null,
    endTime: null,
    precision: null,
  });
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

function fakeClient(responses: Array<string | Error>): {
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
        if (response instanceof Error) throw response;
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

  it('without a pending question, re-reads only an act-less shell response after an accepted plan (interaction)', () => {
    const summary = { ...publicStateSummary(), pendingQuestion: null };
    // Historical comparison: no pending question, no retry.
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: existingTaskShell(), publicStateSummary: summary, conversationArchitecture: 'legacy_v5',
    })).toBe(false);
    // Live D on fa6347e6: task shells only for a split/evening request after the preview.
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: existingTaskShell(), publicStateSummary: summary, conversationArchitecture: 'interaction_v1',
    })).toBe(true);
    // A bare empty reply (「うん」) or one before any accepted task stays a valid no-op.
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: { ...existingTaskShell(), tasks: [] }, publicStateSummary: summary, conversationArchitecture: 'interaction_v1',
    })).toBe(false);
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: existingTaskShell(), publicStateSummary: { ...summary, tasks: [] }, conversationArchitecture: 'interaction_v1',
    })).toBe(false);
  });

  it('uses a focused typed route to recover a task temporal side contribution', async () => {
    const fake = fakeClient([
      JSON.stringify(existingTaskShell()),
      focusedDeadline(),
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
        startTime: '13:00',
        constraintLevel: 'hard',
      }),
    ]);
    expect(fake.calls[1].responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_focused_task_temporal_side_contribution_v5' },
    });
    expect(fake.calls[1].maxCompletionTokens).toBe(640);
    const focusedPrompt = fake.calls[1].messages.map((message) => message.content).join('\n');
    expect(focusedPrompt).toContain('states a temporal constraint on knownTask');
    expect(focusedPrompt).toContain(userText);
  });

  it('falls through to the generic completeness retry when focused temporal meaning is absent', async () => {
    const fake = fakeClient([
      JSON.stringify(existingTaskShell()),
      focusedFallback(),
      JSON.stringify(recoveredDeadline()),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText,
      publicStateSummary: publicStateSummary(),
    });

    expect(fake.calls).toHaveLength(3);
    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 3,
      repairAttempted: false,
    });
    expect(result.document?.tasks[0].temporalConstraints).toEqual([
      expect.objectContaining({
        kind: 'deadline',
        dateExpression: 'tomorrow',
        startTime: '13:00',
      }),
    ]);
    const retryMessages = fake.calls[2].messages;
    const retryInstruction = retryMessages[retryMessages.length - 1]?.content ?? '';
    expect(retryInstruction).toContain('Re-read that exact current userText');
    expect(retryInstruction).toContain('side contributions unrelated to the pending question');
  });

  it('uses a fresh semantic context for the final generic retry after focused fallback and one no-op', async () => {
    const fake = fakeClient([
      JSON.stringify(existingTaskShell()),
      focusedFallback(),
      JSON.stringify(existingTaskShell()),
      JSON.stringify(recoveredDeadline()),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText,
      publicStateSummary: publicStateSummary(),
    });

    expect(fake.calls).toHaveLength(4);
    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 4,
      repairAttempted: false,
    });
    const finalRetryMessages = fake.calls[3].messages;
    const finalInstruction = finalRetryMessages[finalRetryMessages.length - 1]?.content ?? '';
    expect(finalInstruction).toContain('final independent completeness pass');
    expect(finalInstruction).toContain(userText);
    expect(finalRetryMessages.some((message) => message.role === 'assistant')).toBe(false);
  });

  it('falls back to the original schema-valid no-op only after focused and both generic passes are empty', async () => {
    const initial = existingTaskShell();
    const fake = fakeClient([
      JSON.stringify(initial),
      focusedFallback(),
      JSON.stringify(existingTaskShell()),
      JSON.stringify(existingTaskShell()),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText,
      publicStateSummary: publicStateSummary(),
    });

    expect(fake.calls).toHaveLength(4);
    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 4,
      repairAttempted: false,
    });
    expect(result.document).toEqual(initial);
  });

  it('returns provider failure when a completeness retry request fails instead of accepting the no-op', async () => {
    const fake = fakeClient([
      JSON.stringify(existingTaskShell()),
      focusedFallback(),
      new Error('AI rate limit exceeded.'),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText,
      publicStateSummary: publicStateSummary(),
    });

    expect(fake.calls).toHaveLength(3);
    expect(result.status).toBe('provider_failure');
    expect(result.document).toBeNull();
    expect(result.diagnostics.providerError).toContain('AI rate limit exceeded.');
  });

  it('uses the focused temporal route after repair produced a schema-valid no-op', async () => {
    const fake = fakeClient([
      JSON.stringify({ schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 }),
      JSON.stringify(existingTaskShell()),
      focusedDeadline(),
    ]);
    const result = await createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
      userText,
      publicStateSummary: publicStateSummary(),
    });

    expect(fake.calls).toHaveLength(3);
    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 3,
      repairAttempted: true,
    });
    expect(result.document?.tasks[0].temporalConstraints).toEqual([
      expect.objectContaining({
        kind: 'deadline',
        dateExpression: 'tomorrow',
        startTime: '13:00',
        constraintLevel: 'hard',
      }),
    ]);
    expect(fake.calls[2].responseFormat).toMatchObject({
      json_schema: { name: 'weekly_planning_focused_task_temporal_side_contribution_v5' },
    });
  });
  describe('an accepted plan and a reading that never carries the message (interaction, live B T4)', () => {
    const noPending = () => ({ ...publicStateSummary(), pendingQuestion: null });
    const emptyReading = () => ({ ...existingTaskShell(), tasks: [] });
    // Live B T4: the shell carries a study context label the typed facts cannot hold.
    const describedShell = () => {
      const value = existingTaskShell();
      value.tasks[0].study = { purpose: 'research', activityKind: 'writing', contextLabel: '青チャート', components: [] };
      return value;
    };
    const run = (responses: string[], conversationArchitecture: 'interaction_v1' | 'legacy_v5' = 'interaction_v1') => {
      const fake = fakeClient(responses);
      return createWeeklyPlanningSemanticNormalizerV5(fake.client).normalize({
        userText, publicStateSummary: noPending(), conversationArchitecture,
      }).then((result) => ({ result, calls: fake.calls }));
    };

    it('treats a valid empty re-read with no act as an unusable message, not an unchanged plan', async () => {
      const { result, calls } = await run([JSON.stringify(describedShell()), JSON.stringify(emptyReading())]);
      expect(calls).toHaveLength(2);
      expect(result.status).toBe('rejected');
      expect(result.document).toBeNull();
    });

    it('treats an invalid re-read that carries no planning content the same way', async () => {
      const { result } = await run([
        JSON.stringify(describedShell()),
        JSON.stringify({ schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, tasks: [] }),
      ]);
      expect(result.status).toBe('rejected');
    });

    it('a restated title that differs from the accepted one is unusable too (silently lost today)', async () => {
      const renamed = existingTaskShell();
      renamed.tasks[0].title = '別の題名';
      const { result } = await run([JSON.stringify(renamed), JSON.stringify(emptyReading())]);
      expect(result.status).toBe('rejected');
    });

    it('keeps the unchanged plan for a bare acknowledgement shell whose re-read is empty (no description was lost)', async () => {
      const { result } = await run([JSON.stringify(existingTaskShell()), JSON.stringify(emptyReading())]);
      expect(result.status).toBe('accepted');
      expect(result.document).toEqual(existingTaskShell());
    });

    it('still accepts a re-read that carries a delta or a self-sufficient act', async () => {
      const delta = await run([JSON.stringify(describedShell()), JSON.stringify(recoveredDeadline())]);
      expect(delta.result.status).toBe('accepted');
      expect(delta.result.document?.tasks[0].temporalConstraints).toHaveLength(1);
      const aside = await run([
        JSON.stringify(describedShell()),
        JSON.stringify({ ...emptyReading(), conversationActs: [{ kind: 'topic_shift', targetPublicId: null }] }),
      ]);
      expect(aside.result.status).toBe('accepted');
    });

    it('keeps the legacy reading of an empty re-read', async () => {
      const { result } = await run([JSON.stringify(existingTaskShell())], 'legacy_v5');
      expect(result.status).toBe('accepted');
    });
  });
});
