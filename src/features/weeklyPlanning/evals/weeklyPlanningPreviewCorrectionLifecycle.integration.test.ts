import { allocateWeeklyPlanningEffort } from '../semantic/weeklyPlanningEffortAllocation';
import { createWeeklyPlanningSemanticPipelineV5 } from '../semantic/weeklyPlanningSemanticPipelineV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyWeeklyPlanningApprovalAvailability,
} from '../application/weeklyPlanningApprovalAvailability';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import type {
  PlanningIntakeState,
} from '../intake/weeklyPlanningIntakeTypes';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
} from '../preview/weeklyPlanningPreviewBlocks';
import type {
  WeeklyDraftCandidate,
} from '../scheduling/weeklyDraftCandidateGenerator';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import type {
  PlanningState,
  WeeklyPlanningAction,
  WeeklyPlanningPendingTurn,
} from '../types';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from '../weeklyPlanningReducer';

const USER_ID = 'preview-correction-lifecycle-user';
const WEEK_START_DATE = '2026-08-10';
const CONVERSATION_ID = 'conversation-preview-correction-lifecycle';

function intakeState(): PlanningIntakeState {
  return {
    status: 'revision_pending',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns: [],
  };
}

function candidate(params: {
  revision: number;
  durationMinutes: number;
  sequence: number;
}): WeeklyDraftCandidate {
  return {
    stableKey: `stable-v5:${params.revision}:task-math:${params.sequence}`,
    date: '2026-08-11',
    startTime: params.sequence === 0 ? '10:00' : '11:10',
    endTime: params.sequence === 0 ? '11:00' : '12:10',
    durationMinutes: params.durationMinutes,
    title: `数学 ${params.durationMinutes}分`,
    field: '数学',
    year: 0,
    estimatedMinutes: params.durationMinutes,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: 'work-item-math',
    stableV5Metadata: {
      runtime: 'stable_v5',
      conversationId: CONVERSATION_ID,
      graphRevision: params.revision,
      taskId: 'task-math',
      sourceFactRefs: ['task-math', `workload-math-r${params.revision}`],
      planType: 'study',
    },
  } as WeeklyDraftCandidate;
}

function publishGraphRevision(revision: number): void {
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId: USER_ID,
    weekStartDate: WEEK_START_DATE,
    conversationId: CONVERSATION_ID,
    graph: {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision,
    },
  });
}

function pendingTurn(state: PlanningState, turn: number): WeeklyPlanningPendingTurn {
  return {
    conversationId: CONVERSATION_ID,
    turnId: `turn-${turn}`,
    requestId: `request-${turn}`,
    weekStartDate: WEEK_START_DATE,
    baseRevision: state.revision,
    startedAt: `2026-08-10T00:0${turn}:00.000Z`,
  };
}

function applyTurn(params: {
  state: PlanningState;
  turn: number;
  draftCandidates?: WeeklyDraftCandidate[];
  assistantText: string;
}): PlanningState {
  const pending = pendingTurn(params.state, params.turn);
  const begin: WeeklyPlanningAction = {
    type: 'begin_turn',
    pending,
    requestSequence: params.turn,
    userMessage: {
      id: `user-${params.turn}`,
      role: 'user',
      content: params.turn === 1
        ? '数学は3時間ではなく1時間にしてください'
        : '修正後の条件で予定を作って',
      createdAt: pending.startedAt,
    },
  };
  const begun = weeklyPlanningReducer(params.state, begin);
  expect(begun.pendingTurn).toEqual(pending);

  return weeklyPlanningReducer(begun, {
    type: 'commit_turn',
    pending,
    intakeState: intakeState(),
    assistantMessage: {
      id: `assistant-${params.turn}`,
      role: 'assistant',
      content: params.assistantText,
      createdAt: `2026-08-10T00:0${params.turn}:30.000Z`,
    },
    draftCandidates: params.draftCandidates,
  });
}

describe('weekly planning preview correction lifecycle', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });

  it('clears the old preview, rejects its revision, and accepts only the recomputed preview', () => {
    publishGraphRevision(3);
    const oldCandidates = [
      candidate({ revision: 3, durationMinutes: 60, sequence: 0 }),
      candidate({ revision: 3, durationMinutes: 60, sequence: 1 }),
    ];
    let state: PlanningState = {
      ...createInitialPlanningState(WEEK_START_DATE),
      mode: 'draft_created',
      previewCandidates: oldCandidates,
      intakeState: intakeState(),
    };
    const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: oldCandidates,
      userId: USER_ID,
      createdAt: '2026-08-10T00:00:00.000Z',
    });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: oldBlocks,
      userId: USER_ID,
    })).toMatchObject({ kind: 'eligible', reason: 'current_session' });

    publishGraphRevision(4);
    state = applyTurn({
      state,
      turn: 1,
      draftCandidates: [],
      assistantText: '数学の時間を修正しました。仮予定を作り直します。',
    });
    expect(state.previewCandidates).toEqual([]);
    expect(state.mode).toBe('collecting_tasks');
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: oldBlocks,
      userId: USER_ID,
    })).toMatchObject({
      kind: 'recompute_required',
      reason: 'state_revision_mismatch',
    });

    publishGraphRevision(5);
    const recomputedCandidates = [
      candidate({ revision: 5, durationMinutes: 60, sequence: 0 }),
    ];
    state = applyTurn({
      state,
      turn: 2,
      draftCandidates: recomputedCandidates,
      assistantText: '修正後の条件で仮予定を作りました。',
    });
    expect(state.previewCandidates).toEqual(recomputedCandidates);
    expect(state.previewCandidates).not.toEqual(oldCandidates);
    expect(state.mode).toBe('draft_created');

    const recomputedBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: recomputedCandidates,
      userId: USER_ID,
      createdAt: '2026-08-10T00:02:00.000Z',
    });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: recomputedBlocks,
      userId: USER_ID,
    })).toMatchObject({ kind: 'eligible', reason: 'current_session' });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: oldBlocks,
      userId: USER_ID,
    })).toMatchObject({
      kind: 'recompute_required',
      reason: 'state_revision_mismatch',
    });
  });
});

it('recompiles actual per-unit→total and numeric effort corrections before scheduling fresh allocations', async () => {
  const document: WeeklyPlanningSemanticDocumentV5 = {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-11', start: '2026-08-11', end: '2026-08-11', sourceText: '8月11日' },
    tasks: [{ localId: 'math', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: '数学20問' }],
      effortEstimates: [{ localId: 'effort', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 5, unitCode: 'problem', precision: 'exact', sourceText: '1問5分' }],
      temporalConstraints: [], recurrence: [], sourceText: '数学20問を1問5分' }], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
  };
  const run = (doc: WeeklyPlanningSemanticDocumentV5, graph: ReturnType<typeof createEmptyWeeklyPlanningFactGraphV5>, turnId: string) =>
    createWeeklyPlanningSemanticPipelineV5({ normalize: async () => ({ status: 'accepted', document: doc, diagnostics: {
      schemaVersion: 'weekly-planning-semantic-v5', jsonSchemaName: 'weekly_planning_semantic_document_v5', normalizerVersion: 'weekly-planning-semantic-normalizer-v5',
      attemptCount: 1, repairAttempted: false, requestBytes: [1], responseLengths: [1], latencyMs: 1, validationErrors: [], providerError: null,
    } }) }).run({ graph, conversationId: CONVERSATION_ID, turnId, expectedRevision: graph.revision, userText: doc.tasks[0].sourceText,
      schedulerContext: { ownerId: USER_ID, currentDate: '2026-08-10', planningStartDate: '2026-08-11', planningEndDate: '2026-08-11', timeZone: 'Asia/Tokyo' } });
  let result = await run(document, createEmptyWeeklyPlanningFactGraphV5(), 'initial-rate');
  let priorEffort = result.canonicalization!.localToFactId.effort;
  const taskId = result.canonicalization!.localToFactId.math;
  const workloadId = result.canonicalization!.localToFactId.work;
  const schedules = [];
  for (const minutes of [100, 60, 30]) {
    if (minutes !== 100) {
      const correction = { ...document, planningWindow: null, tasks: [{ ...document.tasks[0], existingPublicId: taskId,
        workloads: [], effortEstimates: [{ localId: 'replacement', targetLocalId: workloadId, kind: 'total_duration' as const,
          minutes, unitCode: null, precision: 'exact' as const, sourceText: `全部で${minutes}分` }], sourceText: `全部で${minutes}分` }],
        corrections: [{ localId: 'correction', target: { kind: 'effort_estimate' as const, publicId: priorEffort, localId: null, mention: '数学の時間' },
          operation: 'modify' as const, replacementLocalId: 'replacement', sourceText: `全部で${minutes}分` }] };
      result = await run(correction, result.graph, `total-${minutes}`);
      expect(result.canonicalization?.status, JSON.stringify(result.canonicalization?.errors)).toBe('applied');
      priorEffort = result.canonicalization!.localToFactId.replacement;
    }
    expect(result.scheduler?.status).toBe('ready');
    const preview = scheduleWeeklyPlanningStableV5Preview({ input: result.scheduler!.input!, graph: createWeeklyPlanningPlacementGraphViewV5(result.graph),
      plans: [], scheduleTemplates: [], notBefore: { date: '2026-08-10', time: '10:00' } });
    expect(preview.status).toBe('ready');
    expect(result.scheduler!.input!.movableWorkItems.reduce((sum, item) => sum + (item.baseEstimatedMinutes ?? 0), 0)).toBe(minutes);
    expect(preview.candidates.reduce((sum, candidate) => sum + candidate.durationMinutes, 0)).toBe(allocateWeeklyPlanningEffort({ baseEstimateMinutes: minutes }).allocationMinutes);
    schedules.push(preview.candidates);
    const active = new Set(result.graph.factLifecycles.filter(f => f.status === 'active').map(f => f.factId));
    expect(result.graph.effortEstimates.filter(f => active.has(f.id))).toHaveLength(1);
  }
  expect(schedules[2]).not.toEqual(schedules[0]);
});
