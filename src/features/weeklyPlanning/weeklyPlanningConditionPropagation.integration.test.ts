import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime,
  type ScriptedConversation, type ScriptedProviderCall,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import {
  CONDITION_SETUP, CONDITION_PACE, CONDITION_FOLLOWUP, conditionSetupDocument,
  conditionFollowupDocument, conditionDocument,
} from './testUtils/weeklyPlanningConditionPropagationFixture';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let conversation: ScriptedConversation;
let omitConditions = false;

function reply(call: ScriptedProviderCall): string {
  if (call.kind === 'renderer') return 'renderer unavailable in fixture';
  if (call.kind === 'semantic_focused_contextual') return JSON.stringify({
    decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
    minutes: 3, precision: 'approximate', quantityRole: null,
  });
  const document = String(call.payload?.userText) === CONDITION_SETUP ? conditionSetupDocument()
    : omitConditions ? conditionDocument() : conditionFollowupDocument(conversation.graph()!);
  if (!call.schemaProperties.includes('conversationActs')) delete (document as Partial<typeof document>).conversationActs;
  return JSON.stringify(document);
}

beforeEach(() => {
  resetScriptedConversationRuntime();
  omitConditions = false;
  provider = installScriptedWeeklyPlanningProvider(reply);
  conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

describe('Scenario D: accepted split and evening preferences reach the new preview', () => {
  it.each(['interaction_v1', 'legacy_v5'] as const)('preserves both tasks and recomputes two research sessions in the evening (%s)', async (architecture) => {
    conversation = createScriptedConversation({ provider, architecture });
    await conversation.submit(CONDITION_SETUP);
    const initial = await conversation.submit(CONDITION_PACE);
    expect(initial.result?.failure).toBeUndefined();
    const initialPreview = conversation.getState().previewCandidates;
    expect(initialPreview).toHaveLength(2);
    const revision = conversation.graph()!.revision;
    const updated = await conversation.submit(CONDITION_FOLLOWUP);
    expect(updated.result?.failure).toBeUndefined();
    expect(conversation.graph()!.revision).toBeGreaterThan(revision);
    expect(conversation.graph()!.tasks.map((task) => task.title)).toEqual([
      'アルゴリズムイントロダクション', '卒業研究ノート',
    ]);
    expect(conversation.graph()!.workloads.map((workload) => workload.amount)).toEqual([20, 2]);
    expect(conversation.graph()!.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'session_duration', minutes: 60 }),
    ]));
    expect(conversation.graph()!.temporalConstraints).toHaveLength(2);
    expect(updated.result?.preserveExistingPreview).not.toBe(true);
    const preview = conversation.getState().previewCandidates!;
    expect(preview).not.toEqual(initialPreview);
    const research = preview.filter((candidate) => candidate.title.includes('卒業研究ノート'));
    expect(research).toHaveLength(2);
    const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
    expect(research.map((candidate) => minutes(candidate.endTime) - minutes(candidate.startTime))).toEqual([60, 60]);
    expect(preview.every((candidate) => candidate.startTime >= '18:00')).toBe(true);
    expect(preview.filter((candidate) => candidate.title.includes('アルゴリズムイントロダクション'))).toHaveLength(1);
    expect(updated.debugTrace.some((event) => event.stage === 'runtime_preview_scheduler_evaluated')).toBe(true);
    const renderer = updated.calls.find((call) => call.kind === 'renderer')!;
    expect(renderer.payload?.applicationDecision).toMatchObject({
      actionKind: 'preview_ready', previewCount: 3,
    });
  });

  it('marks an omitted semantic delta as an unchanged preview instead of reporting new conditions', async () => {
    await conversation.submit(CONDITION_SETUP);
    await conversation.submit(CONDITION_PACE);
    const graph = structuredClone(conversation.graph());
    const preview = structuredClone(conversation.getState().previewCandidates);
    omitConditions = true;
    const turn = await conversation.submit(CONDITION_FOLLOWUP);
    expect(conversation.graph()).toEqual({ ...graph, appliedTurnKeys: conversation.graph()!.appliedTurnKeys });
    expect(conversation.getState().previewCandidates).toEqual(preview);
    expect(turn.result?.communicationFacts?.statusReason).toBe('preview_unchanged');
    expect(turn.result?.preserveExistingPreview).toBe(true);
    expect(turn.calls.find((call) => call.kind === 'renderer')?.payload?.applicationDecision).toMatchObject({
      actionKind: 'status', communication: { goal: 'report_status', statusReason: 'preview_unchanged' },
    });
  });
});
