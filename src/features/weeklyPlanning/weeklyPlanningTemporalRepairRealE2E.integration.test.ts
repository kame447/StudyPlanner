import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { minutesBetween } from '../../lib/date';
import * as schedulerCompiler from './semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './semantic/weeklyPlanningSemanticResponseValidationV5';
import { A, G, schedulingDocument, type Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';
import { liveATemporalDocument, LIVE_A_BOOK } from './testUtils/weeklyPlanningLiveTemporalFixture';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
  type ScriptedProviderCall,
  type ScriptedConversationTurn,
} from './testUtils/weeklyPlanningScriptedConversationHarness';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let semanticReply: (call: ScriptedProviderCall) => Json;
let compiler: MockInstance<typeof schedulerCompiler.compileGenericSchedulerInput>;

function responseForArchitecture(document: Json, call: ScriptedProviderCall): string {
  return JSON.stringify(call.schemaProperties.includes('conversationActs')
    ? document
    : Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'conversationActs')));
}

function bookFacts(graph: WeeklyPlanningFactGraphV5 | null) {
  expect(graph?.tasks).toEqual([
    expect.objectContaining({ title: 'アルゴリズムイントロダクション' }),
  ]);
  expect(graph?.workloads).toEqual([
    expect.objectContaining({ amount: 20, unitCode: 'page', quantityRole: 'target' }),
  ]);
  expect(graph?.effortEstimates).toEqual([
    expect.objectContaining({ minutes: 3, kind: 'duration_per_unit', unitCode: 'page' }),
  ]);
  expect(graph?.availabilityDeclarations).toEqual([
    expect.objectContaining({ kind: 'preferred', startTime: '20:00', recurrenceKind: 'weekdays' }),
  ]);
}

function genericRepairA(): Json {
  const initial = schedulingDocument('A');
  (initial.planningWindow as Json).value = '来週';
  Object.assign((initial.availabilityDeclarations as Json[])[0], {
    namedTimePeriod: 'custom:20時以降', startTime: null,
  });
  return initial;
}

function expectOneRepair(turn: ScriptedConversationTurn, schemaName: string) {
  expect(turn.calls.filter((call) => call.kind !== 'renderer').map((call) => call.schemaName))
    .toEqual(['weekly_planning_semantic_document_v5', schemaName]);
}

beforeEach(() => {
  resetScriptedConversationRuntime();
  compiler = vi.spyOn(schedulerCompiler, 'compileGenericSchedulerInput');
  semanticReply = () => schedulingDocument('A');
  provider = installScriptedWeeklyPlanningProvider((call) => call.kind === 'renderer'
    ? scriptedRendererReply(call, '候補が1件できました。「この内容で仮予定にする」を押してください。')
    : responseForArchitecture(semanticReply(call), call));
});

afterEach(() => {
  provider.restore();
  vi.restoreAllMocks();
  resetScriptedConversationRuntime();
});

describe('real E2E A/G request clock and repair boundaries', () => {
  it.each([false, true])('live A preserves the explicit weekday preference (material binding repair=%s)', async (repair) => {
    let calls = 0;
    semanticReply = () => liveATemporalDocument(repair && calls++ === 0);
    const conversation = createScriptedConversation({
      provider, studyMaterials: [LIVE_A_BOOK], now: () => '2026-10-07T15:01:00.000Z',
    });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.graph()?.availabilityDeclarations[0]).toMatchObject({
      recurrenceKind: 'weekdays', startTime: '20:00',
      days: ['weekday:monday', 'weekday:tuesday', 'weekday:wednesday', 'weekday:thursday', 'weekday:friday'],
    });
    const compiled = compiler.mock.results.filter((result) => result.type === 'return')
      .map((result) => result.value).reverse().find((result) => result.status === 'ready')?.input;
    expect(compiled?.preferredPlacements).toHaveLength(5);
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 }),
    ]);
  });

  // The request clock is Wednesday 10/7 19:18 JST, as in real scenario A.
  // An unrelated calendar navigation must neither anchor 来週 to the UI nor
  // cause a fallback to the current week.
  for (const architecture of ['interaction_v1', 'legacy_v5'] as const) {
    it.each(['2026-09-28', '2026-10-05', '2026-10-19'])(
      `A anchors next week to the request clock in ${architecture}, with UI week %s`,
      async (weekStartDate) => {
        const conversation = createScriptedConversation({
          provider, architecture, weekStartDate, now: () => '2026-10-07T10:18:00.000Z',
        });
        const turn = await conversation.submit(A);
        expect(turn.result?.failure).toBeUndefined();
        bookFacts(conversation.graph());
        const candidates = turn.result?.draftCandidates ?? [];
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
          date: '2026-10-12', startTime: '20:00', endTime: '21:10', durationMinutes: 70,
        });
        expect(conversation.graph()?.planningWindows).toEqual([
          expect.objectContaining({ value: 'next_week' }),
        ]);
      },
    );
  }

  it.each([
    { now: '2026-10-11T14:59:30.000Z', nextMonday: '2026-10-12' },
    { now: '2026-10-11T15:00:00.000Z', nextMonday: '2026-10-19' },
  ])('captures the JST Sunday/Monday boundary at $now', async ({ now, nextMonday }) => {
    const conversation = createScriptedConversation({ provider, now: () => now });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: nextMonday, startTime: '20:00', durationMinutes: 70 }),
    ]);
    const request = turn.calls.find((call) => call.kind === 'semantic_generic')!;
    expect((request.payload?.publicStateSummary as Json).calendarContext).toMatchObject({
      currentDate: now === '2026-10-11T14:59:30.000Z' ? '2026-10-11' : '2026-10-12',
      timeZone: 'Asia/Tokyo',
    });
  });

  it('A keeps all supplied facts across a generic relative-window and explicit-clock repair', async () => {
    const initial = genericRepairA();
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(initial), { currentUserText: A });
    expect(validation.errors).toHaveLength(2);
    expect(validation.errors).toContain('document.planningWindow.value:canonical-relative-week:来週');
    expect(validation.errors.some((error) => error.includes('explicit clock text must use startTime/endTime'))).toBe(true);
    let calls = 0;
    semanticReply = () => calls++ === 0 ? initial : schedulingDocument('A');
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expectOneRepair(turn, 'weekly_planning_semantic_document_v5');
    bookFacts(conversation.graph());
    expect(conversation.getState().intakeState?.lastQuestionContext).toBeFalsy();
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 }),
    ]);
    // The repair reuses the original user request, rather than just the broken field.
    const repair = turn.calls.filter((call) => call.kind === 'semantic_generic')[1];
    expect(repair.messages.some((message) => message.role === 'user' && message.content.includes(A))).toBe(true);
    expect(repair.messages.some((message) => message.role === 'assistant' && message.content === JSON.stringify(initial))).toBe(true);
  });

  it('A rejects a repair that silently drops material, amount, pace and preferred hours', async () => {
    let calls = 0;
    semanticReply = () => calls++ === 0 ? genericRepairA() : schedulingDocument('A', {
      planningIntent: 'discuss', tasks: [], availabilityDeclarations: [],
    });
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expectOneRepair(turn, 'weekly_planning_semantic_document_v5');
    expect(turn.result?.draftCandidates).toEqual([]);
    expect(conversation.graph()?.tasks ?? []).toEqual([]);
    expect(JSON.stringify(turn.debugTrace)).toContain('semantic-repair-preservation');
  });

  it('A focused window repair changes only the invalid date representation', async () => {
    const initial = schedulingDocument('A');
    Object.assign(initial.planningWindow as Json, {
      kind: 'absolute', value: '来週', start: null, end: null,
    });
    semanticReply = (call) => call.schemaName === 'weekly_planning_focused_planning_window_repair_v5'
      ? { value: '2026-10-12/2026-10-18', start: '2026-10-12', end: '2026-10-18' }
      : initial;
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expectOneRepair(turn, 'weekly_planning_focused_planning_window_repair_v5');
    bookFacts(conversation.graph());
    expect(turn.result?.draftCandidates).toEqual([
      expect.objectContaining({ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 }),
    ]);
  });

  it('G moves an excluded-clock constraint into plan-wide unavailability without dropping the deadline or work', async () => {
    const initial = schedulingDocument('G');
    const task = (initial.tasks as Json[])[0];
    const excluded = (initial.availabilityDeclarations as Json[])[0];
    initial.availabilityDeclarations = [];
    (task.temporalConstraints as Json[]).push({
      localId: 'excluded', targetLocalId: 'book', kind: 'excluded_date', constraintLevel: 'hard',
      dateExpression: excluded.dateExpression, namedTimePeriod: null, startTime: '20:00', endTime: '22:00',
      precision: 'exact', sourceText: excluded.sourceText,
    });
    semanticReply = (call) => call.schemaName === 'weekly_planning_focused_temporal_scope_repair_v5'
      ? { decision: 'plan_unavailable' }
      : initial;
    const conversation = createScriptedConversation({ provider, weekStartDate: '2026-10-12', now: () => '2026-10-13T11:00:00.000Z' });
    const turn = await conversation.submit(G);
    expect(turn.result?.failure).toBeUndefined();
    expectOneRepair(turn, 'weekly_planning_focused_temporal_scope_repair_v5');
    expect(conversation.graph()?.workloads).toEqual([expect.objectContaining({ amount: 12, unitCode: 'page' })]);
    expect(conversation.graph()?.effortEstimates).toEqual([expect.objectContaining({ minutes: 5 })]);
    expect(conversation.graph()?.temporalConstraints).toEqual([
      expect.objectContaining({ kind: 'deadline', dateExpression: '2026-10-16' }),
    ]);
    expect(conversation.graph()?.availabilityDeclarations).toEqual([
      expect.objectContaining({ kind: 'unavailable', dateExpression: 'weekday:tuesday', startTime: '20:00', endTime: '22:00' }),
    ]);
    const candidates = turn.result?.draftCandidates ?? [];
    expect(candidates).toHaveLength(1);
    for (const candidate of candidates) {
      expect(candidate.date <= '2026-10-16').toBe(true);
      expect(candidate.date > '2026-10-13' || candidate.startTime >= '22:00').toBe(true);
      expect(candidate.durationMinutes).toBe(70);
    }
  });

  it('G rejects a canonical-date repair that drops unrelated work and excluded hours', async () => {
    const initial = schedulingDocument('G');
    (initial.availabilityDeclarations as Json[])[0].dateExpression = '火曜';
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(initial), { currentUserText: G });
    expect(validation.errors).toEqual(['document.availabilityDeclarations[0].dateExpression:canonical-expression']);
    let calls = 0;
    semanticReply = () => calls++ === 0 ? initial : schedulingDocument('G', {
      planningIntent: 'discuss', tasks: [], availabilityDeclarations: [],
    });
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(G);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expectOneRepair(turn, 'weekly_planning_semantic_document_v5');
    expect(turn.result?.draftCandidates).toEqual([]);
    expect(JSON.stringify(turn.debugTrace)).toContain('semantic-repair-preservation');
  });

  it.each(['interaction_v1', 'legacy_v5'] as const)('G keeps deadline, pace and excluded hours through canonical-date repair in %s', async (architecture) => {
    const initial = schedulingDocument('G');
    (initial.availabilityDeclarations as Json[])[0].dateExpression = '火曜';
    let calls = 0;
    semanticReply = () => calls++ === 0 ? initial : schedulingDocument('G');
    const conversation = createScriptedConversation({
      provider, architecture, weekStartDate: '2026-10-12', now: () => '2026-10-13T11:00:00.000Z',
    });
    const turn = await conversation.submit(G);
    expect(turn.result?.failure).toBeUndefined();
    expectOneRepair(turn, 'weekly_planning_semantic_document_v5');
    expect(conversation.graph()?.workloads).toEqual([expect.objectContaining({ amount: 12 })]);
    expect(conversation.graph()?.effortEstimates).toEqual([expect.objectContaining({ minutes: 5 })]);
    const candidates = turn.result?.draftCandidates ?? [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].date <= '2026-10-16').toBe(true);
    expect(candidates[0].date > '2026-10-13' || candidates[0].startTime >= '22:00').toBe(true);
  });

  it.each(['A', 'G'] as const)('%s keeps raw work time distinct from the actual preview allocation', async (scenario) => {
    semanticReply = () => schedulingDocument(scenario);
    const conversation = createScriptedConversation({ provider });
    const turn = await conversation.submit(scenario === 'A' ? A : G);
    expect(turn.result?.failure).toBeUndefined();
    const schedulerInput = compiler.mock.results.filter((result) => result.type === 'return')
      .map((result) => result.value).reverse().find((result) => result.status === 'ready')?.input;
    expect(schedulerInput?.movableWorkItems).toEqual([
      expect.objectContaining({ baseEstimatedMinutes: 60, estimatedMinutes: 70 }),
    ]);
    const candidates = turn.result?.draftCandidates ?? [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].durationMinutes).toBe(70);
    expect(minutesBetween(candidates[0].startTime, candidates[0].endTime)).toBe(70);
    // The renderer receives the typed preview goal and is told to leave actual
    // slot details to the preview, rather than claim raw work time is the slot.
    const renderer = turn.calls.find((call) => call.kind === 'renderer')!;
    expect((renderer.payload?.applicationDecision as Json).communication).toMatchObject({ goal: 'present_preview' });
    expect(renderer.payload?.request).toContain('候補の日時・回数・時間帯など中身は書かず');
  });
});
