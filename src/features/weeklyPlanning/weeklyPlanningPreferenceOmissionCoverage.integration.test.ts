import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../types/domain';
import captured from './testUtils/weeklyPlanningRound2DurationFixture.json';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply, type ScriptedConversation } from './testUtils/weeklyPlanningScriptedConversationHarness';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

describe('live D omitted preference, with workload cost already known', () => {
  it.each(['missing', 'fully_covered', 'audit_complete', 'audit_malformed', 'reread_invalid_then_repair', 'repair_still_invalid', 'reread_drops_split', 'repair_drops_split'] as const)('uses only AI meaning under the literal-coverage gate (%s)', async scenario => {
    const fixture = captured.omittedNight;
    let conversation: ScriptedConversation;
    let followups = 0;
    const bind = (document: unknown) => JSON.stringify(document)
      .replace(/\$accepted-task-(\d+)/g, (_token, index: string) => conversation.graph()!.tasks[Number(index)].id)
      .replace(/\$accepted-workload-(\d+)/g, (_token, index: string) => conversation.graph()!.workloads[Number(index)].id);
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, '候補を確認してください。');
      if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') {
        if (scenario === 'fully_covered') throw new Error('fully covered turn must not dispatch an audit');
        if (scenario === 'audit_malformed') return 'invalid audit fixture';
        return JSON.stringify({ decision: scenario === 'audit_complete' ? 'complete' : 'incomplete', missingFacts: scenario === 'audit_complete' ? [] : ['explicit night preference applies to both accepted tasks'] });
      }
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null });
      if (call.payload?.userText === fixture.setupUserText) return JSON.stringify(fixture.setupDocument);
      const document = structuredClone(fixture.firstDocument);
      const followupIndex = followups++;
      if (scenario === 'fully_covered' || followupIndex > 0) for (const [index, task] of document.tasks.entries()) {
        Object.assign(task, { temporalConstraints: [{ localId: `night-${index}`, targetLocalId: task.localId, kind: 'preferred_window', constraintLevel: 'soft',
          dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'approximate', sourceText: 'どっちも夜がいい' }] });
      }
      if (((scenario === 'reread_invalid_then_repair' || scenario === 'repair_drops_split') && followupIndex === 1)
        || (scenario === 'repair_still_invalid' && followupIndex > 0)) document.tasks[0].effortEstimates[0].minutes = -1;
      if ((scenario === 'reread_drops_split' && followupIndex > 0) || (scenario === 'repair_drops_split' && followupIndex > 1)) for (const task of document.tasks) { task.effortEstimates = []; task.recurrence = []; }
      return bind(document);
    }, { completenessAudit: 'scripted' });
    conversation = createScriptedConversation({ provider, ownerId: 'duration-capture-owner', architecture: 'interaction_v1', studyMaterials: fixture.materials as StudyMaterial[] });
    const setup = await conversation.submit(fixture.setupUserText);
    expect(setup.result?.failure).toBeUndefined();
    const paced = await conversation.submit('1ページ3分くらい');
    expect(paced.result?.failure).toBeUndefined();
    const before = structuredClone(conversation.graph())!;
    const turn = await conversation.submit(fixture.followupUserText);
    if (scenario === 'repair_still_invalid') {
      expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
      expect(turn.debugTrace.filter(event => event.stage === 'semantic_repair_prepared')).toHaveLength(1);
      expect(conversation.graph()).toEqual(before);
      return;
    }
    expect(turn.result?.failure).toBeUndefined();
    const audit = 'weekly_planning_dense_turn_completeness_audit_v5';
    const generic = 'weekly_planning_semantic_document_v5';
    const renderer = 'weekly_planning_stable_v5_dialogue_response';
    const expected = scenario === 'fully_covered' ? [generic, renderer]
      : scenario === 'audit_complete' || scenario === 'audit_malformed' ? [generic, audit, renderer]
      : scenario === 'reread_invalid_then_repair' || scenario === 'repair_drops_split' ? [generic, audit, generic, generic, renderer]
      : [generic, audit, generic, renderer];
    expect(turn.calls.map(call => call.schemaName)).toEqual(expected);
    expect(turn.debugTrace.filter(event => event.stage === 'semantic_repair_prepared')).toHaveLength(scenario === 'reread_invalid_then_repair' || scenario === 'repair_drops_split' ? 1 : 0);
    if (scenario === 'audit_malformed') expect(turn.debugTrace.find(event => event.stage === 'semantic_evidence_coverage_abstained')?.data)
      .toMatchObject({ reason: 'malformed_audit_response' });
    expect(conversation.graph()!.workloads).toEqual(before.workloads);
    const nightApplied = scenario !== 'audit_complete' && scenario !== 'audit_malformed' && scenario !== 'reread_drops_split' && scenario !== 'repair_drops_split';
    expect(conversation.graph()!.temporalConstraints.filter(constraint => constraint.kind === 'preferred_window')).toHaveLength(nightApplied ? 2 : 0);
    if (scenario === 'reread_drops_split' || scenario === 'repair_drops_split') {
      expect(conversation.graph()!.effortEstimates.filter(fact => fact.kind === 'session_duration')).toHaveLength(2);
      expect(turn.debugTrace.find(event => event.stage === 'semantic_evidence_coverage_abstained')?.data).toMatchObject({ reason: 'initial_facts_not_preserved', step: 'retry' });
    }
    const candidates = conversation.getState().previewCandidates!;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(candidate => candidate.durationMinutes <= 60)).toBe(true);
    if (nightApplied) expect(candidates.every(candidate => candidate.startTime >= '21:00')).toBe(true);
    else expect(candidates.some(candidate => candidate.startTime < '21:00')).toBe(true);
  });
});

it('keeps legacy effort/timing turns on their exact existing dispatch path', async () => {
  const { CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP, conditionSetupDocument, conditionFollowupDocument } = await import('./testUtils/weeklyPlanningConditionPropagationFixture');
  let conversation: ScriptedConversation;
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '候補を確認してください。');
    if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') throw new Error('legacy must not add a literal-coverage audit');
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null });
    const document = call.payload?.userText === CONDITION_SETUP ? conditionSetupDocument() : conditionFollowupDocument(conversation.graph()!);
    if (call.payload?.userText !== CONDITION_SETUP) for (const task of document.tasks as Array<Record<string, unknown>>) task.temporalConstraints = [];
    const { conversationActs: _acts, ...legacy } = document;
    return JSON.stringify(legacy);
  }, { completenessAudit: 'scripted' });
  conversation = createScriptedConversation({ provider, architecture: 'legacy_v5' });
  await conversation.submit(CONDITION_SETUP);
  await conversation.submit(CONDITION_PACE);
  const turn = await conversation.submit(CONDITION_FOLLOWUP);
  expect(turn.result?.failure).toBeUndefined();
  expect(turn.calls.map(call => call.kind)).toEqual(['semantic_generic', 'renderer']);
  expect(turn.debugTrace.filter(event => event.stage === 'semantic_evidence_coverage_eligibility')).toEqual([]);
  expect(conversation.graph()!.temporalConstraints).toEqual([]);
});
