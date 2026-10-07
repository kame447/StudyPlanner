import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as schedulerCompiler from './semantic/weeklyPlanningGenericSchedulerInput';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

import { A, G, declaration, schedulingDocument, type Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let response: Json;
let compiler: MockInstance<typeof schedulerCompiler.compileGenericSchedulerInput>;
beforeEach(() => {
  resetScriptedConversationRuntime();
  compiler = vi.spyOn(schedulerCompiler, 'compileGenericSchedulerInput');
  provider = installScriptedWeeklyPlanningProvider((call) => call.kind === 'renderer'
    ? scriptedRendererReply(call, '候補が1件できました。「この内容で仮予定にする」を押してください。')
    : call.kind === 'semantic_focused_contextual'
      ? JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target',
        effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null })
    : JSON.stringify(call.schemaProperties.includes('conversationActs')
      ? response
      : Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'conversationActs'))));
});
afterEach(() => {
  provider.restore();
  vi.restoreAllMocks();
  resetScriptedConversationRuntime();
});

describe('real E2E A/G scheduling constraints through the conversation runtime', () => {
  it.each(['interaction_v1', 'legacy_v5'] as const)('A preserves next-week and weekday after-20:00 preference through %s', async (architecture) => {
    response = schedulingDocument('A');
    const conversation = createScriptedConversation({ provider, architecture });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.graph()?.planningWindows).toEqual([
      expect.objectContaining({ kind: 'relative_week', value: 'next_week' }),
    ]);
    expect(conversation.graph()?.availabilityDeclarations).toEqual([
      expect.objectContaining({ kind: 'preferred', startTime: '20:00', recurrenceKind: 'weekdays' }),
    ]);
    const input = compiler.mock.results.filter((result) => result.type === 'return')
      .map((result) => result.value).reverse().find((result) => result.status === 'ready')?.input;
    expect(input?.horizon).toMatchObject({ startDate: '2026-10-12', endDate: '2026-10-18' });
    expect(input?.movableWorkItems).toEqual([
      expect.objectContaining({ baseEstimatedMinutes: 60, estimatedMinutes: 70 }),
    ]);
    expect(input?.preferredPlacements).toHaveLength(5);
    expect(input?.preferredPlacements[0]).toMatchObject({
      dates: ['2026-10-12'], window: { startMinute: 1200, endMinute: 1440 },
      sourceFactId: conversation.graph()!.availabilityDeclarations[0].id,
    });
    const candidates = turn.result?.draftCandidates ?? [];
    expect(candidates).toHaveLength(1);
    for (const candidate of candidates) {
      expect(candidate.date >= '2026-10-12' && candidate.date <= '2026-10-16').toBe(true);
      expect(candidate.startTime >= '20:00', JSON.stringify(candidate)).toBe(true);
      // 20 pages × 3 min = 60, 10% safety margin = 66, ceil to 5 minutes = 70.
      expect(candidate.durationMinutes).toBe(70);
    }
  });

  it('keeps the accepted week and preferred hours while a later short answer supplies the pace', async () => {
    response = schedulingDocument('A');
    (response.tasks as Json[])[0].effortEstimates = [];
    const conversation = createScriptedConversation({ provider });
    const setup = await conversation.submit('来週、アルゴリズムイントロダクションを20ページ読みたい。平日は20時以降がいい');
    expect(setup.result?.failure).toBeUndefined();
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
    const turn = await conversation.submit('1ページ3分くらいです');
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 }),
    ]);
  });

  it('never lets preferred hours overwrite a hard unavailable interval', async () => {
    response = schedulingDocument('A', {
      availabilityDeclarations: [declaration({}), declaration({
        localId: 'busy', kind: 'unavailable', startTime: '20:00', endTime: '21:00',
        constraintLevel: 'hard', sourceText: '平日20時から21時は予定がある',
      })],
    });
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(`${A}。平日20時から21時は予定がある`);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '21:10', durationMinutes: 70 }),
    ]);
  });

  it('keeps a preference soft and never expands a hard available interval to satisfy it', async () => {
    response = schedulingDocument('A', {
      availabilityDeclarations: [declaration({}), declaration({
        localId: 'available', kind: 'available', startTime: '10:00', endTime: '12:00',
        recurrenceKind: 'daily', constraintLevel: 'hard', sourceText: '使えるのは毎日10時から12時だけ',
      })],
    });
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(`${A}。使えるのは毎日10時から12時だけ`);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '10:00', endTime: '11:10' }),
    ]);
  });

  it('G preserves the deadline and avoids Tuesday 20–22 when planning starts in that very interval', async () => {
    response = schedulingDocument('G');
    const conversation = createScriptedConversation({
      provider, weekStartDate: '2026-10-12', now: () => '2026-10-13T11:00:00.000Z',
    });
    const turn = await conversation.submit(G);
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.graph()?.temporalConstraints).toEqual([
      expect.objectContaining({ kind: 'deadline', dateExpression: '2026-10-16' }),
    ]);
    expect(conversation.graph()?.availabilityDeclarations).toEqual([
      expect.objectContaining({ kind: 'unavailable', startTime: '20:00', endTime: '22:00' }),
    ]);
    const candidates = turn.result?.draftCandidates ?? [];
    expect(candidates).toHaveLength(1);
    for (const candidate of candidates) {
      expect(candidate.date <= '2026-10-16').toBe(true);
      expect(candidate.date > '2026-10-13' || candidate.startTime >= '22:00').toBe(true);
      // 12 pages × 5 min is the same estimated work as A, not a fixed +10-minute cost.
      expect(candidate.durationMinutes).toBe(70);
    }
  });
});
