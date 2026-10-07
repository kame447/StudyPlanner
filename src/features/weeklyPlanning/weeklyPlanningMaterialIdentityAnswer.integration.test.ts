import { afterEach, describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { materialIdentityConversationFixture, MATERIAL_SETUP_TEXT, MATERIAL_RATE_TEXT, NAMED_MATERIAL } from './testUtils/weeklyPlanningMaterialIdentityAnswerFixture';
import { resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';

let fixture: ReturnType<typeof materialIdentityConversationFixture>;
afterEach(() => { fixture?.provider.restore(); resetScriptedConversationRuntime(); });
describe('existing material identity answer through the production controller', () => {
  it.each(['relabel', 'modify', 'remove'] as const)('resolves the live %s shape within one named-answer turn, preserving work/rate', async (shape) => {
    fixture = materialIdentityConversationFixture({ shape });
    const { conversation } = fixture;
    const initial = await conversation.submit(MATERIAL_SETUP_TEXT);
    expect(initial.result?.failure).toBeUndefined();
    const old = structuredClone(conversation.graph()!);
    const oldMaterial = old.components[0];
    const rate = await conversation.submit(MATERIAL_RATE_TEXT);
    expect(rate.result?.failure).toBeUndefined();
    expect(rate.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(rate.result?.draftCandidates).toHaveLength(0);
    expect(createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!).uncertainties).toHaveLength(1);
    const answer = await conversation.submit(fixture.answerText);
    expect(answer.result?.failure).toBeUndefined();
    expect(answer.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(shape === 'remove' ? 2 : 1);
    const graph = conversation.graph()!;
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
    expect(active.tasks).toHaveLength(1);
    expect(active.components).toEqual([expect.objectContaining({ label: NAMED_MATERIAL, role: 'material' })]);
    expect(active.uncertainties).toHaveLength(0);
    expect(active.workloads).toEqual([expect.objectContaining({ id: old.workloads[0].id, amount: 20, componentId: active.components[0].id, source: old.workloads[0].source })]);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3, kind: 'duration_per_unit' }));
    expect(graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: oldMaterial.id, status: 'superseded', supersededByFactId: active.components[0].id }));
    expect(graph.components.find((fact) => fact.id === oldMaterial.id)).toEqual(oldMaterial);
    expect(answer.result!.draftCandidates.length).toBeGreaterThan(0);
    for (const candidate of answer.result!.draftCandidates) expect(candidate.date >= '2026-10-12' && candidate.date <= '2026-10-18').toBe(true);
    expect(conversation.getState().intakeState?.lastQuestionContext).toBeUndefined();
  });

  it('accepts the live repair shape with a public workload id but no quantity replay', async () => {
    fixture = materialIdentityConversationFixture({ rateShape: 'public_reference' });
    await fixture.conversation.submit(MATERIAL_SETUP_TEXT);
    const rate = await fixture.conversation.submit(MATERIAL_RATE_TEXT);
    expect(rate.result?.failure).toBeUndefined();
    expect(rate.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
    expect(fixture.conversation.graph()?.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3 }));
    expect(rate.result?.draftCandidates).toHaveLength(0);
  });
});
