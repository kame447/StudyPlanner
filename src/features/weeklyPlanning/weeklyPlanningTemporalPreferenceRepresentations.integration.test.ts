import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { A, type Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';
import { liveATemporalDocument, taskTemporalPreferenceDocument } from './testUtils/weeklyPlanningLiveTemporalFixture';
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
  if (scope === 'task') return taskTemporalPreferenceDocument(overrides);
  const document = liveATemporalDocument();
  Object.assign((document.availabilityDeclarations as Json[])[0], overrides);
  return document;
}

describe('A temporal preference representation matrix', () => {
  for (const architecture of ['interaction_v1', 'legacy_v5'] as const) {
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
