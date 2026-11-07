import { afterEach, expect, it, vi } from 'vitest';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';
import { parseWeeklyPlanningVNextSessionCheckpoint } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../../../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { compareRealApiDateMeaning } from '../../../../src/features/weeklyPlanning/evals/vnextRealApiDateOracle';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import type { VNextAddFact } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { AiProxyWorkerEnv } from '../worker';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('#978 C20 issue881-final-b-deadline-at-13/2: retains tomorrow and asks for the newly named task quantity', async () => {
  const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;
  // Conditional native readings; the task title is a verbatim substring of its source utterance.
  const steps: Array<{ planningIntent: 'create_plan' | 'discuss'; add: VNextAddFact[] }> = [
    { planningIntent: 'create_plan', add: [{ kind: 'planning_window', localId: 'tomorrow', windowKind: 'relative_day', value: 'tomorrow', start: null, end: null }] },
    { planningIntent: 'discuss', add: [{ kind: 'task', localId: 'report', category: 'study', title: '研究室のレポート' }] },
  ];
  let nativeCalls = 0; let focusedCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name) {
      nativeCalls++;
      const step = steps.shift();
      if (!step) throw new Error('unexpected semantic request, including repair');
      content = JSON.stringify({ planningIntent: step.planningIntent, conversationActs: [], answer: null,
        delta: { add: step.add, patch: [], remove: [], relate: [], defer: [] } });
    } else if (schema === FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5.json_schema.name) {
      focusedCalls++;
      content = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const input: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', weekStartDate: '2026-08-24', checkpoint: null, legacyV5Checkpoint: null,
    input: { userId: 'synthetic-owner', conversationId: 'issue881-final-b-deadline-at-13', traceRequestId: '', inputStateRevision: 0,
      messages: [], userText: '', selectedDate: '2026-08-26', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-08-26T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
  let sequence = 0;
  async function turn(userText: string) {
    input.input.traceRequestId = `final-b:${++sequence}`;
    input.input.userText = userText;
    const output = await executeDurableVNextTurn(env, input, (_raw, send) => send());
    const checkpoint = parseWeeklyPlanningVNextSessionCheckpoint({ raw: output.checkpointAfter!, ownerId: input.input.userId, weekStartDate: input.weekStartDate });
    if (!checkpoint) throw new Error('Worker returned unreadable checkpoint');
    expect(output.result.failure).toBeUndefined();
    expect(output.result.draftCandidates).toEqual([]);
    expect(checkpoint.vnext.preview).toBeNull();
    expect(compareRealApiDateMeaning({ graph: checkpoint.vnext.state.graph, requestContext: input.input.requestContext,
      oracle: { planningWindow: { startDate: '2026-08-27', endDate: '2026-08-27' } } })).toEqual([]);
    input.checkpoint = output.checkpointAfter;
    input.input.inputStateRevision = checkpoint.vnext.state.graph.revision;
    return checkpoint.vnext;
  }
  const before = await turn('明日の予定を立てたいです');
  expect(before.state.graph.tasks).toEqual([]);
  const after = await turn('研究室のレポートを仕上げたいです');
  expect(after.state.graph.planningWindows).toEqual(before.state.graph.planningWindows);
  expect(after.state.graph.tasks).toMatchObject([{ category: 'study', title: '研究室のレポート' }]);
  expect(after.state.graph.workloads).toEqual([]);
  expect(after.state.graph.effortEstimates).toEqual([]);
  const projection = projectWeeklyPlanningVNext(after.state);
  expect(projection.owners.flatMap(owner => owner.work)).toEqual([]);
  expect(projection.questions).toMatchObject([{ code: 'missing_schedulable_work', taskId: after.state.graph.tasks[0].id }]);
  expect(after.presentedQuestion?.questionKey).toBe(projection.questions[0].key);
  expect(nativeCalls).toBe(2);
  expect(focusedCalls).toBe(0);
  expect(steps).toEqual([]);
});
