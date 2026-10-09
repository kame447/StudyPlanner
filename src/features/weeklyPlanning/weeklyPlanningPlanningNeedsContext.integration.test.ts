import { afterEach, describe, expect, it } from 'vitest';
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import type { Plan } from '../../types/domain';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply,
  type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

/*
 * Issue #488 P3 slice 2: the application states the planning NEEDS and what the calendar ALREADY answers (typed, in no fixed order);
 * the AI decides whether to ask, offer or propose. The context carries `planningNeeds` (blocking needs by typed code, no prose) and
 * `calendarFree` (free minutes and the largest free windows per day of the planning period). Interaction only; never sent to the
 * semantic model.
 */
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const doc = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
  availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...o });
const week = { localId: 'w', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const T1 = '来週は卒研を進めたい。できれば夜';
const busyPlan = (date: string, startTime: string, endTime: string): Plan => ({ id: `busy-${date}`, seriesId: `busy-${date}`, userId: 'issue488-owner', title: '塾', subject: '', date, startTime,
  endTime, repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'other', memo: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' } as Plan);

function install() {
  provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') {
      return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    }
    return JSON.stringify(doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [{ localId: 'thesis', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '卒研',
      study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], recurrence: [], durableContextSignals: [], sourceText: '卒研を進めたい',
      temporalConstraints: [{ localId: 'night', targetLocalId: 'thesis', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'unspecified', sourceText: 'できれば夜' }] }] }));
  });
}
const open = (o: { architecture?: 'interaction_v1' | 'legacy_v5'; plans?: Plan[] } = {}) => createScriptedConversation({ provider, architecture: o.architecture ?? 'interaction_v1', weekStartDate: '2026-10-12',
  now: () => '2026-10-08T00:00:00.000Z', ...(o.plans ? { plans: o.plans } : {}) });
const communicationOf = (turn: { calls: ScriptedProviderCall[] }) =>
  ((turn.calls.filter(call => call.kind === 'renderer').pop()?.payload?.applicationDecision as Json | undefined)?.communication ?? {}) as Json;

describe('S2 (critic probe 46): a proposal with clock times from the calendar is not rejected as ungrounded', () => {
  const run = async (text: string, plans: Plan[] = []) => {
    provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, text);
      if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
      return JSON.stringify(doc({ planningIntent: 'create_plan', planningWindow: week, tasks: [{ localId: 'thesis', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: '卒研',
        study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], recurrence: [], durableContextSignals: [], sourceText: '卒研を進めたい',
        temporalConstraints: [{ localId: 'night', targetLocalId: 'thesis', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'unspecified', sourceText: 'できれば夜' }] }] }));
    });
    return open({ plans }).submit(T1);
  };
  it('live-F T1, a scripted proposal with times inside the free window: AI reply, no fallback, no percentage text', async () => {
    const turn = await run('来週は火曜の20:00から21:00が空いています。この時間で卒研を進めますか？');
    expect(turn.result?.responseSource).toBe('ai');
    expect(turn.result?.message).toContain('20:00から21:00');
    expect(turn.result?.message).not.toMatch(/100%|割合|何%/);
  });
  it('probe 48: the owner\'s example 「月曜と水曜の夜に1時間ずつ空きがあります」 is an AI reply (a duration is not a clock time), no fallback, no percentage text', async () => {
    const turn = await run('月曜と水曜の夜に1時間ずつ空きがあります。この時間で進めますか？');
    expect(turn.result?.responseSource).toBe('ai');
    expect(turn.result?.message).toContain('1時間ずつ');
    expect(turn.result?.message).not.toMatch(/100%|割合|何%/);
  });
  it('probe 48: 「火曜の夜8時から9時は空いています」 is grounded as 20:00-21:00 inside the free window (AI reply)', async () => {
    const turn = await run('火曜の夜8時から9時は空いています。この時間で卒研を進めますか？');
    expect(turn.result?.responseSource).toBe('ai');
    expect(turn.result?.message).not.toMatch(/100%|割合|何%/);
  });
  it('probe 48: 「火曜の夜の8時から9時」 is grounded as 20:00-21:00 on the first reply (no repair needed)', async () => {
    const turn = await run('火曜の夜の8時から9時は空いています。この時間で卒研を進めますか？');
    expect(turn.result?.responseSource).toBe('ai');
    expect(turn.calls.filter(call => call.kind === 'renderer')).toHaveLength(1);
  });
  it('a real clock time stays checked in interaction: 「1時に」 (01:00) is outside every free window and falls back', async () => {
    const turn = await run('火曜の1時に空きがあります。この時間で卒研を進めますか？');
    expect(turn.result?.responseSource).not.toBe('ai');
  });
  it('a time outside every free window of the period falls back (still ungrounded)', async () => {
    const turn = await run('来週は火曜の6:00から7:00が空いています。この時間で卒研を進めますか？');
    expect(turn.result?.responseSource).not.toBe('ai');
  });
  it('a time on a fully busy named day falls back', async () => {
    const turn = await run('10月12日の20:00から21:00が空いています。この時間で卒研を進めますか？', [busyPlan('2026-10-12', '09:00', '22:00')]);
    expect(turn.result?.responseSource).not.toBe('ai');
  });
});

describe('S2: planning needs and the calendar already known reach the AI as typed context', () => {
  it('the amount question carries the typed planning needs (no fixed order, no prose) and the free calendar of the period', async () => {
    install();
    const turn = await open({ plans: [busyPlan('2026-10-12', '09:00', '22:00')] }).submit(T1);
    const communication = communicationOf(turn);
    expect(communication.planningNeeds).toEqual([expect.objectContaining({ need: 'missing_schedulable_work', targetFactId: expect.any(String) })]);
    const free = communication.calendarFree as Array<{ date: string; freeMinutes: number; windows: string[] }>;
    expect(free).toHaveLength(7);
    expect(free.map(entry => entry.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    // The all-day busy Monday has no free time (the +-10 minute buffer swallows the whole 09:00-22:00 day); the others have the default day.
    expect(free[0].freeMinutes).toBe(0);
    expect(free[0].windows).toEqual([]);
    expect(free[1].freeMinutes).toBeGreaterThan(600);
    expect(free[1].windows.length).toBeGreaterThan(0);
    expect(free[1].windows.length).toBeLessThanOrEqual(3);
    expect(free[1].windows[0]).toMatch(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
  });
  it('a partly busy day shows the free windows around the busy slot', async () => {
    install();
    const free = communicationOf(await open({ plans: [busyPlan('2026-10-13', '12:00', '14:00')] }).submit(T1)).calendarFree as Array<{ date: string; freeMinutes: number; windows: string[] }>;
    const tuesday = free.find(entry => entry.date === '2026-10-13')!;
    expect(tuesday.windows).toEqual(expect.arrayContaining([expect.stringMatching(/^09:00-11:50$/), expect.stringMatching(/^14:10-22:00$/)]));
    expect(tuesday.freeMinutes).toBe(11 * 60 + 50 - 9 * 60 + 22 * 60 - (14 * 60 + 10));
  });
  it('legacy_v5 carries neither field; the semantic request never carries them', async () => {
    install();
    const legacy = await open({ architecture: 'legacy_v5' }).submit(T1);
    expect(JSON.stringify(legacy.calls.map(call => call.messages))).not.toMatch(/calendarFree|planningNeeds/);
    install();
    const interaction = await open().submit(T1);
    expect(JSON.stringify(interaction.calls.filter(call => call.kind.startsWith('semantic')).map(call => call.messages))).not.toMatch(/calendarFree|planningNeeds/);
  });
  it('a question that is NOT an amount question (the work_breakdown clarification) carries no calendar', async () => {
    provider = installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
      return JSON.stringify(doc({ planningIntent: 'create_plan', planningWindow: week,
        tasks: [{ localId: 'thesis', existingPublicId: null, decompositionStatus: 'needs_breakdown', category: 'study', title: '卒研',
          study: { purpose: 'self_study', activityKind: 'other', contextLabel: null, components: [] }, workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
          durableContextSignals: [], sourceText: '卒研を進めたい' }],
        uncertainties: [{ localId: 'u', targetLocalId: 'thesis', field: 'work_breakdown', reason: 'r', sourceText: '卒研を進めたい' }] }));
    });
    const conversation = open();
    const turn = await conversation.submit(T1);
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:semantic_uncertainty');
    expect(communicationOf(turn).calendarFree).toBeUndefined();
  });
  it('questions that do not ask for an amount carry no calendar (bytes only where the AI may propose)', async () => {
    install();
    const turn = await open().submit('こんにちは');
    expect(communicationOf(turn).calendarFree).toBeUndefined();
  });
});
