import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, expect, it } from 'vitest';
import { correctionReplacementRepairFixture, REPLACEMENT_REPLY_TEXT } from './testUtils/weeklyPlanningCorrectionReplacementRepairFixture';
import { resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';

let fixture: ReturnType<typeof correctionReplacementRepairFixture>;
afterEach(() => { fixture?.provider.restore(); resetScriptedConversationRuntime(); });

it.each(['include', 'drop', 'repeat'] as const)('unknown replacement correction uses one repair and preserves authority (%s)', async mode => {
  fixture = correctionReplacementRepairFixture(mode);
  await fixture.setup();
  const before = structuredClone(fixture.conversation.graph()!);
  const preview = structuredClone(fixture.conversation.getState().previewCandidates);
  const turn = await fixture.conversation.submit(REPLACEMENT_REPLY_TEXT);
  if (mode !== 'repeat') expect(turn.result?.failure).toBeUndefined();
  expect(turn.calls.filter(call => call.kind === 'semantic_generic')).toHaveLength(2);
  const attempts = turn.debugTrace.filter(event => event.stage === 'semantic_provider_request')
    .map(event => (event.data as { attempt: string }).attempt);
  expect(attempts).toEqual(['initial', 'repair']);
  const repair = turn.calls.filter(call => call.kind === 'semantic_generic')[1];
  expect(repair.messages[repair.messages.length - 1].content).toContain('corrected kind');
  expect(repair.messages[repair.messages.length - 1].content).toContain('drop the correction if no change is meant');
  expect(turn.result?.state.shouldSavePlan).not.toBe(true);
  expect(fixture.conversation.getState().pendingApproval).toBeUndefined();
  if (mode === 'repeat') {
    expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
    expect(fixture.conversation.graph()).toEqual(before);
    expect(fixture.conversation.getState().previewCandidates).toEqual(preview);
  } else {
    expect(turn.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
    expect(active.workloads.map(workload => workload.amount)).toEqual([20]);
    expect(active.temporalConstraints).toContainEqual(expect.objectContaining({ kind: 'deadline', dateExpression: '2026-10-16' }));
    if (mode === 'include') expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
    else expect(fixture.conversation.getState().previewCandidates).toEqual(preview);
    if (mode === 'drop') expect(fixture.conversation.graph()).toEqual({
      ...before, appliedTurnKeys: fixture.conversation.graph()!.appliedTurnKeys,
    });
  }
});
