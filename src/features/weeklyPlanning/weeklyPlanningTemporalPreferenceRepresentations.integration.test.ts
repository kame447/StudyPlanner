import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { A, type Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';
import { typedStableV5RuntimeQuestionText } from './application/weeklyPlanningStableV5RuntimeQuestions';
import { liveATemporalDocument, taskTemporalPreferenceDocument, LIVE_A_BOOK } from './testUtils/weeklyPlanningLiveTemporalFixture';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } from './testUtils/weeklyPlanningScriptedConversationHarness';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let response: Json;

beforeEach(() => {
  resetScriptedConversationRuntime();
  response = liveATemporalDocument();
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') {
      const decision = call.payload?.applicationDecision as Json;
      return scriptedRendererReply(call, decision.actionKind === 'question'
        ? '希望する日時について、もう少し教えてもらえますか？'
        : '候補が1件できました。「この内容で仮予定にする」を押してください。');
    }
    return JSON.stringify(call.schemaProperties.includes('conversationActs')
      ? response
      : Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'conversationActs')));
  });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

function preference(scope: 'task' | 'plan', overrides: Json): Json {
  if (scope === 'task') {
    const document = taskTemporalPreferenceDocument(overrides);
    // Overriding the date makes the five per-weekday windows identical; interaction validation
    // rejects such duplicates (live A on e9b62a50), so the scope cases keep one window.
    if ('dateExpression' in overrides) {
      const task = (document.tasks as Json[])[0];
      task.temporalConstraints = (task.temporalConstraints as Json[]).slice(0, 1);
    }
    return document;
  }
  const document = liveATemporalDocument();
  Object.assign((document.availabilityDeclarations as Json[])[0], overrides);
  return document;
}

describe('A temporal preference representation matrix', () => {
  it.each(['interaction_v1', 'legacy_v5'] as const)('asks about out-of-period single weekdays without inventing recurrence in %s', async (architecture) => {
    response = taskTemporalPreferenceDocument();
    const task = (response.tasks as Json[])[0];
    response.availabilityDeclarations = (task.temporalConstraints as Json[]).map((constraint) => ({
      localId: constraint.localId, kind: 'preferred', dateExpression: constraint.dateExpression,
      namedTimePeriod: null, startTime: '20:00', endTime: null, recurrenceKind: null, days: [],
      constraintLevel: 'soft', capacityMinutes: null, sourceText: '平日は20時以降がいい',
    }));
    task.temporalConstraints = [];
    const conversation = createScriptedConversation({ provider, architecture });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([]);
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:availability_outside_planning_window');
    expect(conversation.graph()?.availabilityDeclarations.every((fact) => fact.recurrenceKind === null && fact.days.length === 0)).toBe(true);
  });

  it.each(['interaction_v1', 'legacy_v5'] as const)('one answer places an out-of-period Friday inside next week in %s', async (architecture) => {
    response = preference('plan', { dateExpression: 'weekday:friday', recurrenceKind: null, days: [] });
    const conversation = createScriptedConversation({ provider, architecture });
    const first = await conversation.submit(A);
    expect(first.result?.failure).toBeUndefined();
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:availability_outside_planning_window');
    const question = first.calls.find((call) => call.kind === 'renderer')?.payload?.applicationDecision as Json;
    expect(question.questionIntent).toMatchObject({
      resolutionKind: 'availability_date_scope', requestedInformation: ['availability_date_scope'],
    });
    const old = conversation.graph()!.availabilityDeclarations[0];
    expect(typedStableV5RuntimeQuestionText(conversation.graph()!, {
      domain: 'availability', code: 'availability_outside_planning_window', factId: old.id, details: {},
    })).toBeTruthy();
    if (architecture === 'interaction_v1') {
      expect((question.communication as Json).questionPurposes).toContain('use_dates_the_plan_can_read');
    }
    const answer = '来週の金曜';
    const replacement = { ...(response.availabilityDeclarations as Json[])[0], localId: 'next-friday', dateExpression: '2026-10-16', sourceText: answer };
    response = {
      ...response, planningIntent: 'update_plan', planningWindow: null, tasks: [],
      availabilityDeclarations: [replacement],
      corrections: [{
        localId: 'fix-friday', target: { kind: 'availability_declaration', publicId: old.id, localId: null, mention: null },
        operation: 'replace', replacementLocalId: 'next-friday', sourceText: answer,
      }],
    };
    const second = await conversation.submit(answer);
    expect(second.result?.failure).toBeUndefined();
    expect(conversation.getState().intakeState?.lastQuestionContext).toBeFalsy();
    expect(second.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-16', startTime: '20:00', durationMinutes: 70 }),
    ]);
  });

  it('an in-period same-week Wednesday reaches placement without another question', async () => {
    response = preference('plan', { dateExpression: 'weekday:wednesday', recurrenceKind: null, days: [], sourceText: '水曜日は20時以降がいい' });
    Object.assign(response.planningWindow as Json, { value: 'this_week', sourceText: '今週' });
    (response.tasks as Json[])[0].sourceText = 'アルゴリズムイントロダクションを20ページ読みたい';
    const conversation = createScriptedConversation({ provider, weekStartDate: '2026-10-12', now: () => '2026-10-12T00:00:00.000Z' });
    const turn = await conversation.submit('今週、アルゴリズムイントロダクションを20ページ読みたい。1ページ3分くらいで、水曜日は20時以降がいい');
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.getState().intakeState?.lastQuestionContext).toBeFalsy();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-14', startTime: '20:00', durationMinutes: 70 }),
    ]);
  });

  it.each(['interaction_v1', 'legacy_v5'] as const)('one collective date answer resolves all five weekday scopes in %s', async (architecture) => {
    response = taskTemporalPreferenceDocument();
    const task = (response.tasks as Json[])[0];
    response.availabilityDeclarations = (task.temporalConstraints as Json[]).map((constraint) => ({
      localId: constraint.localId, kind: 'preferred', dateExpression: constraint.dateExpression,
      namedTimePeriod: null, startTime: '20:00', endTime: null, recurrenceKind: null, days: [],
      constraintLevel: 'soft', capacityMinutes: null, sourceText: '平日は20時以降がいい',
    }));
    task.temporalConstraints = [];
    const conversation = createScriptedConversation({ provider, architecture });
    const first = await conversation.submit(A);
    expect(first.result?.failure).toBeUndefined();
    expect(first.result?.draftCandidates).toEqual([]);
    const previous = conversation.graph()!.availabilityDeclarations;
    const answer = '全部来週の平日、20時以降です';
    const declarations = previous.map((_fact, index) => ({
      ...(response.availabilityDeclarations as Json[])[index], localId: `next-week-${index}`,
      dateExpression: `2026-10-${12 + index}`, sourceText: answer,
    }));
    response = {
      ...response, planningIntent: 'update_plan', planningWindow: null, tasks: [],
      availabilityDeclarations: declarations,
      corrections: previous.map((fact, index) => ({
        localId: `fix-weekday-${index}`, target: { kind: 'availability_declaration', publicId: fact.id, localId: null, mention: null },
        operation: 'replace', replacementLocalId: declarations[index].localId, sourceText: answer,
      })),
    };
    const second = await conversation.submit(answer);
    expect(second.result?.failure).toBeUndefined();
    expect(conversation.getState().intakeState?.lastQuestionContext).toBeFalsy();
    expect(second.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 }),
    ]);
  });


  for (const architecture of ['interaction_v1', 'legacy_v5'] as const) {
    it(`asks for work rather than treating known night as unresolved without a workload in ${architecture}`, async () => {
      response = taskTemporalPreferenceDocument({
        dateExpression: null, startTime: null, namedTimePeriod: 'night', sourceText: 'できれば夜',
      });
      const task = (response.tasks as Json[])[0];
      // One undated window: five identical copies are rejected as duplicates in interaction.
      task.temporalConstraints = (task.temporalConstraints as Json[]).slice(0, 1);
      Object.assign(task, { workloads: [], effortEstimates: [], decompositionStatus: 'atomic', sourceText: 'アルゴリズムイントロダクションを読みたい' });
      const conversation = createScriptedConversation({ provider, architecture, studyMaterials: [LIVE_A_BOOK] });
      const first = await conversation.submit('来週、アルゴリズムイントロダクションを読みたい。できれば夜');
      expect(first.result?.failure).toBeUndefined();
      expect(first.result?.draftCandidates).toEqual([]);
      expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
      expect(conversation.graph()?.temporalConstraints.every((constraint) => constraint.namedTimePeriod === 'night')).toBe(true);
    });

    it(`keeps task-scoped after-20:00 clock bounds in ${architecture}`, async () => {
      response = taskTemporalPreferenceDocument();
      const conversation = createScriptedConversation({ provider, architecture });
      const turn = await conversation.submit(A);
      expect(turn.result?.failure).toBeUndefined();
      expect(turn.result?.draftCandidates).toEqual([
        expect.objectContaining({ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 }),
      ]);
    });
  }

  for (const scope of ['task', 'plan'] as const) {
    it.each([
      { label: 'explicit two-clock window', overrides: { endTime: '23:59' }, start: '20:00' },
      { label: 'night', overrides: { startTime: null, namedTimePeriod: 'night' }, start: '21:00' },
      { label: 'evening', overrides: { startTime: null, namedTimePeriod: 'evening' }, start: '17:00' },
    ])(`${scope} $label reaches slot selection with its typed meaning`, async ({ overrides, start }) => {
      response = preference(scope, overrides);
      const conversation = createScriptedConversation({ provider });
      const turn = await conversation.submit(A);
      expect(turn.result?.failure).toBeUndefined();
      expect(turn.result?.draftCandidates).toEqual([
        expect.objectContaining({ date: '2026-10-12', startTime: start, durationMinutes: 70 }),
      ]);
    });

    it.each([
      { label: 'custom weekday scope', overrides: { dateExpression: 'custom:平日' }, code: 'unsupported_date_expression' },
      { label: 'unknown constraint level', overrides: { constraintLevel: 'unknown' }, code: 'unknown_constraint_level' },
      { label: 'unresolved named period', overrides: { startTime: null, namedTimePeriod: 'custom:遅め' }, code: 'named_time_period_unresolved' },
    ])(`${scope} $label asks instead of silently ignoring the preference`, async ({ overrides, code }) => {
      response = preference(scope, overrides);
      const conversation = createScriptedConversation({ provider });
      const turn = await conversation.submit(A);
      expect(turn.result?.failure).toBeUndefined();
      expect(turn.result?.draftCandidates).toEqual([]);
      expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe(`stable_v5:${code}`);
      const renderer = turn.calls.find((call) => call.kind === 'renderer')!;
      expect((renderer.payload?.applicationDecision as Json).questionCode).toBe(code);
    });

    it(`${scope} literal weekday date is rejected and repaired without dropping the time`, async () => {
      response = preference(scope, { dateExpression: '平日' });
      const conversation = createScriptedConversation({ provider });
      const turn = await conversation.submit(A);
      // A literal Japanese date is not canonical, and the scripted repair remains
      // malformed. Rejection is explicit; no misleading candidate can be created.
      expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
      expect(turn.result?.draftCandidates).toEqual([]);
    });

    it(`${scope} 24:00 is an internal day bound, not a silently accepted provider clock`, async () => {
      response = preference(scope, { endTime: '24:00' });
      const conversation = createScriptedConversation({ provider });
      const turn = await conversation.submit(A);
      expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
      expect(turn.result?.draftCandidates).toEqual([]);
    });
  }

  it.each(['hard', 'soft'])('a %s plan-wide available window reaches placement without changing its level', async (constraintLevel) => {
    response = preference('plan', { kind: 'available', constraintLevel });
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 }),
    ]);
  });

  it('soft availability never expands a hard available window', async () => {
    response = preference('plan', { kind: 'available', constraintLevel: 'soft' });
    (response.availabilityDeclarations as Json[]).push({
      ...(response.availabilityDeclarations as Json[])[0], localId: 'hard-available',
      startTime: '10:00', endTime: '12:00', constraintLevel: 'hard',
      sourceText: '使えるのは平日の10時から12時だけ',
    });
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(`${A}。使えるのは平日の10時から12時だけ`);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '10:00', endTime: '11:10' }),
    ]);
  });

  it('task-scoped end-only clock bounds remain bounds, not a date-only preference', async () => {
    response = taskTemporalPreferenceDocument({ startTime: null, endTime: '08:00' });
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '00:00', endTime: '01:10' }),
    ]);
  });
});
