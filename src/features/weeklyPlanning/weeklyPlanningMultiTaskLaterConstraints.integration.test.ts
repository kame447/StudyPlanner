import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  scriptedRendererReply, type ScriptedConversation,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import {
  CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP, conditionSetupDocument,
  conditionFollowupDocument, conditionDocument,
} from './testUtils/weeklyPlanningConditionPropagationFixture';
import { A, declaration, type Json } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';
import { taskTemporalPreferenceDocument } from './testUtils/weeklyPlanningLiveTemporalFixture';
import { weeklyPlanningPreviewConstraintDisclosureText } from './dialogue/weeklyPlanningPreviewOmissionDisclosure';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let conversation: ScriptedConversation;
let delta: Json;
let rendererText: string;
beforeEach(() => {
  resetScriptedConversationRuntime();
  rendererText = '候補を確認してください。';
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, rendererText);
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({
      decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
      minutes: 3, precision: 'approximate', quantityRole: null,
    });
    const document = call.payload?.userText === CONDITION_SETUP ? conditionSetupDocument() : delta;
    return JSON.stringify(call.schemaProperties.includes('conversationActs') ? document
      : Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'conversationActs')));
  });
  conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

async function setup() {
  await conversation.submit(CONDITION_SETUP);
  const turn = await conversation.submit(CONDITION_PACE);
  expect(turn.result?.failure).toBeUndefined();
  expect(conversation.getState().previewCandidates).toHaveLength(2);
}

function researchCandidates() {
  return conversation.getState().previewCandidates!.filter(candidate => candidate.title.includes('卒業研究ノート'));
}

function activeIds() {
  return new Set(conversation.graph()!.factLifecycles.filter(fact => fact.status === 'active').map(fact => fact.factId));
}

describe('Scenario D: later constraint scopes and corrections through complete turns', () => {
  it.each(['task', 'preferred', 'available', 'mixed'] as const)('accepts equivalent weekday alternatives without falsely warning about unused days (%s)', async scope => {
    delta = taskTemporalPreferenceDocument();
    if (scope !== 'task') {
      const task = (delta.tasks as Json[])[0];
      const windows = task.temporalConstraints as Json[];
      delta.availabilityDeclarations = windows.slice(scope === 'mixed' ? 1 : 0).map(fact => declaration({
        localId: fact.localId, kind: scope === 'mixed' ? 'available' : scope, dateExpression: null,
        recurrenceKind: 'weekly', days: [fact.dateExpression], sourceText: fact.sourceText,
      }));
      task.temporalConstraints = scope === 'mixed' ? windows.slice(0, 1) : [];
    }
    const turn = await conversation.submit(A);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer']);
    expect(turn.result?.draftCandidates).toMatchObject([{ date: '2026-10-12', startTime: '20:00', durationMinutes: 70 }]);
    expect(turn.result?.communicationFacts?.previewConstraintSatisfaction?.map(fact => fact.status))
      .toEqual(['satisfied', 'satisfied', 'satisfied', 'satisfied', 'satisfied']);
    expect(turn.result?.message).not.toContain('合わない候補');
  });

  it.each(['interaction_v1', 'legacy_v5'] as const)('applies a plan-wide evening preference to both tasks without extending the research-only session length (%s)', async architecture => {
    conversation = createScriptedConversation({ provider, architecture });
    await setup();
    delta = conditionFollowupDocument(conversation.graph()!);
    for (const task of delta.tasks as Json[]) task.temporalConstraints = [];
    delta.availabilityDeclarations = [declaration({
      startTime: null, endTime: null, namedTimePeriod: 'night', recurrenceKind: 'daily',
      sourceText: 'どっちも夜がいい',
    })];
    const previous = structuredClone(conversation.getState().previewCandidates);
    const turn = await conversation.submit(CONDITION_FOLLOWUP);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.preserveExistingPreview).not.toBe(true);
    expect(conversation.getState().previewCandidates).not.toEqual(previous);
    expect(conversation.getState().previewCandidates).toHaveLength(3);
    expect(conversation.getState().previewCandidates!.every(candidate => candidate.startTime >= '21:00')).toBe(true);
    expect(turn.result?.draftCandidates!.filter(candidate => candidate.title.includes('卒業研究ノート'))
      .map(candidate => candidate.durationMinutes)).toEqual([60, 60]);
    const research = conversation.graph()!.tasks.find(task => task.title === '卒業研究ノート')!;
    expect(conversation.graph()!.effortEstimates.filter(estimate => estimate.kind === 'session_duration'))
      .toMatchObject([{ taskId: research.id, targetFactId: research.id, minutes: 60 }]);
    const satisfaction = turn.result?.communicationFacts?.previewConstraintSatisfaction;
    if (architecture === 'interaction_v1') {
      expect(satisfaction).toHaveLength(3);
      expect(satisfaction!.every(fact => fact.status === 'satisfied')).toBe(true);
    } else expect(satisfaction).toBeUndefined();
  });

  it('keeps a research-only evening preference off the book', async () => {
    await setup();
    delta = conditionFollowupDocument(conversation.graph()!);
    (delta.tasks as Json[])[0].temporalConstraints = [];
    const turn = await conversation.submit(CONDITION_FOLLOWUP);
    expect(turn.result?.failure).toBeUndefined();
    expect(researchCandidates().every(candidate => candidate.startTime >= '18:00')).toBe(true);
    expect(conversation.getState().previewCandidates!.find(candidate => candidate.title.includes('アルゴリズム'))!.startTime)
      .toBe('09:00');
  });

  it('replaces the session length again while retaining both tasks and their evening constraints', async () => {
    await setup();
    delta = conditionFollowupDocument(conversation.graph()!);
    await conversation.submit(CONDITION_FOLLOWUP);
    const previous = structuredClone(conversation.getState().previewCandidates);
    const graph = conversation.graph()!;
    const session = graph.effortEstimates.find(estimate => estimate.kind === 'session_duration')!;
    const text = '卒業研究ノートはやっぱり1回30分にして';
    const task = (conditionFollowupDocument(graph).tasks as Json[])[1];
    task.sourceText = text;
    task.temporalConstraints = [];
    task.effortEstimates = [{
      ...(task.effortEstimates as Json[])[0], minutes: 30, sourceText: '1回30分にして',
    }];
    delta = conditionDocument({ planningIntent: 'update_plan', tasks: [task], corrections: [{
      localId: 'replace-session', target: { kind: 'effort_estimate', publicId: session.id, localId: null, mention: null },
      operation: 'replace', replacementLocalId: 'session-size', sourceText: text,
    }] });
    const turn = await conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.getState().previewCandidates).not.toEqual(previous);
    expect(conversation.getState().previewCandidates).toHaveLength(5);
    expect(researchCandidates()).toHaveLength(4);
    expect(turn.result?.draftCandidates!.filter(candidate => candidate.title.includes('卒業研究ノート'))
      .map(candidate => candidate.durationMinutes)).toEqual([30, 30, 30, 30]);
    expect(conversation.getState().previewCandidates!.every(candidate => candidate.startTime >= '18:00')).toBe(true);
    expect(conversation.graph()!.tasks.filter(task => activeIds().has(task.id))).toHaveLength(2);
    expect(conversation.graph()!.effortEstimates.filter(estimate => activeIds().has(estimate.id) && estimate.kind === 'session_duration'))
      .toMatchObject([{ minutes: 30 }]);
  });

  it('corrects only the book workload without losing research sessions or either evening preference', async () => {
    await setup();
    delta = conditionFollowupDocument(conversation.graph()!);
    await conversation.submit(CONDITION_FOLLOWUP);
    const graph = conversation.graph()!;
    const book = graph.tasks.find(task => task.title === 'アルゴリズムイントロダクション')!;
    const oldWork = graph.workloads.find(work => work.taskId === book.id)!;
    const text = 'アルゴリズムイントロダクションは10ページに減らして';
    const task = (conditionFollowupDocument(graph).tasks as Json[])[0];
    task.sourceText = text;
    task.temporalConstraints = [];
    task.workloads = [{
      localId: 'new-pages', quantityRole: 'target', amount: 10, unitCode: 'page', unitLabel: 'ページ',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '10ページに減らして',
    }];
    delta = conditionDocument({ planningIntent: 'update_plan', tasks: [task], corrections: [{
      localId: 'replace-pages', target: { kind: 'workload', publicId: oldWork.id, localId: null, mention: null },
      operation: 'replace', replacementLocalId: 'new-pages', sourceText: text,
    }] });
    const turn = await conversation.submit(text);
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.graph()!.tasks.filter(task => activeIds().has(task.id))).toHaveLength(2);
    expect(conversation.graph()!.workloads.filter(work => activeIds().has(work.id)).map(work => [work.unitCode, work.amount]))
      .toEqual(expect.arrayContaining([['page', 10], ['hour', 2]]));
    expect(conversation.getState().previewCandidates).toHaveLength(3);
    expect(researchCandidates()).toHaveLength(2);
    expect(conversation.getState().previewCandidates!.every(candidate => candidate.startTime >= '18:00')).toBe(true);
  });

  it.each([
    ['false-claim', 'task'], ['neutral', 'task'], ['false-claim', 'preferred'], ['false-claim', 'available'],
  ] as const)('discloses an infeasible evening preference with a %s renderer response (%s)', async (response, scope) => {
    await setup();
    delta = conditionFollowupDocument(conversation.graph()!);
    delta.availabilityDeclarations = [declaration({
      kind: 'available', startTime: '09:00', endTime: '12:00', recurrenceKind: 'daily',
      constraintLevel: 'hard', sourceText: '使えるのは毎日9時から12時だけ',
    })];
    if (scope !== 'task') {
      for (const task of delta.tasks as Json[]) task.temporalConstraints = [];
      (delta.availabilityDeclarations as Json[]).push(declaration({
        localId: 'soft-night', kind: scope, startTime: null, endTime: null, namedTimePeriod: 'night',
        recurrenceKind: 'daily', constraintLevel: 'soft', sourceText: 'どっちも夜がいい',
      }));
    }
    rendererText = response === 'false-claim'
      ? 'どちらも夜の候補を3件用意しました。「この内容で仮予定にする」を押してください。'
      : '候補が3件できました。「この内容で仮予定にする」を押してください。';
    const turn = await conversation.submit(`${CONDITION_FOLLOWUP}。使えるのは毎日9時から12時だけ`);
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.getState().previewCandidates).toHaveLength(3);
    expect(conversation.getState().previewCandidates!.every(candidate => candidate.endTime <= '12:00')).toBe(true);
    expect(turn.result?.message).not.toContain('どちらも夜の候補');
    expect(turn.result?.responseSource).toBe(response === 'false-claim' ? 'deterministic_fallback' : 'ai');
    const satisfaction = turn.result!.communicationFacts!.previewConstraintSatisfaction!;
    expect(satisfaction.filter(fact => fact.kind === 'preferred_window')).toMatchObject([
      { taskLabel: 'アルゴリズムイントロダクション', status: 'not_satisfied' },
      { taskLabel: '卒業研究ノート', status: 'not_satisfied' },
    ]);
    expect(satisfaction.find(fact => fact.kind === 'session_duration')?.status).toBe('satisfied');
    expect(turn.result?.message).toContain(weeklyPlanningPreviewConstraintDisclosureText(satisfaction));
    const renderer = turn.calls.find(call => call.kind === 'renderer')!;
    expect(renderer.payload?.applicationDecision).toMatchObject({ communication: { previewConstraintSatisfaction: satisfaction } });
  });

  it('clears the old preview when later hard availability cannot fit either task', async () => {
    await setup();
    delta = conditionFollowupDocument(conversation.graph()!);
    delta.availabilityDeclarations = [declaration({
      kind: 'available', startTime: '09:00', endTime: '09:30', recurrenceKind: 'daily',
      constraintLevel: 'hard', sourceText: '使えるのは毎日9時から9時半だけ',
    })];
    const turn = await conversation.submit(`${CONDITION_FOLLOWUP}。使えるのは毎日9時から9時半だけ`);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.draftCandidates).toEqual([]);
    expect(turn.result?.state.lastQuestionContext?.targetSlot).toBe('stable_v5:insufficient_capacity');
    expect(turn.result?.preserveExistingPreview).not.toBe(true);
    expect(conversation.getState().previewCandidates).toEqual([]);
    expect(turn.result?.communicationFacts?.previewConstraintSatisfaction).toBeUndefined();
  });
});
