import { afterEach, describe, expect, it } from 'vitest';
import type { StudyMaterial } from '../../types/domain';
import { CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP, conditionDocument, conditionSetupDocument, conditionFollowupDocument } from './testUtils/weeklyPlanningConditionPropagationFixture';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply, type ScriptedConversation } from './testUtils/weeklyPlanningScriptedConversationHarness';

import captured from './testUtils/weeklyPlanningRound2DurationFixture.json';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

describe('live D duration answer citing the accepted workload public ID', () => {
  it.each(['initial', 'schema-valid-reread'] as const)('binds %s without a repair or replaying accepted quantities', async route => {
    let conversation: ScriptedConversation;
    let followupCalls = 0;
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return scriptedRendererReply(call, '候補を確認してください。');
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null });
      let document: Record<string, unknown>;
      if (call.payload?.userText === CONDITION_SETUP) document = conditionSetupDocument();
      else {
        followupCalls += 1;
        document = conditionFollowupDocument(conversation.graph()!);
        const tasks = document.tasks as Array<Record<string, unknown>>;
        if (route === 'schema-valid-reread' && followupCalls === 1) {
          document = conditionDocument({ planningIntent: 'update_plan', tasks: tasks.map(task => ({ ...task, effortEstimates: [], temporalConstraints: [] })) });
        } else {
          const research = tasks.find(task => (task.effortEstimates as unknown[]).length > 0)!;
          const estimate = (research.effortEstimates as Array<Record<string, unknown>>)[0];
          estimate.targetLocalId = conversation.graph()!.workloads.find(workload => workload.taskId === research.existingPublicId)!.id;
        }
      }
      return JSON.stringify(document);
    });
    conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    await conversation.submit(CONDITION_SETUP);
    const paced = await conversation.submit(CONDITION_PACE);
    expect(paced.result?.failure).toBeUndefined();
    const before = structuredClone(conversation.graph())!;
    const turn = await conversation.submit(CONDITION_FOLLOWUP);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.result?.interactionOutcome?.kind).toBe('apply');
    const graph = conversation.graph()!;
    const research = graph.tasks.find(task => task.title === '卒業研究ノート')!;
    const acceptedWorkload = before.workloads.find(workload => workload.taskId === research.id)!;
    expect(graph.workloads).toEqual(before.workloads);
    expect(graph.effortEstimates.filter(estimate => estimate.kind === 'session_duration')).toEqual([
      expect.objectContaining({ targetFactId: acceptedWorkload.id, minutes: 60 }),
    ]);
    expect(graph.effortEstimates.filter(estimate => estimate.kind === 'duration_per_unit')).toEqual(before.effortEstimates.filter(estimate => estimate.kind === 'duration_per_unit'));
    expect(turn.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(route === 'initial' ? 1 : 2);
    expect(turn.debugTrace.filter(event => event.stage === 'semantic_repair_prepared')).toEqual([]);
    const candidates = conversation.getState().previewCandidates!;
    expect(candidates.every(candidate => candidate.startTime >= '21:00')).toBe(true);
    expect(candidates.filter(candidate => (candidate as typeof candidate & { stableV5Metadata?: { taskId: string } }).stableV5Metadata?.taskId === research.id).map(candidate => candidate.durationMinutes)).toEqual([60, 60]);
  }, 20_000);
});


it('replays both public duration citations from the sanitized v91e-D1 capture and keeps the session cap', async () => {
  const fixture = captured.publicDuration;
  let conversation: ScriptedConversation;
  let followups = 0;
  const bind = (document: unknown) => JSON.stringify(document).replace(/\$accepted-task-(\d+)/g, (_token, index: string) => conversation.graph()!.tasks[Number(index)].id)
    .replace(/\$accepted-workload-(\d+)/g, (_token, index: string) => conversation.graph()!.workloads[Number(index)].id);
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, '候補を確認してください。');
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit', minutes: 3, precision: 'approximate', quantityRole: null });
    if (call.payload?.userText === fixture.setupUserText) return JSON.stringify(fixture.setupDocument);
    return bind(followups++ === 0 ? fixture.firstDocument : fixture.rereadDocument);
  });
  conversation = createScriptedConversation({ provider, ownerId: 'duration-capture-owner', architecture: 'interaction_v1', studyMaterials: fixture.materials as StudyMaterial[] });
  const setup = await conversation.submit(fixture.setupUserText);
  expect(setup.result?.failure, JSON.stringify(setup.debugTrace.filter(event => event.stage === 'semantic_validation_result'))).toBeUndefined();
  const pace = await conversation.submit(CONDITION_PACE);
  expect(pace.result?.failure, JSON.stringify(pace.debugTrace.filter(event => event.stage === 'semantic_validation_result'))).toBeUndefined();
  const before = structuredClone(conversation.graph())!;
  const turn = await conversation.submit(fixture.followupUserText);
  expect(turn.result?.failure).toBeUndefined();
  expect(turn.result?.interactionOutcome?.kind).toBe('apply');
  expect(turn.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(2);
  expect(turn.debugTrace.filter(event => event.stage === 'semantic_repair_prepared')).toEqual([]);
  const graph = conversation.graph()!;
  expect(graph.workloads).toEqual(before.workloads);
  expect(graph.effortEstimates.filter(estimate => estimate.kind === 'session_duration').map(estimate => estimate.targetFactId).sort())
    .toEqual(before.workloads.map(workload => workload.id).sort());
  const candidates = conversation.getState().previewCandidates!;
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates.every(candidate => candidate.startTime >= '21:00' && candidate.durationMinutes <= 60)).toBe(true);
  const book = candidates.filter(candidate => candidate.title.includes('テスト読書教材'));
  expect(book.reduce((total, candidate) => total + candidate.durationMinutes, 0)).toBe(60);
  expect(candidates.filter(candidate => candidate.title.includes('テスト研究メモ')).map(candidate => candidate.durationMinutes)).toEqual([60, 60]);
}, 20_000);
