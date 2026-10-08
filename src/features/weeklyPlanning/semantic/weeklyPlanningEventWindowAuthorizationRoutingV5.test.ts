import '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from '../testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventRendererReply, eventStudyTask } from '../testUtils/weeklyPlanningFixedEventOnlyFixture';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { provider?.restore(); resetScriptedConversationRuntime(); });

describe.each(['legacy_v5', 'interaction_v1'] as const)('authorization transport stays semantically safe (%s)', architecture => {
  it.each(['study', 'non_study'] as const)('preserves validation/preview and study focus dispatches for %s', async category => {
    let phase = 0;
    const text = category === 'study' ? '数学を20分勉強する' : '散歩を20分する';
    const task = { ...eventStudyTask(), category, title: category === 'study' ? '数学' : '散歩', study: category === 'study' ? eventStudyTask().study : null,
      sourceText: text, workloads: [{ ...eventStudyTask().workloads[0], sourceText: text }] };
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return eventRendererReply(call);
      if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'create_plan' });
      return JSON.stringify(eventDocument({ planningIntent: phase ? 'create_plan' : 'discuss', tasks: phase ? [] : [task], ...(architecture === 'interaction_v1' ? { conversationActs: [] } : {}) }));
    });
    const conversation = createScriptedConversation({ provider, architecture, now: () => '2026-10-07T00:00:00.000Z' });
    const first = await conversation.submit(text);
    expect(first.result?.failure).toBeUndefined();
    expect(first.result?.state.status).toBe('needs_scope');
    expect(first.result?.state.lastQuestionContext).toBeUndefined();
    expect(first.result?.draftCandidates).toEqual([]);
    phase = 1;
    const authorized = await conversation.submit('この条件で予定を作って');
    expect(authorized.result?.failure).toBeUndefined();
    expect(authorized.calls.map(call => call.kind)).toEqual([
      architecture === 'interaction_v1' && category === 'non_study' ? 'semantic_generic' : 'semantic_focused_authorization', 'renderer',
    ]);
    expect(authorized.result?.draftCandidates).toHaveLength(1);
    expect(authorized.result?.state.shouldSavePlan).not.toBe(true);
  });
});
