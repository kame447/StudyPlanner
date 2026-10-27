import { afterEach, expect, it } from 'vitest';
import { createEmptyPlanDraft, createPlanFromDraft } from '../../../domain/planner';
import { compileGenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createWeeklyPlanningControllerSession, submitWeeklyPlanningControlledTurn } from '../weeklyPlanningTurnController';
import type { WeeklyPlanningAction } from '../types';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import { isPersistedWeeklyPlanningState } from '../weeklyPlanningStateCodec';
import { createWeeklyDraftBlocksFromPreviewCandidates, createWeeklyPlanningPreviewBlocks, createWeeklyPlanningPreviewDisplayBlock } from '../preview/weeklyPlanningPreviewBlocks';
import { hydrateWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { classifyWeeklyPlanningApprovalAvailability } from './weeklyPlanningApprovalAvailability';
import { createWeeklyPlanningFixedEventRegistrationCandidates, weeklyPlanningFixedEventRegistrationFacts } from './weeklyPlanningFixedEventOnlyInteraction';

afterEach(resetWeeklyPlanningStableV5RuntimeSessionsForTest);

function fixture() {
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    context: { conversationId: 'registration', turnId: 'turn-1', expectedRevision: 0 },
    document: {
      schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null,
      tasks: ['部活', 'ゼミ'].map((title, i) => ({ localId: `task-${i}`, category: 'non_study', title, study: null,
        workloads: [], effortEstimates: [], recurrence: [], sourceText: `${title}の予定を入れて`,
        temporalConstraints: [{ localId: `time-${i}`, targetLocalId: `task-${i}`, kind: 'fixed_interval',
          constraintLevel: 'hard', dateExpression: '2026-10-27', namedTimePeriod: null,
          startTime: i === 0 ? '16:00' : '17:00', endTime: i === 0 ? '17:30' : '21:00', precision: 'exact', sourceText: title }],
      })),
      relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
    },
  });
  if (result.status !== 'applied') throw new Error('fixture canonicalization failed');
  const graph = result.graph;
  const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
    context: { ownerId: 'owner', currentDate: '2026-10-26', planningStartDate: '2026-10-27',
      planningEndDate: '2026-10-27', timeZone: 'Asia/Tokyo' } });
  return { graph, compilation };
}

it('keeps overlapping registration intervals and reports their exact intersection with candidates and existing plans', () => {
  const input = fixture();
  const candidates = createWeeklyPlanningFixedEventRegistrationCandidates({ ...input, requested: true });
  expect(candidates.map(c => [c.title, c.startTime, c.endTime])).toEqual([['部活', '16:00', '17:30'], ['ゼミ', '17:00', '21:00']]);
  for (const candidate of candidates) {
    expect(candidate).not.toHaveProperty('field'); expect(candidate).not.toHaveProperty('year');
    expect(candidate).not.toHaveProperty('estimatedMinutes'); expect(candidate).not.toHaveProperty('allocationBreakdown');
  }
  const plan = createPlanFromDraft({ ...createEmptyPlanDraft('owner', '2026-10-27'), title: '既存予定', type: 'other', startTime: '20:30', endTime: '21:30' });
  const facts = weeklyPlanningFixedEventRegistrationFacts(candidates, [plan]);
  expect(facts.eventRegistration).toEqual({ eventCreatedByTurn: false, candidates, overlaps: [
    { date: '2026-10-27', startTime: '17:00', endTime: '17:30', titles: ['部活', 'ゼミ'] },
    { date: '2026-10-27', startTime: '20:30', endTime: '21:00', titles: ['ゼミ', '既存予定'] },
  ] });
  expect(createWeeklyPlanningFixedEventRegistrationCandidates({ ...input, requested: false })).toEqual([]);
});

it('round-trips the new source through the Stable checkpoint shape while the legacy candidate codec rejects it', () => {
  const input = fixture();
  const candidates = createWeeklyPlanningFixedEventRegistrationCandidates({ ...input, requested: true });
  const state = { ...createInitialPlanningState('2026-10-26'), previewCandidates: candidates };
  const format = { kind: 'stable_v5_session_v1' as const, ownerId: 'owner', weekStartDate: state.weekStartDate,
    conversationId: 'registration', graphRevision: input.graph.revision };
  expect(isPersistedWeeklyPlanningState(JSON.parse(JSON.stringify(state)), format)).toBe(true);
  // The unchanged compatibility codec retains the pre-registration source/learning-field gate.
  expect(isPersistedWeeklyPlanningState(state, { kind: 'compat_v2' })).toBe(false);
  const legacyShape = { ...candidates[0], field: '', year: 0, estimatedMinutes: 90 } as Record<string, unknown>;
  delete legacyShape.stableV5Metadata;
  expect(isPersistedWeeklyPlanningState({ ...state, previewCandidates: [legacyShape] }, { kind: 'compat_v2' })).toBe(false);
  expect(isPersistedWeeklyPlanningState({ ...state, previewCandidates: [{ ...legacyShape, source: 'weekly_exam_prep' }] }, { kind: 'compat_v2' })).toBe(true);
  for (const extra of [{ field: 'fake study' }, { year: 2026 }, { estimatedMinutes: 30 }]) {
    expect(isPersistedWeeklyPlanningState({ ...state, previewCandidates: [{ ...candidates[0], ...extra }] }, format)).toBe(false);
  }
  const preview = createWeeklyPlanningPreviewBlocks(candidates);
  expect(preview.map(block => createWeeklyPlanningPreviewDisplayBlock(block, 'owner'))).toEqual([
    expect.objectContaining({ type: 'other', title: '部活', subject: '', startTime: '16:00', endTime: '17:30' }),
    expect.objectContaining({ type: 'other', title: 'ゼミ', subject: '', startTime: '17:00', endTime: '21:00' }),
  ]);
});

it('fails closed on an unsupported Worker candidate, clears the pending turn and permits a subsequent turn', async () => {
  let state = createInitialPlanningState('2026-10-26');
  const dispatch = (action: WeeklyPlanningAction) => { state = weeklyPlanningReducer(state, action); return state; };
  const session = createWeeklyPlanningControllerSession('owner', state.weekStartDate, 'registration');
  const { graph, compilation } = fixture();
  const candidate = createWeeklyPlanningFixedEventRegistrationCandidates({ graph, compilation, requested: true })[0];
  const input = { session, ownerId: 'owner', userText: '予定を入れて', getState: () => state, dispatch,
    now: () => '2026-10-26T10:00:00.000Z' };
  await expect(submitWeeklyPlanningControlledTurn({ ...input, execute: async () => ({
    stableV5Graph: graph, state: { ...createInitialPlanningIntakeState(), status: 'draft_ready', shouldCreateDraft: true },
    message: '候補を確認してください',
    draftCandidates: [{ ...candidate, source: 'unsupported_new_source' } as unknown as WeeklyDraftCandidate],
  }) })).rejects.toThrow('checkpoint shape contract');
  expect(state.pendingTurn).toBeUndefined();
  expect(state.previewCandidates).toEqual([]);
  expect(state.draftBlocks).toEqual([]);
  expect(state.messages[state.messages.length - 1]?.content).toBe('週間計画の会話状態を更新できませんでした。');
  const next = await submitWeeklyPlanningControlledTurn({ ...input, userText: '質問です', execute: async () => ({
    stableV5Graph: graph, state: createInitialPlanningIntakeState(), message: '返信しました', draftCandidates: [],
  }) });
  expect(next.accepted).toBe(true);
  expect(state.pendingTurn).toBeUndefined();
  expect(state.messages[state.messages.length - 1]?.content).toBe('返信しました');
});

it('requires a fresh graph revision before approving fixed-event registration candidates', () => {
  const input = fixture();
  const candidates = createWeeklyPlanningFixedEventRegistrationCandidates({ ...input, requested: true });
  const publish = (revision: number) => hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: 'owner',
    weekStartDate: '2026-10-26', conversationId: 'registration', graph: { ...input.graph, revision } });
  publish(input.graph.revision);
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: 'owner', createdAt: '2026-10-26T10:00:00.000Z' });
  expect(classifyWeeklyPlanningApprovalAvailability({ blocks, userId: 'owner' })).toMatchObject({ kind: 'eligible', reason: 'current_session' });
  publish(input.graph.revision + 1);
  expect(classifyWeeklyPlanningApprovalAvailability({ blocks, userId: 'owner' })).toMatchObject({ kind: 'recompute_required', reason: 'state_revision_mismatch' });
});
