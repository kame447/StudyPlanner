import { createPresentedWeeklyPlanningConversation } from '../testUtils/__tests__/weeklyPlanningPresentedConversation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActualFromDraft, createPlanFromDraft } from '../../../domain/planner';
import { scheduleEventFromPlan, scheduleEventToPlan } from '../../../domain/scheduleEvent';
import type { Plan } from '../../../types/domain';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  deriveWeeklyPlanningEstimateCalibration,
  readWeeklyPlanningEstimateMetadata,
} from '../personalization/weeklyPlanningEstimateCalibration';
import {
  collectWeeklyPlanningMemoryPaceObservationsV5,
  createWeeklyPlanningMemoryPaceObservationResultV5,
  deriveWeeklyPlanningMemoryPaceEstimateV5,
} from '../personalization/weeklyPlanningMemoryPaceObservationsV5';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocks';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningAction } from '../types';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { approveWeeklyPlanningDraftBlocks } from './weeklyPlanningApprovalApplication';
import {
  getWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock } = vi.hoisted(() => ({ normalizeMock: vi.fn() }));

// Only the typed semantic-provider boundary is substituted. Graph mutation,
// scheduling, preview conversion, approval, persistence projection and consumers are real.
vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({
    provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test-model', apiKey: 'test-key',
  }),
  getAiConfigValidationMessage: () => undefined,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({
  createOpenAiCompatibleClient: () => ({ createChatCompletion: vi.fn() }),
}));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }),
}));

let conversation: ReturnType<typeof createPresentedWeeklyPlanningConversation>;

const OWNER = 'owner-allocation-contract';
const WEEK_START = '2026-08-17';

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [],
    corrections: [], decisions: [],
  };
}

function workloadDocument(memory = false): WeeklyPlanningSemanticDocumentV5 {
  const sourceText = memory ? '英単語220語を覚える' : '数学の教材を30ページ進めたい';
  const title = memory ? '英単語' : '数学の教材';
  return {
    ...emptyDocument(),
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window', kind: 'absolute', value: '2026-08-17/2026-08-23',
      start: WEEK_START, end: '2026-08-23', sourceText: '8月17日から23日',
    },
    tasks: [{
      localId: 'task', category: 'study', title, sourceText,
      study: {
        purpose: 'self_study', contextLabel: title, components: [],
        ...(memory ? { activityKind: 'memorization_retrieval' as const } : {}),
      },
      workloads: [{
        localId: 'workload', quantityRole: 'target', amount: memory ? 220 : 30,
        unitCode: memory ? 'word' : 'page', unitLabel: memory ? '語' : 'ページ',
        rangeStart: null, rangeEnd: null, perOccurrence: false,
        periodExpression: null, sourceText,
      }],
      effortEstimates: [], temporalConstraints: [], recurrence: [],
    }],
  };
}

function decisionDocument(proposalId: string): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...emptyDocument(), planningIntent: 'discuss',
    decisions: [{
      localId: 'decision',
      target: { kind: 'proposal', publicId: proposalId, localId: null, mention: null },
      decision: 'accept', sourceText: 'それでお願いします',
    }],
  };
}

function sessionDurationDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...emptyDocument(), planningIntent: 'discuss',
    tasks: [{
      localId: 'answer-task', category: 'study', title: '直前の質問対象', study: null,
      workloads: [], temporalConstraints: [], recurrence: [], sourceText: '20分くらい',
      effortEstimates: [{
        localId: 'answer-effort', targetLocalId: 'answer-task', kind: 'total_duration',
        minutes: 20, unitCode: null, precision: 'approximate', sourceText: '20分くらい',
      }],
    }],
  };
}

function accepted(document: WeeklyPlanningSemanticDocumentV5): WeeklyPlanningSemanticNormalizerResultV5 {
  return {
    status: 'accepted', document,
    diagnostics: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5',
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5',
      attemptCount: 1, repairAttempted: false, requestBytes: [100], responseLengths: [100],
      latencyMs: 1, validationErrors: [], algorithmicRepairs: [], providerError: null,
    },
  };
}

async function runTurn(params: {
  conversationId: string;
  turn: number;
  userText: string;
  response: WeeklyPlanningSemanticNormalizerResultV5;
  previousState?: PlanningIntakeState;
}) {
  const requestId = `${params.conversationId}:${params.turn}`;
  normalizeMock.mockResolvedValueOnce(params.response);
  const result = await conversation.run({
    previousState: params.previousState, messages: [], userText: params.userText,
    selectedDate: WEEK_START, userId: OWNER, plans: [], scheduleTemplates: [],
    conversationId: params.conversationId, traceRequestId: requestId,
    requestContext: {
      startedAtIso: '2026-08-16T00:00:00.000Z', timeZone: 'Asia/Tokyo',
      currentDate: '2026-08-16', currentTime: '09:00', notBeforeDate: '2026-08-16',
      notBeforeTime: '09:00', weekStartsOn: 'monday',
    },
  });
  expect(result.failure, result.message).toBeUndefined();
  expect(getWeeklyPlanningStableV5RuntimeSession(params.conversationId)?.graph).toEqual(result.stableV5Graph);
  return result;
}

async function approveAndRoundTrip(result: WeeklyPlanningTurnExecutionResult) {
  let state = createInitialPlanningState(WEEK_START);
  const dispatch = (action: WeeklyPlanningAction) => {
    state = weeklyPlanningReducer(state, action);
    return state;
  };
  dispatch({ type: 'set_intake_state', state: result.state });
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
    candidates: result.draftCandidates, userId: OWNER, createdAt: '2026-08-16T00:05:00.000Z',
  });
  dispatch({ type: 'add_draft_blocks', blocks });
  const saved: Plan[] = [];
  const completed = vi.fn();
  expect(saved).toEqual([]);
  await approveWeeklyPlanningDraftBlocks({
    userId: OWNER, plans: [], approvalOperations: [], getState: () => state, dispatch,
    async saveWeeklyApprovedPlan(draft) {
      const plan = createPlanFromDraft(draft);
      saved.push(plan);
      return plan;
    },
    onOperationCompleted: completed,
  });
  expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  expect(saved).toHaveLength(result.draftCandidates.length);
  expect(saved.length).toBeGreaterThan(0);
  expect(state.draftBlocks).toEqual([]);
  const restored = saved.map((plan) => {
    const event = JSON.parse(JSON.stringify(scheduleEventFromPlan(plan)));
    const projection = scheduleEventToPlan(event);
    expect(projection).not.toBeNull();
    return projection!;
  });
  return { saved, restored };
}

function ordinaryActual(plan: Plan, durationMinutes: number) {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  return createActualFromDraft(OWNER, {
    userId: OWNER, planId: plan.id, occurrenceDate: plan.date,
    actualStartTime: '10:00', actualEndTime: `${String(10 + hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    title: plan.title, subject: plan.subject, isAlignedToPlan: true, note: '',
  });
}

beforeEach(() => {
  normalizeMock.mockReset();
  conversation = createPresentedWeeklyPlanningConversation();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
});
afterEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
});

describe('provisional allocation through approval and later personalization', () => {
  it('does not infer scheduler permission from wording without the typed directive', async () => {
    const conversationId = 'provisional-without-directive';
    const first = await runTurn({
      conversationId, turn: 1, userText: '8月17日から23日で数学の教材を30ページ進めたい',
      response: accepted(workloadDocument()),
    });
    const second = await runTurn({
      conversationId, turn: 2, previousState: first.state,
      userText: '所要時間は分からないので、ひとまず時間枠を割り当ててください',
      response: accepted(emptyDocument()),
    });
    expect(first.draftCandidates).toEqual([]);
    expect(second.draftCandidates).toEqual([]);
    expect(second.state.provisionalTimebox).toBeUndefined();
    expect(second.stableV5Graph?.workloads).toEqual(first.stableV5Graph?.workloads);
    expect(second.stableV5Graph?.effortEstimates).toEqual([]);
  });

  it.each([30, 90])('does not turn a 60-minute allocation into effort or pace after %i actual minutes', async (minutes) => {
    const conversationId = `provisional-allocation-${minutes}`;
    const first = await runTurn({
      conversationId, turn: 1, userText: '8月17日から23日で数学の教材を30ページ進めたい',
      response: accepted(workloadDocument()),
    });
    expect(first.draftCandidates).toEqual([]);
    expect(first.stableV5Graph?.workloads).toEqual([
      expect.objectContaining({ amount: 30, unitCode: 'page', quantityRole: 'target' }),
    ]);
    const workloads = structuredClone(first.stableV5Graph!.workloads);
    expect(first.stableV5Graph?.effortEstimates).toEqual([]);

    const second = await runTurn({
      conversationId, turn: 2, previousState: first.state,
      userText: '所要時間は分からないので、ひとまず時間枠を割り当ててください',
      response: {
        ...accepted(emptyDocument()),
        contextualDirective: { kind: 'provisional_timebox', scope: 'current_missing_effort' },
      },
    });
    expect(second.draftCandidates).toHaveLength(1);
    expect(second.draftCandidates[0]).toMatchObject({ durationMinutes: 60, estimatedMinutes: 60 });
    expect(second.state.provisionalTimebox?.workloadFactIds).toEqual(workloads.map((workload) => workload.id));
    expect(second.stableV5Graph?.workloads).toEqual(workloads);
    expect(second.stableV5Graph?.effortEstimates).toEqual([]);
    expect(getWeeklyPlanningStableV5RuntimeSession(conversationId)?.graph.workloads).toEqual(workloads);

    const { saved, restored } = await approveAndRoundTrip(second);
    for (const plans of [saved, restored]) {
      const plan = plans[0];
      expect(plan).toMatchObject({
        userId: OWNER,
        date: second.draftCandidates[0].date,
        startTime: second.draftCandidates[0].startTime,
        endTime: second.draftCandidates[0].endTime,
      });
      expect(readWeeklyPlanningEstimateMetadata(plan)).toBeNull();
      expect(plan.weeklyPlanningObservationSource).toBeUndefined();
      const actuals = [ordinaryActual(plan, minutes)];
      expect(actuals[0].weeklyPlanningObservationResult).toBeUndefined();
      expect(deriveWeeklyPlanningEstimateCalibration({ plans, actuals })).toMatchObject({
        observationCount: 0, medianRatio: null, multiplier: 1,
      });
      expect(collectWeeklyPlanningMemoryPaceObservationsV5({ plans, actuals })).toEqual([]);
      expect(deriveWeeklyPlanningMemoryPaceEstimateV5({ plans, actuals, unitCode: 'page' })).toEqual({
        unitCode: 'page', observationCount: 0, medianProgressPerMinute: null,
        medianMinutesPerUnit: null, medianSessionMinutes: null,
      });
    }
    expect(getWeeklyPlanningStableV5RuntimeSession(conversationId)?.graph.effortEstimates).toEqual([]);
    expect(normalizeMock).toHaveBeenCalledTimes(2);
  });

  it('still learns from a genuinely authorized measurement produced through the same save path', async () => {
    const conversationId = 'authorized-memory-measurement';
    const first = await runTurn({
      conversationId, turn: 1, userText: '8月17日から23日で英単語220語を覚える予定を作りたい',
      response: accepted(workloadDocument(true)),
    });
    expect(first.draftCandidates).toEqual([]);
    const spacing = first.state.learningStrategyProposalRecords?.find((record) => record.kind === 'spaced_memory_practice');
    expect(spacing?.status).toBe('pending');
    const second = await runTurn({
      conversationId, turn: 2, previousState: first.state, userText: 'それでお願いします',
      response: accepted(decisionDocument(spacing!.id)),
    });
    expect(second.draftCandidates).toEqual([]);
    expect(second.state.lastQuestionContext?.intent).toBe('session_duration');
    const third = await runTurn({
      conversationId, turn: 3, previousState: second.state, userText: '20分くらい',
      response: accepted(sessionDurationDocument()),
    });
    expect(third.draftCandidates).toEqual([]);
    const calibration = third.state.learningStrategyProposalRecords?.find((record) => record.kind === 'calibrate_memory_pace');
    expect(calibration).toMatchObject({ status: 'pending', selectedSessionMinutes: 20 });
    const fourth = await runTurn({
      conversationId, turn: 4, previousState: third.state, userText: 'それでお願いします',
      response: accepted(decisionDocument(calibration!.id)),
    });
    expect(fourth.draftCandidates).toHaveLength(1);
    expect(fourth.draftCandidates[0].durationMinutes).toBe(20);
    const graph = fourth.stableV5Graph!;
    const measuredWorkload = graph.workloads.find((workload) => workload.id === spacing!.workloadFactId);
    expect(measuredWorkload).toBeDefined();
    const sessionEffort = graph.effortEstimates.find((effort) =>
      effort.targetFactId === measuredWorkload!.id && effort.kind === 'session_duration');
    expect(sessionEffort).toMatchObject({ minutes: 20 });
    const { saved, restored } = await approveAndRoundTrip(fourth);
    for (const plans of [saved, restored]) {
      const plan = plans[0];
      const source = plan.weeklyPlanningObservationSource;
      expect(source).toEqual({
        version: 1, kind: 'memory_pace_calibration', activityKind: 'memorization_retrieval',
        conversationId, graphRevision: graph.revision, taskId: measuredWorkload!.taskId,
        workloadFactId: measuredWorkload!.id, sessionEffortFactId: sessionEffort!.id,
        targetAmount: 220, unitCode: 'word', unitLabel: '語', plannedSessionMinutes: 20,
      });
      const measurement = createWeeklyPlanningMemoryPaceObservationResultV5({ source: source!, progressAmount: 35 });
      expect(measurement).not.toBeNull();
      const actuals = [{ ...ordinaryActual(plan, 25), weeklyPlanningObservationResult: measurement! }];
      expect(collectWeeklyPlanningMemoryPaceObservationsV5({ plans, actuals })).toHaveLength(1);
      expect(deriveWeeklyPlanningMemoryPaceEstimateV5({ plans, actuals, unitCode: 'word' })).toMatchObject({
        observationCount: 1, medianSessionMinutes: 25, medianProgressPerMinute: 1.4,
      });
    }
    expect(normalizeMock).toHaveBeenCalledTimes(4);
  });
});
