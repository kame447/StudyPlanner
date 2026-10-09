import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, expect, it } from 'vitest';
import { correctionReplacementRepairFixture, REPLACEMENT_REPLY_TEXT } from './testUtils/weeklyPlanningCorrectionReplacementRepairFixture';
import { resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { FOCUSED_TEMPORAL_REPLACEMENT_REPAIR_REQUEST_MAX_BYTES } from './semantic/weeklyPlanningFocusedTemporalReplacementRepairV5';
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
  // 'repeat': the generic repair dangles again, so one focused temporal call follows (it finds no date); otherwise the repair is the end.
  expect(attempts).toEqual(mode === 'repeat' ? ['initial', 'repair', 'focused_temporal_replacement_repair'] : ['initial', 'repair']);
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

it('D2: a temporal replacement the generic repair left dangling is read by one focused call and previews with the new deadline', async () => {
  fixture = correctionReplacementRepairFixture('repeat_recovered');
  await fixture.setup();
  const turn = await fixture.conversation.submit(REPLACEMENT_REPLY_TEXT);
  expect(turn.result?.failure).toBeUndefined();
  const attempts = turn.debugTrace.filter(event => event.stage === 'semantic_provider_request').map(event => (event.data as { attempt: string }).attempt);
  expect(attempts).toEqual(['initial', 'repair', 'focused_temporal_replacement_repair']);
  const focused = turn.debugTrace.find(event => event.stage === 'semantic_provider_request' && (event.data as { attempt: string }).attempt === 'focused_temporal_replacement_repair')!;
  expect((focused.data as { requestBytes: number }).requestBytes).toBeLessThanOrEqual(FOCUSED_TEMPORAL_REPLACEMENT_REPAIR_REQUEST_MAX_BYTES);
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(fixture.conversation.graph()!);
  expect(active.temporalConstraints).toContainEqual(expect.objectContaining({ kind: 'deadline', dateExpression: '2026-10-16' }));
  expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
  expect(turn.result?.communicationFacts?.planningDetailsNotApplied).toBe(false);
});

it('D2: unrecoverable (the focused call finds no date) is never silent: planningDetailsNotApplied is set and the state is unchanged', async () => {
  fixture = correctionReplacementRepairFixture('repeat');
  await fixture.setup();
  const before = structuredClone(fixture.conversation.graph()!);
  const turn = await fixture.conversation.submit(REPLACEMENT_REPLY_TEXT);
  expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
  expect(turn.result?.communicationFacts?.planningDetailsNotApplied).toBe(true);
  expect(fixture.conversation.graph()).toEqual(before);
});

it('D2: the disclosure does not depend on the route — a rejected reading of a kind with no recovery (a recurrence replacement) is disclosed too', async () => {
  fixture = correctionReplacementRepairFixture('recurrence_dangling');
  await fixture.setup();
  const before = structuredClone(fixture.conversation.graph()!);
  const turn = await fixture.conversation.submit(REPLACEMENT_REPLY_TEXT);
  expect(turn.result?.failure?.code).toBe('stable_v5_normalization_rejected');
  expect(turn.result?.communicationFacts?.planningDetailsNotApplied).toBe(true);
  expect(fixture.conversation.graph()).toEqual(before);
});

it('D2: legacy is unchanged — the focused temporal recovery does not exist for the legacy architecture', async () => {
  const { tryFocusedTemporalReplacementRecoveryAfterRepairV5 } = await import('./semantic/weeklyPlanningSemanticFocusedRepairRoutesV5');
  const run = { input: { conversationArchitecture: 'legacy_v5' } } as never;
  await expect(tryFocusedTemporalReplacementRecoveryAfterRepairV5({ run, initialResponse: '{}', initialValidation: { errors: ['x'] } as never })).resolves.toBeNull();
});
