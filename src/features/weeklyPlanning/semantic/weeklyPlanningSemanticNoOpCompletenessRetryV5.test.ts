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

  it('without a pending question, re-reads an act-less shell or an entirely empty response after an accepted plan (interaction)', () => {
    const summary = { ...publicStateSummary(), pendingQuestion: null };
    // Historical comparison: no pending question, no retry.
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: existingTaskShell(), publicStateSummary: summary, conversationArchitecture: 'legacy_v5',
    })).toBe(false);
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: { ...existingTaskShell(), tasks: [] }, publicStateSummary: summary, conversationArchitecture: 'legacy_v5',
    })).toBe(false);
    // Live D on fa6347e6: task shells only for a split/evening request after the preview.
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: existingTaskShell(), publicStateSummary: summary, conversationArchitecture: 'interaction_v1',
    })).toBe(true);
    // Live H r1 on fd6a29fd (x6): an entirely empty reading for a placement is re-read too (it was a valid no-op before).
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: { ...existingTaskShell(), tasks: [] }, publicStateSummary: summary, conversationArchitecture: 'interaction_v1',
    })).toBe(true);
    // Before any accepted task there is nothing to contradict: stays a valid no-op.
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: existingTaskShell(), publicStateSummary: { ...summary, tasks: [] }, conversationArchitecture: 'interaction_v1',
    })).toBe(false);
    // A typed self-sufficient act, or an explicit create_plan authorization, is meaning the application answers: no re-read.
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: { ...existingTaskShell(), tasks: [], conversationActs: [{ kind: 'topic_shift', targetPublicId: null }] },
      publicStateSummary: summary, conversationArchitecture: 'interaction_v1',
    })).toBe(false);
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: { ...existingTaskShell(), tasks: [], planningIntent: 'create_plan' }, publicStateSummary: summary, conversationArchitecture: 'interaction_v1',
    })).toBe(false);
  });

  it.each([
    // architecture, pending question, planningIntent -> eligible (identical to a4dd115e except the intended interaction row)
    ['legacy_v5', true, 'update_plan', true], ['legacy_v5', true, 'create_plan', true],
    ['legacy_v5', false, 'update_plan', false], ['legacy_v5', false, 'create_plan', false],
    ['interaction_v1', true, 'update_plan', true], ['interaction_v1', true, 'create_plan', true],
    ['interaction_v1', false, 'update_plan', true], // intended x6 change (was false): an entirely empty reading is re-read
    ['interaction_v1', false, 'create_plan', false], // a task-less creation authorization carries its meaning in the intent
  ] as const)('eligibility table (%s, pending=%s, %s) is %s for an empty reading', (architecture, pending, planningIntent, expected) => {
    const base = publicStateSummary();
    const summary = pending ? base : { ...base, pendingQuestion: null };
    expect(isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({
      document: { ...existingTaskShell(), tasks: [], planningIntent } as never, publicStateSummary: summary, conversationArchitecture: architecture,
    })).toBe(expected);
  });

  describe('eligibility is identical to the a4dd115e logic except the intended interaction row (96 combinations)', () => {
    // Reference: the eligibility logic of a4dd115e, restated here as the oracle.
    const SELF_SUFFICIENT = ['decline_additional_work', 'request_event_registration', 'ask_about_pending_question', 'topic_shift', 'resume_topic', 'consultation_request'];
    const reference = (p: { document: WeeklyPlanningSemanticDocumentV5; pending: boolean; acceptedTask: boolean; actAware: boolean; reread: boolean }) => {
      if (!p.pending && !(p.actAware && p.acceptedTask && (p.document.tasks.length > 0 || p.reread))) return false;
      if (p.actAware && (p.document.conversationActs ?? []).some(act => SELF_SUFFICIENT.includes(act.kind))) return false;
      return p.document.tasks.every(task => task.existingPublicId && task.workloads.length === 0 && task.effortEstimates.length === 0
        && task.temporalConstraints.length === 0 && task.recurrence.length === 0 && (task.study?.components.length ?? 0) === 0);
    };
    const combinations: Array<{ architecture: 'legacy_v5' | 'interaction_v1'; pending: boolean; shell: boolean; intent: 'update_plan' | 'create_plan'; act: string | null; reread: boolean }> = [];
    for (const architecture of ['legacy_v5', 'interaction_v1'] as const) for (const pending of [true, false]) for (const shell of [true, false])
      for (const intent of ['update_plan', 'create_plan'] as const) for (const act of [null, 'answer_pending_question', 'topic_shift'] as const)
        for (const reread of [false, true]) combinations.push({ architecture, pending, shell, intent, act, reread });
    it('covers 96 combinations and deviates from a4dd115e only for an interaction first reading, no pending question, task-less update_plan', () => {
      expect(combinations).toHaveLength(96);
      const deviations: string[] = [];
      for (const c of combinations) {
        const base = existingTaskShell();
        const document = { ...base, planningIntent: c.intent, tasks: c.shell ? base.tasks : [],
          conversationActs: c.act ? [{ kind: c.act, targetPublicId: null }] : [] } as unknown as WeeklyPlanningSemanticDocumentV5;
        const summary = c.pending ? publicStateSummary() : { ...publicStateSummary(), pendingQuestion: null };
        const actual = isWeeklyPlanningSemanticNoOpCompletenessRetryEligibleV5({ document, publicStateSummary: summary,
          conversationArchitecture: c.architecture, rereadAfterContradiction: c.reread });
        const expected = reference({ document, pending: c.pending, acceptedTask: true, actAware: c.architecture === 'interaction_v1', reread: c.reread });
        if (actual !== expected) deviations.push(JSON.stringify(c));
      }
      // The intended change: an entirely empty reading is re-read (interaction, no pending, first reading, update_plan; with or
      // without a bare answer act). Re-reads (reread=true) and every create_plan row are identical to a4dd115e.
      expect(deviations.sort()).toEqual(combinations.filter(c => c.architecture === 'interaction_v1' && !c.pending && !c.shell
        && c.intent === 'update_plan' && !c.reread && c.act !== 'topic_shift').map(c => JSON.stringify(c)).sort());
    });
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
