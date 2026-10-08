// Load the lazily imported runtime outside the individual turn's test timer.
import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { focusedMaterialConversationFixture, FOCUSED_MATERIAL_SCHEMA, MATERIAL_NAME, MATERIAL_PACE, MATERIAL_SETUP, MATERIAL_WHY, MATERIAL_MIXED, MATERIAL_SHORT_MIXED, MATERIAL_DIGIT_REMAINDER, materialAnswerForRequestedSchema, mixedMaterialDocument } from './testUtils/weeklyPlanningFocusedMaterialAnswerFixture';
import { resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import type { WeeklyPlanningSemanticDocumentV5 } from './semantic/weeklyPlanningSemanticDocumentV5';

let fixture: ReturnType<typeof focusedMaterialConversationFixture>;
afterEach(() => { fixture?.provider.restore(); resetScriptedConversationRuntime(); });
describe('typed material answers through the real controller', () => {
  it.each([MATERIAL_NAME, MATERIAL_PACE, MATERIAL_MIXED])('uses one semantic and one renderer call for the narrow answer %s', async (text) => {
    fixture = focusedMaterialConversationFixture();
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter(call => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter(call => call.kind === 'renderer')).toHaveLength(1);
    expect(turn.calls).toHaveLength(2);
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
  });

  it('carries material and pace through the four-turn B replay into a preview without required questions', async () => {
    fixture = focusedMaterialConversationFixture();
    for (const text of [MATERIAL_SETUP, MATERIAL_WHY, MATERIAL_PACE]) {
      const turn = await fixture.conversation.submit(text);
      expect(turn.result?.failure).toBeUndefined();
      expect(turn.result?.draftCandidates).toHaveLength(0);
    }
    const turn = await fixture.conversation.submit(MATERIAL_NAME);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ role: 'material', label: '青チャート' })]);
    expect(active.effortEstimates).toEqual([expect.objectContaining({ kind: 'duration_per_unit', minutes: 3, unitCode: 'problem' })]);
    expect(active.uncertainties).toEqual([]);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
    expect(turn.result?.state.lastQuestionContext).toBeUndefined();
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
    expect(turn.calls.filter(call => call.kind === 'renderer')).toHaveLength(1);
    const decision = turn.calls.find(call => call.kind === 'renderer')!.payload!.applicationDecision;
    expect(decision).toMatchObject({ actionKind: 'preview_ready', questionCode: null, communication: { askQuestion: false } });
  });

  it.each(['material_answer', 'effort_answer'] as const)('never treats a whole-reply quote as complete coverage for %s', async (shape) => {
    fixture = focusedMaterialConversationFixture({ genericReply: mixedMaterialDocument, focusedReply: (call) => materialAnswerForRequestedSchema(call,
      shape, shape === 'material_answer' ? { label: '青チャート', sourceText: MATERIAL_SHORT_MIXED }
        : { workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: MATERIAL_SHORT_MIXED }) });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit(MATERIAL_SHORT_MIXED);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3 }));
    expect(active.uncertainties).toEqual([]);
  });
  it('keeps an unregistered name inside a whole effort span as an open material need', async () => {
    const text = '新発見ドリル、1問3分';
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => materialAnswerForRequestedSchema(call,
      'effort_answer', { workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: text }) });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const before = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    const turn = await fixture.conversation.submit(text);
    const after = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(0);
    expect(after.components).toEqual(before.components);
    expect(after.uncertainties).toEqual(before.uncertainties);
    expect(after.effortEstimates).toContainEqual(expect.objectContaining({ targetFactId: before.workloads[0].id, minutes: 3 }));
    expect(turn.result?.draftCandidates).toHaveLength(0);
  });
  it.each([
    { text: 'focus gold、金曜は部活で無理', label: 'Focus Gold' },
    { text: 'ＦＯＣＵＳ GOLD、金曜は部活で無理', label: 'FOCUS GOLD' },
  ])('falls through when the normalized label $label has no literal anchor', async ({ text, label }) => {
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => materialAnswerForRequestedSchema(call,
      'material_answer', { label, sourceText: text }), genericReply: () => '{}' });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const before = structuredClone(fixture.conversation.graph()!);
    const turn = await fixture.conversation.submit(text);
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(2);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(fixture.conversation.graph()).toEqual(before);
  });
  it('treats repeated exact-workload pace as the existing fact when material and pace are answered together', async () => {
    fixture = focusedMaterialConversationFixture();
    await fixture.conversation.submit(MATERIAL_SETUP);
    await fixture.conversation.submit(MATERIAL_PACE);
    const estimate = structuredClone(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).effortEstimates[0]);
    await fixture.conversation.submit(MATERIAL_PACE);
    const turn = await fixture.conversation.submit(MATERIAL_MIXED);
    expect(turn.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.effortEstimates).toEqual([estimate]);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.uncertainties).toEqual([]);
    expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
  });
  it('keeps different pace values for the existing choose-one question', async () => {
    const text = '青チャートです。1問4分くらい';
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => materialAnswerForRequestedSchema(call,
      call.payload?.currentUserText === MATERIAL_PACE ? 'effort_answer' : 'material_and_effort_answer',
      call.payload?.currentUserText === MATERIAL_PACE
        ? { workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: MATERIAL_PACE }
        : { label: '青チャート', sourceText: '青チャート', effortSourceText: '1問4分くらい', workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 4, precision: 'approximate' }) });
    await fixture.conversation.submit(MATERIAL_SETUP);
    await fixture.conversation.submit(MATERIAL_PACE);
    const original = structuredClone(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).effortEstimates[0]);
    const turn = await fixture.conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.effortEstimates).toContainEqual(original);
    expect(active.effortEstimates.map((estimate) => estimate.minutes)).toEqual([3, 4]);
    expect(fixture.conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:ambiguous_effort_estimate');
    expect(turn.result?.draftCandidates).toHaveLength(0);
  });
  it.each([3, 4])('compares repeated pace %s only with active per-unit estimates when a session duration also exists', async (minutes) => {
    const sessionAndPace = '1回30分で、1問3分くらい';
    const text = `青チャート、1問${minutes}分`;
    fixture = focusedMaterialConversationFixture({
      focusedReply: call => call.payload?.currentUserText === text
        ? materialAnswerForRequestedSchema(call, 'material_and_effort_answer', { label: '青チャート', sourceText: '青チャート',
          effortSourceText: `1問${minutes}分`, workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes, precision: 'approximate' })
        : materialAnswerForRequestedSchema(call, 'fallback'),
      genericReply: call => {
        const document = JSON.parse(mixedMaterialDocument(call)) as WeeklyPlanningSemanticDocumentV5;
        const task = document.tasks[0];
        task.study = null;
        task.effortEstimates.push({ ...task.effortEstimates[0], localId: 'session', kind: 'session_duration', minutes: 30,
          unitCode: 'session', sourceText: '1回30分' });
        return JSON.stringify(document);
      },
    });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const setup = await fixture.conversation.submit(sessionAndPace);
    expect(setup.result?.failure).toBeUndefined();
    const before = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(before.effortEstimates.map(estimate => [estimate.kind, estimate.minutes])).toEqual([
      ['duration_per_unit', 3], ['session_duration', 30],
    ]);
    const turn = await fixture.conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    for (const estimate of before.effortEstimates) expect(active.effortEstimates).toContainEqual(estimate);
    expect(active.effortEstimates.filter(estimate => estimate.kind === 'session_duration')).toEqual([
      before.effortEstimates.find(estimate => estimate.kind === 'session_duration'),
    ]);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.uncertainties).toEqual([]);
    expect(turn.calls.filter(call => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(0);
    if (minutes === 3) {
      expect(active.effortEstimates).toEqual(before.effortEstimates);
      expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
      expect(turn.result?.state.lastQuestionContext).toBeUndefined();
    } else {
      expect(active.effortEstimates.filter(estimate => estimate.kind === 'duration_per_unit').map(estimate => estimate.minutes)).toEqual([3, 4]);
      expect(fixture.conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:ambiguous_effort_estimate');
      expect(turn.result?.draftCandidates).toHaveLength(0);
    }
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
  });
  it.each([
    { text: '1問3分くらい。金曜は部活で無理', combined: false, friday: true },
    { text: MATERIAL_MIXED, combined: true, friday: false },
    { text: '1問3分くらいだと思います', combined: false, friday: false },
  ])('falls through for a broad effort span in $text with one extra semantic call', async ({ text, combined, friday }) => {
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => materialAnswerForRequestedSchema(call,
      combined ? 'material_and_effort_answer' : 'effort_answer', {
        label: combined ? '青チャート' : null, sourceText: combined ? '青チャート' : text,
        effortSourceText: combined ? text : null, workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate',
      }), genericReply: (call) => {
        const value = JSON.parse(mixedMaterialDocument(call)) as { tasks: Array<{ study: unknown }>; availabilityDeclarations: unknown[] };
        if (!combined) value.tasks[0].study = null;
        if (friday) value.availabilityDeclarations = [{ localId: 'friday-busy', kind: 'unavailable', dateExpression: '2026-10-16', namedTimePeriod: null,
          startTime: null, endTime: null, recurrenceKind: null, days: [], constraintLevel: 'hard', capacityMinutes: null, sourceText: '金曜は部活で無理' }];
        return JSON.stringify(value);
      },
    });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3 }));
    if (friday) expect(active.availabilityDeclarations).toContainEqual(expect.objectContaining({ source: expect.objectContaining({ sourceText: '金曜は部活で無理' }) }));
    if (!combined) {
      expect(active.uncertainties).toHaveLength(1);
      expect(turn.result?.draftCandidates).toHaveLength(0);
    }
  });
  it('covers digits inside a literal registered material label in one focused call', async () => {
    fixture = focusedMaterialConversationFixture({ registeredMaterialName: 'ターゲット1900', focusedReply: (call) => materialAnswerForRequestedSchema(call,
      'material_answer', { label: 'ターゲット1900', registeredChoice: 'm1', sourceText: 'ターゲット1900のこと' }) });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit('ターゲット1900のこと');
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(0);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ label: 'ターゲット1900' })]);
    expect(active.uncertainties).toEqual([]);
  });
  it.each([
    { label: 'REFERENCE', name: 'REFERENCE', aliases: [] },
    { label: 'ALIAS', name: 'Catalogue title', aliases: ['alias'] },
  ])('uses typed registered name or case-folded alias evidence for $label without adopting a whole effort quote', async ({ label, name, aliases }) => {
    const text = `${label}、1問3分`;
    fixture = focusedMaterialConversationFixture({ registeredMaterialName: name, registeredMaterialAliases: aliases,
      focusedReply: (call) => materialAnswerForRequestedSchema(call, 'effort_answer', {
        workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: text,
      }), genericReply: (call) => {
        const value = JSON.parse(mixedMaterialDocument(call)) as { tasks: Array<{ study: { components: Array<{ label: string; sourceText: string }> }; effortEstimates: Array<{ sourceText: string }> }> };
        value.tasks[0].study.components[0].label = label;
        value.tasks[0].study.components[0].sourceText = label;
        value.tasks[0].effortEstimates[0].sourceText = '1問3分';
        return JSON.stringify(value);
      },
    });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ label })]);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3 }));
    expect(active.uncertainties).toEqual([]);
  });
  it('falls through for an uncited sub-K4 numeric remainder instead of dropping its duration', async () => {
    fixture = focusedMaterialConversationFixture({ genericReply: mixedMaterialDocument,
      focusedReply: (call) => materialAnswerForRequestedSchema(call, 'material_answer', { label: '青チャート', sourceText: '青チャート' }) });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit(MATERIAL_DIGIT_REMAINDER);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ kind: 'total_duration', minutes: 3 }));
  });
  it.each(['青チャートのこと', '青チャートです', '青チャートのことです', 'えっと、青チャートです'])('reports conservative focused call cost for %s', async (text) => {
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => materialAnswerForRequestedSchema(call,
      'material_answer', { label: '青チャート', sourceText: '青チャート' }), genericReply: (call) => {
      const value = JSON.parse(mixedMaterialDocument(call)) as { tasks: Array<{ effortEstimates: unknown[] }> };
      value.tasks[0].effortEstimates = []; return JSON.stringify(value);
    } });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(['青チャートのこと', '青チャートです'].includes(text) ? 0 : 1);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).components).toEqual([expect.objectContaining({ label: '青チャート' })]);
  });
  it.each(['material_answer', 'effort_answer', 'combined'] as const)('never commits a short mixed half under %s', async (shape) => {
    fixture = focusedMaterialConversationFixture({ genericReply: mixedMaterialDocument, focusedReply: (call) => materialAnswerForRequestedSchema(call,
      shape === 'combined' ? 'material_and_effort_answer' : shape,
      shape === 'combined' ? { label: '青チャート', sourceText: '青チャート', effortSourceText: '1問3分', workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate' }
        : shape === 'material_answer' ? { label: '青チャート', sourceText: '青チャート' }
        : { workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: '1問3分' }) });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const workId = fixture.conversation.graph()!.workloads[0].id;
    const turn = await fixture.conversation.submit(MATERIAL_SHORT_MIXED);
    expect(turn.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ targetFactId: workId, minutes: 3 }));
    expect(active.uncertainties).toEqual([]);
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(shape === 'combined' ? 0 : 1);
  });
  it.each(['combined', 'material_answer', 'effort_answer', 'fallback'] as const)('never commits half of a mixed reply when the focused model returns %s', async (shape) => {
    fixture = focusedMaterialConversationFixture({ genericReply: mixedMaterialDocument, focusedReply: (call) => materialAnswerForRequestedSchema(call,
      shape === 'combined' ? 'material_and_effort_answer' : shape,
      shape === 'combined' ? { label: '青チャート', sourceText: '青チャート', effortSourceText: '1問3分くらい', workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate' }
        : shape === 'material_answer' ? { label: '青チャート', sourceText: '青チャート' }
        : shape === 'effort_answer' ? { workloadChoice: 'w1', effortKind: 'duration_per_unit', minutes: 3, precision: 'approximate', sourceText: '1問3分くらい' } : {}),
    });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const originalWork = structuredClone(fixture.conversation.graph()!.workloads[0]);
    const turn = await fixture.conversation.submit(MATERIAL_MIXED);
    expect(turn.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3, targetFactId: originalWork.id }));
    expect(active.workloads).toEqual([expect.objectContaining({ id: originalWork.id, amount: 20, source: originalWork.source })]);
    expect(active.uncertainties).toEqual([]);
    expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(shape === 'combined' ? 0 : 1);
  });
  it.each([false, true])('falls through with only the remaining generic repair budget (focused repair consumed=%s)', async (repaired) => {
    let focused = 0; let generic = 0;
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => {
      if (repaired && focused++ === 0) return '{}';
      return materialAnswerForRequestedSchema(call, 'material_answer', { label: '青チャート', sourceText: '青チャート' });
    }, genericReply: (call) => ++generic === 1 ? '{}' : mixedMaterialDocument(call) });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const original = structuredClone(fixture.conversation.graph()!);
    const turn = await fixture.conversation.submit(MATERIAL_MIXED);
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(repaired ? 2 : 1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(repaired ? 1 : 2);
    if (repaired) {
      expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
      expect(fixture.conversation.graph()).toEqual(original);
    } else {
      expect(turn.result?.failure).toBeUndefined();
      expect(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3 }));
    }
  });
  it.each(['!!!', '\u200b'])('preserves material and its need for evidence-empty label %j', async (label) => {
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => materialAnswerForRequestedSchema(call, 'material_answer', { label, sourceText: '青チャート' }), genericReply: () => '{}' });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const original = structuredClone(fixture.conversation.graph()!);
    const turn = await fixture.conversation.submit(MATERIAL_NAME);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(fixture.conversation.graph()).toEqual(original);
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(2);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
  });
  it.each(['fallback', 'invalid'] as const)('keeps the generic route after an exhausted focused %s repair without another repair', async (shape) => {
    let focused = 0;
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => focused++ === 0 || shape === 'invalid'
      ? '{}' : materialAnswerForRequestedSchema(call, 'fallback'), genericReply: mixedMaterialDocument });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit(MATERIAL_MIXED);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(2);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3 }));
    expect(active.uncertainties).toEqual([]);
    const decision = turn.debugTrace.filter((event) => event.stage === 'semantic_normalizer_decision').slice(-1)[0]!.data as { diagnostics: { repairAttempted: boolean; attemptCount: number } };
    expect(decision.diagnostics).toMatchObject({ repairAttempted: true, attemptCount: 3 });
  });
  it('rejects a malformed generic initial after a still-invalid focused repair without a second repair', async () => {
    fixture = focusedMaterialConversationFixture({ focusedReply: () => '{}', genericReply: () => '{}' });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const before = structuredClone(fixture.conversation.graph()!);
    const turn = await fixture.conversation.submit(MATERIAL_MIXED);
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(fixture.conversation.graph()).toEqual(before);
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(2);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
  });
  it.each([false, true])('refuses a second repair after the completeness re-read (dense=%s)', async (dense) => {
    let focused = 0; let generic = 0;
    fixture = focusedMaterialConversationFixture({
      focusedReply: (call) => focused++ === 0 ? '{}' : materialAnswerForRequestedSchema(call,
        'material_answer', { label: '青チャート', sourceText: '青チャート' }),
      completenessAuditReply: () => JSON.stringify({ decision: 'incomplete', missingFacts: ['The current per-problem effort estimate is missing.'] }),
      genericReply: (call) => {
        if (++generic !== 1) return '{}';
        const value = JSON.parse(mixedMaterialDocument(call)) as { tasks: Array<{ effortEstimates: unknown[] }> };
        value.tasks[0].effortEstimates = [];
        return JSON.stringify(value);
      },
    });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const before = structuredClone(fixture.conversation.graph()!);
    const turn = await fixture.conversation.submit(MATERIAL_MIXED + (dense ? 'のこと'.repeat(200) : ''));
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(2);
    expect(turn.calls.filter((call) => call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5')).toHaveLength(1);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(2);
    const attempts = turn.debugTrace.filter((event) => event.stage === 'semantic_provider_request')
      .map((event) => (event.data as { attempt: string }).attempt);
    expect(attempts).toEqual(['focused_material_answer', 'focused_material_answer_repair', 'initial', 'dense_completeness_audit', 'dense_completeness_retry']);
    expect(turn.result?.failure).toBeUndefined();
    // The approved completeness floor accepts the valid initial material meaning.
    // Earlier accepted amounts, ids and sources still survive the invalid reread.
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    // Material naming rebases the component reference, preserving each accepted
    // workload's identity, amount and exact source under the same task owner.
    expect(fixture.conversation.graph()!.workloads).toEqual(before.workloads.map(workload => ({
      ...workload, componentId: active.components[0].id,
    })));
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.effortEstimates).toEqual([]);
    const pending = fixture.conversation.getState().intakeState?.lastQuestionContext;
    expect(pending?.targetSlot).toBe('stable_v5:missing_effort_estimate');
    expect(turn.result?.draftCandidates).toEqual([]);
    expect(turn.debugTrace).toContainEqual(expect.objectContaining({ stage: 'semantic_validation_result',
      data: expect.objectContaining({ attempt: 'completeness_floor:repair_budget_consumed', accepted: true }) }));
    const decision = turn.debugTrace.filter((event) => event.stage === 'semantic_normalizer_decision').slice(-1)[0]!.data as { status: string; diagnostics: { repairAttempted: boolean; attemptCount: number } };
    expect(decision.status).toBe('accepted');
    expect(decision.diagnostics).toMatchObject({ repairAttempted: true, attemptCount: 5 });
  });
  it('reports a consumed focused repair when the later generic interpretation succeeds without another repair', async () => {
    let attempt = 0;
    fixture = focusedMaterialConversationFixture({ focusedReply: (call) => attempt++ === 0 ? '{}' : materialAnswerForRequestedSchema(call,
      'material_answer', { label: '青チャート', sourceText: '青チャート' }), genericReply: mixedMaterialDocument });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const turn = await fixture.conversation.submit(MATERIAL_MIXED);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(2);
    expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!).effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3 }));
    const decision = turn.debugTrace.filter((event) => event.stage === 'semantic_normalizer_decision').slice(-1)[0]!.data as { diagnostics: { repairAttempted: boolean; attemptCount: number } };
    expect(decision.diagnostics).toMatchObject({ repairAttempted: true, attemptCount: 3 });
  });
  it.each(['shell', 'topic_shift', 'relabel', 'bookshelf_reference'] as const)('handles live %s variance while identity is pending, retaining pace and exact question', async (genericShape) => {
    fixture = focusedMaterialConversationFixture({ genericShape });
    const { conversation } = fixture;
    await conversation.submit(MATERIAL_SETUP);
    const old = structuredClone(conversation.graph()!);
    const question = conversation.getState().intakeState?.lastQuestionContext;
    const why = await conversation.submit(MATERIAL_WHY);
    expect(why.result?.failure).toBeUndefined();
    expect(conversation.graph()).toEqual({ ...old, appliedTurnKeys: [...old.appliedTurnKeys, `${conversation.conversationId}:${why.requestId}`] });
    expect(conversation.getState().intakeState?.lastQuestionContext?.topicId).toBe(question?.topicId);
    const pace = await conversation.submit(MATERIAL_PACE);
    expect(pace.result?.failure).toBeUndefined();
    expect(pace.result?.draftCandidates).toHaveLength(0);
    const paced = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    expect(paced.effortEstimates).toContainEqual(expect.objectContaining({ targetFactId: old.workloads[0].id, minutes: 3 }));
    expect(paced.uncertainties).toHaveLength(1);
    const named = await conversation.submit(MATERIAL_NAME);
    expect(named.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    expect(active.tasks).toHaveLength(1);
    expect(active.workloads).toEqual([expect.objectContaining({ id: old.workloads[0].id, amount: 20, source: old.workloads[0].source })]);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.uncertainties).toHaveLength(0);
    expect(named.result!.draftCandidates.length).toBeGreaterThan(0);
    expect(conversation.getState().intakeState?.lastQuestionContext).toBeUndefined();
    for (const turn of [why, pace, named]) {
      expect(turn.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
      expect(turn.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(0);
    }
  });
  it.each(['pending_bookshelf', 'pending_pace_drop'] as const)('replays captured %s with the task-level material field and no initial component', async (captureCase) => {
    fixture = focusedMaterialConversationFixture({ captureCase });
    await fixture.conversation.submit(MATERIAL_SETUP);
    const work = structuredClone(fixture.conversation.graph()!.workloads[0]);
    expect(fixture.conversation.graph()!.components.filter((fact) => fact.role === 'material')).toHaveLength(0);
    expect(fixture.conversation.graph()!.uncertainties[0].field).toBe('material');
    await fixture.conversation.submit(MATERIAL_WHY);
    const pace = await fixture.conversation.submit(MATERIAL_PACE);
    expect(pace.result?.failure).toBeUndefined();
    expect(pace.result?.draftCandidates).toHaveLength(0);
    expect(fixture.conversation.graph()!.effortEstimates).toContainEqual(expect.objectContaining({ targetFactId: work.id, minutes: 3 }));
    const named = await fixture.conversation.submit(MATERIAL_NAME);
    expect(named.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.components).toEqual([expect.objectContaining({ label: '青チャート' })]);
    expect(active.workloads).toEqual([expect.objectContaining({ id: work.id, amount: 20, source: work.source })]);
    expect(active.uncertainties).toHaveLength(0);
    expect(named.result!.draftCandidates.length).toBeGreaterThan(0);
    expect(named.calls.filter((call) => call.schemaName === FOCUSED_MATERIAL_SCHEMA)).toHaveLength(1);
    expect(named.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(0);
  });
});
