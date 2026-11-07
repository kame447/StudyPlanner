import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import type { VNextEventRegistrationAct } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextInterpretationContract';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
const decline: VNextEventRegistrationAct = { kind: 'decline_additional_work', targetRef: null };
type Reading = { add?: VNextAddFact[]; acts?: VNextEventRegistrationAct[] };

function harness(id: string, steps: Reading[]) {
  let nativeCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
      nativeCalls++;
      const step = steps.shift();
      if (!step) throw new Error('unexpected semantic request, including repair');
      content = JSON.stringify({ planningIntent: 'discuss', conversationActs: step.acts ?? [], answer: null,
        delta: { add: step.add ?? [], patch: [], remove: [], relate: [], defer: [] } });
    } else if (schema === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name) {
      content = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-11-02', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: id, traceRequestId: '', inputStateRevision: 0,
      messages: [], userText: '', selectedDate: '2026-11-02', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  let sequence = 0;
  return { done() { expect(nativeCalls).toBe(sequence); expect(steps).toEqual([]); }, async turn(userText: string) {
    input.input.traceRequestId = `${id}:${++sequence}`;
    input.input.userText = userText;
    const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
    if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
    expect(output.result.failure).toBeUndefined();
    expect(output.result.draftCandidates).toEqual([]);
    expect(checkpoint.vnext.preview).toBeNull();
    input.checkpoint = output.checkpointAfter;
    input.input.inputStateRevision = checkpoint.vnext.state.graph.revision;
    return { checkpoint: checkpoint.vnext, state: checkpoint.vnext.state,
      projection: projectWeeklyPlanningVNext(checkpoint.vnext.state) };
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Conditional typed-reading contracts, not a claim that a live model chooses these readings.
describe('#978 C20 optional invitation versus required effort through the Worker', () => {
  it('optional-invitation-busy-decline-reopen/1-3: closes only the optional invitation and retains busy time after reload', async () => {
    const h = harness('optional-invitation-busy-decline-reopen', [{ add: [{ kind: 'availability_declaration', localId: 'busy',
      availabilityKind: 'unavailable', dateExpression: '2026-11-03', namedTimePeriod: null, startTime: '16:00', endTime: '17:30',
      recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard' }] }, { acts: [decline] }, {}]);
    const before = await h.turn('11月2日から8日の予定です。11月3日16時から17時半は勉強できません。');
    expect(before.state.optionalInvitationClosed).toBe(false);
    expect(before.checkpoint.presentedQuestion).not.toBeNull();
    expect(before.state.graph.availabilityDeclarations).toHaveLength(1);
    expect(before.state.graph.availabilityDeclarations[0]).toMatchObject({ kind: 'unavailable',
      dateExpression: '2026-11-03', startTime: '16:00', endTime: '17:30', constraintLevel: 'hard' });
    const closed = await h.turn('ほかの作業は追加しません。');
    expect(closed.state.optionalInvitationClosed).toBe(true);
    expect(closed.checkpoint.presentedQuestion).toBeNull();
    const unchanged = await h.turn('わかりました。');
    expect(unchanged.state.optionalInvitationClosed).toBe(true);
    expect(unchanged.checkpoint.presentedQuestion).toBeNull();
    expect(closed.state.graph.availabilityDeclarations).toEqual(before.state.graph.availabilityDeclarations);
    expect(unchanged.state.graph.availabilityDeclarations).toEqual(before.state.graph.availabilityDeclarations);
    expect(unchanged.state.graph.tasks).toEqual([]);
    expect(unchanged.state.graph.workloads).toEqual([]);
    h.done();
  });

  it('optional-decline-does-not-close-required-effort/1-2: retains ten problems and their required estimate question', async () => {
    const h = harness('optional-decline-does-not-close-required-effort', [{ add: [
      { kind: 'task', localId: 'math', category: 'study', title: '数学' },
      { kind: 'workload', localId: 'problems', taskRef: { localId: 'math' }, componentRef: null, quantityRole: 'target', amount: 10,
        unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
    ] }, { acts: [decline] }]);
    const before = await h.turn('数学の問題を10問やりたいです。');
    expect(before.state.graph.workloads).toMatchObject([{ quantityRole: 'target', amount: 10, unitCode: 'problem' }]);
    const question = before.projection.questions[0];
    expect(question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 10, unitCode: 'problem' } });
    const after = await h.turn('ほかの作業は追加しません。');
    expect(after.state.optionalInvitationClosed).toBe(false);
    expect(after.state.graph.tasks).toEqual(before.state.graph.tasks);
    expect(after.state.graph.workloads).toEqual(before.state.graph.workloads);
    expect(after.state.graph.effortEstimates).toEqual([]);
    expect(after.projection.questions).toHaveLength(1);
    expect(after.projection.questions[0]).toMatchObject({ key: question.key, code: 'missing_effort_estimate',
      taskId: before.state.graph.tasks[0].id, forWork: { amount: 10, unitCode: 'problem' } });
    expect(after.checkpoint.presentedQuestion?.questionKey).toBe(question.key);
    expect(after.projection.owners.flatMap(owner => owner.work)).toEqual([]);
    h.done();
  });
});
