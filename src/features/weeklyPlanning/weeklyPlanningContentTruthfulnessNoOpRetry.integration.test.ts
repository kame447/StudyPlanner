import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScriptedConversation,
  installScriptedWeeklyPlanningProvider,
  resetScriptedConversationRuntime,
  scriptedRendererReply,
} from './testUtils/weeklyPlanningScriptedConversationHarness';
import { WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT } from './dialogue/weeklyPlanningInteractionFallbackText';
import { A, schedulingDocument } from './testUtils/weeklyPlanningSchedulingConstraintsFixture';
import type { WeeklyPlanningConversationArchitecture } from './weeklyPlanningConversationArchitecture';

// Live B T4 (round 3b): the reading named the accepted task without a change, the bounded re-read
// came back empty (valid, no task, no act) and was accepted as "the plan is unchanged" with the
// promotion control although the message was never used.
type Json = Record<string, unknown>;
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

const BASE = { schemaVersion: 'weekly-planning-semantic-v5', planningWindow: null, relations: [], availabilityDeclarations: [],
  constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };

async function secondTurn(params: {
  architecture: WeeklyPlanningConversationArchitecture;
  reread: Json;
}) {
  let turn2 = false;
  let semanticCalls = 0;
  provider = installScriptedWeeklyPlanningProvider(call => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, turn2
      ? '青チャートについてですね。候補はこのままです。「この内容で仮予定にする」で確定できます。'
      : '候補を用意しました。内容を確認してください。');
    if (!turn2) return JSON.stringify(schedulingDocument('A'));
    semanticCalls += 1;
    if (semanticCalls > 1) return JSON.stringify(params.reread);
    const tasks = (call.payload!.publicStateSummary as Json).tasks as Json[];
    return JSON.stringify({ ...BASE, planningIntent: 'update_plan',
      tasks: [{ localId: 'shell', existingPublicId: tasks[0].publicId, decompositionStatus: 'atomic', category: 'study',
        title: 'アルゴリズムイントロダクション', study: { purpose: 'self_study', activityKind: 'unknown', contextLabel: '青チャート', components: [] },
        workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
        sourceText: '青チャートのこと' }],
      conversationActs: [] });
  });
  const conversation = createScriptedConversation({ provider, architecture: params.architecture });
  await conversation.submit(A);
  const previewBefore = structuredClone(conversation.getState().previewCandidates);
  const graphBefore = structuredClone(conversation.graph());
  turn2 = true;
  const result = await conversation.submit('青チャートのこと');
  return { conversation, result, previewBefore, graphBefore };
}

const EMPTY = { ...BASE, planningIntent: 'update_plan', tasks: [], conversationActs: [] };

describe('a re-read that carries nothing is an unusable message, never an unchanged plan', () => {
  it('interaction: valid empty re-read → recover, application unchanged sentence, no promotion, nothing applied', async () => {
    const { conversation, result, previewBefore, graphBefore } = await secondTurn({ architecture: 'interaction_v1', reread: EMPTY });
    expect(result.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'semantic' });
    expect(result.result?.message).toContain(WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT);
    expect(result.result?.message).not.toContain('この内容で仮予定にする');
    expect(conversation.getState().previewCandidates).toEqual(previewBefore);
    expect(conversation.graph()?.tasks).toEqual(graphBefore?.tasks);
    expect(result.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(2);
  });

  it('a self-sufficient act in the re-read still carries the turn', async () => {
    const { result } = await secondTurn({ architecture: 'interaction_v1',
      reread: { ...EMPTY, conversationActs: [{ kind: 'topic_shift', targetPublicId: null }] } });
    expect(result.result?.interactionOutcome?.kind).not.toBe('recover');
  });

  it('legacy keeps its behaviour for the same readings', async () => {
    const { result } = await secondTurn({ architecture: 'legacy_v5', reread: { ...EMPTY, conversationActs: undefined } });
    expect(result.result?.interactionOutcome).toBeUndefined();
  });
});
