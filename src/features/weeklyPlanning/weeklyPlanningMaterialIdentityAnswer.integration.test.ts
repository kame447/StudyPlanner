import { afterEach, describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { materialIdentityConversationFixture, MATERIAL_SETUP_TEXT, MATERIAL_RATE_TEXT, MATERIAL_EXPLANATION_TEXT, NAMED_MATERIAL, LATER_MATERIAL_WORK_TEXT } from './testUtils/weeklyPlanningMaterialIdentityAnswerFixture';
import { resolveGenericWorkItemEstimate } from './semantic/weeklyPlanningGenericWorkEstimation';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, type ScriptedConversation } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { campaignRendererReply } from './testUtils/weeklyPlanningRealE2ECampaignFixture';

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
    const explanation = await conversation.submit(MATERIAL_EXPLANATION_TEXT);
    expect(explanation.result?.failure).toBeUndefined();
    expect(conversation.graph()).toEqual({ ...old,
      appliedTurnKeys: [...old.appliedTurnKeys, `${conversation.conversationId}:${explanation.requestId}`],
    });
    expect(explanation.result?.draftCandidates).toHaveLength(0);
    expect(explanation.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(1);
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
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3, kind: 'duration_per_unit', targetFactId: old.workloads[0].id }));
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
  it('keeps a workload-specific rate from estimating later same-unit work in a sibling material', async () => {
    fixture = materialIdentityConversationFixture({ rateShape: 'public_reference' });
    const { conversation } = fixture;
    await conversation.submit(MATERIAL_SETUP_TEXT);
    await conversation.submit(MATERIAL_RATE_TEXT);
    await conversation.submit(fixture.answerText);
    const originalWorkId = conversation.graph()!.workloads[0].id;
    const later = await conversation.submit(LATER_MATERIAL_WORK_TEXT);
    expect(later.result?.failure).toBeUndefined();
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    const workloads = conversation.graph()!.workloads.filter((fact): fact is typeof fact & { quantityRole: 'target' } =>
      fact.quantityRole === 'target' && active.workloads.some((item) => item.id === fact.id));
    const added = workloads.find((fact) => fact.id !== originalWorkId)!;
    expect(added.amount).toBe(10);
    expect(active.effortEstimates[0].targetFactId).toBe(originalWorkId);
    expect(resolveGenericWorkItemEstimate({ workload: added, workloads, estimates: active.effortEstimates }).estimatedMinutes).toBeNull();
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
    expect(later.result!.draftCandidates.some((candidate) => candidate.title.includes('プリント'))).toBe(false);
  });
});

describe('a material named after the preview, with no open material question (live B on 64436073)', () => {
  const slots = (candidates: ReadonlyArray<{ date: string; startTime: string; endTime: string; durationMinutes: number }>) =>
    candidates.map(({ date, startTime, endTime, durationMinutes }) => ({ date, startTime, endTime, durationMinutes }));
  it.each(['relabel', 'replace_component'] as const)('interaction records the named material from the %s shape, keeping work, rate and slots', async (shape) => {
    fixture = materialIdentityConversationFixture({ shape, materialQuestion: false });
    const { conversation } = fixture;
    expect((await conversation.submit(MATERIAL_SETUP_TEXT)).result?.failure).toBeUndefined();
    const rate = await conversation.submit(MATERIAL_RATE_TEXT);
    expect(rate.result?.failure).toBeUndefined();
    const preview = slots(rate.result!.draftCandidates);
    expect(preview.length).toBeGreaterThan(0);
    const old = structuredClone(conversation.graph()!);
    const answer = await conversation.submit(fixture.answerText);
    expect(answer.result?.failure).toBeUndefined();
    // The relabel is the identification itself (no no-op re-read); the replace correction the
    // canonical owner cannot apply gets the one repair instead of a post-validation rejection.
    expect(answer.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(shape === 'relabel' ? 1 : 2);
    const graph = conversation.graph()!;
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
    expect(active.components).toEqual([expect.objectContaining({ label: NAMED_MATERIAL, role: 'material' })]);
    expect(active.workloads).toEqual([expect.objectContaining({ id: old.workloads[0].id, amount: 20, componentId: active.components[0].id, source: old.workloads[0].source })]);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3, kind: 'duration_per_unit', targetFactId: old.workloads[0].id }));
    expect(graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: old.components[0].id, status: 'superseded', supersededByFactId: active.components[0].id }));
    expect(graph.components.find((fact) => fact.id === old.components[0].id)).toEqual(old.components[0]);
    expect(slots(answer.result!.draftCandidates)).toEqual(preview);
    // The recomputed preview is promoted from the new graph revision, never from the superseded material.
    for (const candidate of answer.result!.draftCandidates) {
      const metadata = (candidate as { stableV5Metadata?: { graphRevision: number; sourceFactRefs: string[] } }).stableV5Metadata!;
      expect(metadata.graphRevision).toBe(graph.revision);
      expect(metadata.sourceFactRefs).not.toContain(old.components[0].id);
    }
  });

  it('legacy keeps its binding-only shell: the accepted material is unchanged', async () => {
    // (Legacy has no public-id rate binding, so this fixture's rate turn is not accepted there.)
    fixture = materialIdentityConversationFixture({ materialQuestion: false, architecture: 'legacy_v5' });
    const { conversation } = fixture;
    await conversation.submit(MATERIAL_SETUP_TEXT);
    await conversation.submit(MATERIAL_RATE_TEXT);
    const old = structuredClone(conversation.graph()!);
    const answer = await conversation.submit(fixture.answerText);
    expect(answer.result?.failure).toBeUndefined();
    expect(conversation.graph()!.components).toEqual(old.components);
  });
});

describe('a bookshelf material named for an accepted task that has none yet (live B on b2fbd121)', () => {
  type Json = Record<string, unknown>;
  const NAME_TEXT = '青チャートのこと';
  // Verbatim live shapes (ids substituted): T1 raises a free-form material question on the task.
  const base = (overrides: Json): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], conversationActs: [],
    uncertainties: [], corrections: [], decisions: [], ...overrides });
  const work = { localId: 'workload-1', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null,
    rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '20問' };
  const task = (existingPublicId: string | null, overrides: Json = {}): Json => ({ localId: 'task-1', existingPublicId, decompositionStatus: 'atomic',
    category: 'study', title: '数学の問題集を進める', study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '数学の問題集を20問進めたい', ...overrides });
  let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider> | undefined;
  afterEach(() => { provider?.restore(); provider = undefined; });

  it.each(['clean', 'contradictory_remove'] as const)('records the named material and retires the question (%s first document)', async (shape) => {
    resetScriptedConversationRuntime();
    let conversation: ScriptedConversation;
    const repairInstructions: string[] = [];
    provider = installScriptedWeeklyPlanningProvider((call) => {
      if (call.kind === 'renderer') return campaignRendererReply(call.payload ?? {});
      if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null,
        effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
      const payload = call.messages.map((message) => { try { return JSON.parse(message.content) as Json; } catch { return {}; } })
        .find((value) => typeof value.userText === 'string')!;
      const repair = call.messages[call.messages.length - 1].content.includes('"validationErrors"');
      if (repair) repairInstructions.push(call.messages[call.messages.length - 1].content);
      let document: Json;
      if (payload.userText === MATERIAL_SETUP_TEXT) document = base({ planningIntent: 'create_plan',
        planningWindow: { localId: 'window-1', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
        tasks: [task(null, { workloads: [work] })],
        uncertainties: [{ localId: 'uncertainty-1', targetLocalId: 'task-1', field: 'material',
          reason: '「数学の問題集」に該当する登録教材を一意に特定できない', sourceText: '数学の問題集' }] });
      else {
        const taskId = conversation.graph()!.tasks[0].id;
        if (payload.userText === MATERIAL_RATE_TEXT) document = base({ tasks: [task(taskId, { workloads: [work],
          effortEstimates: [{ localId: 'rate', targetLocalId: 'workload-1', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem',
            precision: 'approximate', sourceText: MATERIAL_RATE_TEXT }] })],
          conversationActs: [{ kind: 'answer_pending_question', targetPublicId: taskId }] });
        else {
          const component = { localId: 'component-blue', existingPublicId: 'book-blue', parentLocalId: null, role: 'material',
            label: NAMED_MATERIAL, workloads: [], durableContextSignals: [], sourceText: NAME_TEXT };
          document = base({ tasks: [task(taskId, { sourceText: NAME_TEXT,
            study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [component] } })],
            corrections: shape === 'contradictory_remove' && !repair ? [{ localId: 'remove', target: { kind: 'task', publicId: taskId,
              localId: null, mention: '数学の問題集' }, operation: 'remove', replacementLocalId: 'component-blue', sourceText: NAME_TEXT }] : [],
            conversationActs: [{ kind: 'answer_pending_question', targetPublicId: taskId }] });
        }
      }
      if (!call.schemaProperties.includes('conversationActs')) delete document.conversationActs;
      return JSON.stringify(document);
    });
    conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', studyMaterials: [{
      id: 'book-blue', userId: 'issue488-owner', name: NAMED_MATERIAL, subjectId: 'math', subjectName: '数学', paceEnabled: false,
      progressUnit: 'problem', totalUnits: 100, currentUnit: 0, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    }] });
    expect((await conversation.submit(MATERIAL_SETUP_TEXT)).result?.failure).toBeUndefined();
    const rate = await conversation.submit(MATERIAL_RATE_TEXT);
    expect(rate.result?.failure).toBeUndefined();
    expect(rate.result?.draftCandidates).toHaveLength(0);
    const answer = await conversation.submit(NAME_TEXT);
    expect(answer.result?.failure).toBeUndefined();
    expect(answer.calls.filter((call) => call.kind === 'semantic_generic')).toHaveLength(shape === 'clean' ? 1 : 2);
    if (shape === 'contradictory_remove') expect(repairInstructions.join('\n')).toContain('A remove correction has no replacementLocalId');
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(conversation.graph()!);
    expect(active.tasks).toHaveLength(1);
    expect(active.components).toEqual([expect.objectContaining({ label: NAMED_MATERIAL, role: 'material', taskId: active.tasks[0].id })]);
    expect(active.uncertainties).toHaveLength(0);
    expect(active.effortEstimates).toContainEqual(expect.objectContaining({ minutes: 3, kind: 'duration_per_unit' }));
    expect(answer.result!.draftCandidates.length).toBeGreaterThan(0);
    for (const candidate of answer.result!.draftCandidates) expect(candidate.date >= '2026-10-12' && candidate.date <= '2026-10-18').toBe(true);
  });
});
