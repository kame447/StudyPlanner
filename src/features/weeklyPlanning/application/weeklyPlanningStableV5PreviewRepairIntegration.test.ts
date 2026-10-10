import { executeWeeklyPlanningTurn } from '../weeklyPlanningTurnExecutor';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeExecutor';
import {
  commitWeeklyPlanningStableV5RuntimeGraph,
  finalizeWeeklyPlanningStableV5RuntimeGraph,
  getWeeklyPlanningStableV5RuntimeSession,
  hasWeeklyPlanningStableV5StagedGraph,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningStableV5ResultProjector } from './weeklyPlanningStableV5ResultProjection';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { createRemoteWeeklyPlanningTraceRepository } from '../trace/weeklyPlanningTraceRemoteRepository';
import type { WeeklyPlanningTraceApiClient, WeeklyPlanningTraceAppendInput } from '../trace/weeklyPlanningTracePrivacyClient';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, submitWeeklyPlanningControlledTurn } from '../weeklyPlanningTurnController';
import { weeklyPlanningTurnStagingLifecycle } from './weeklyPlanningTurnSideEffects';
import { classifyWeeklyPlanningApprovalAvailability } from './weeklyPlanningApprovalAvailability';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocks';
import { createWeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';
import * as planningEvaluation from './weeklyPlanningStableV5PlanningEvaluation';

const { normalizeMock } = vi.hoisted(() => ({ normalizeMock: vi.fn() }));

function acceptedResult(document: WeeklyPlanningSemanticDocumentV5) {
  return {
    status: 'accepted' as const,
    document,
    diagnostics: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5' as const,
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5' as const,
      attemptCount: 1,
      repairAttempted: false,
      requestBytes: [100],
      responseLengths: [100],
      latencyMs: 1,
      validationErrors: [],
      algorithmicRepairs: [],
      providerError: null,
    },
  };
}

function initialPreviewDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window',
      kind: 'absolute',
      value: '2026-08-17/2026-08-23',
      start: '2026-08-17',
      end: '2026-08-23',
      sourceText: '8月17日から23日',
    },
    tasks: [{
      localId: 'task-math',
      category: 'study',
      title: '数学',
      study: { purpose: 'homework', contextLabel: '数学', components: [] },
      workloads: [{
        localId: 'workload-math',
        quantityRole: 'target',
        amount: 30,
        unitCode: 'page',
        unitLabel: 'ページ',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学30ページ',
      }],
      effortEstimates: [{
        localId: 'effort-math',
        targetLocalId: 'workload-math',
        kind: 'duration_per_unit',
        minutes: 5,
        unitCode: 'page',
        precision: 'approximate',
        sourceText: '1ページ5分くらい',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学30ページ。1ページ5分くらい',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function addedTaskMissingEffortDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-english',
      category: 'study',
      title: '英単語',
      study: { purpose: 'self_study', contextLabel: '英単語', components: [] },
      workloads: [{
        localId: 'workload-english',
        quantityRole: 'target',
        amount: 80,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '英単語80語',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '英単語80語も追加',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function incompatiblePendingReplyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({
    provider: 'openai',
    baseUrl: 'https://example.invalid/v1',
    model: 'test-model',
    apiKey: 'test-key',
  }),
  getAiConfigValidationMessage: () => undefined,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({
  createOpenAiCompatibleClient: () => ({ createChatCompletion: vi.fn() }),
}));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }),
}));

import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5InstrumentedRuntimeExecutor';

const requestContext = {
  startedAtIso: '2026-08-11T05:55:00.000Z',
  timeZone: 'Asia/Tokyo',
  currentDate: '2026-08-11',
  currentTime: '14:55',
  notBeforeDate: '2026-08-11',
  notBeforeTime: '14:55',
  weekStartsOn: 'monday' as const,
};

function turnInput(
  overrides: Pick<
    ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
    'userText' | 'traceRequestId' | 'previousState'
  >,
): ExecuteWeeklyPlanningStableV5RuntimeTurnInput {
  return {
    messages: [],
    selectedDate: '2026-08-17',
    userId: 'owner-preview-repair',
    plans: [],
    scheduleTemplates: [],
    conversationId: 'conversation-preview-repair',
    requestContext,
    ...overrides,
  };
}

function controllerFixture(executeTurn = executeWeeklyPlanningStableV5RuntimeTurn) {
  const userId = 'owner-preview-repair';
  const conversationId = 'conversation-preview-repair';
  let state = createInitialPlanningState('2026-08-17');
  const session = createWeeklyPlanningControllerSession(userId, state.weekStartDate, conversationId);
  const observed: Array<{ requestId: string; result: Awaited<ReturnType<typeof executeTurn>> }> = [];
  const prepared = vi.fn(({ pending }: Parameters<NonNullable<Parameters<typeof submitWeeklyPlanningControlledTurn>[0]['prepareExecutionCommit']>>[0]) =>
    weeklyPlanningTurnStagingLifecycle.prepare({ ownerId: userId, pending }));
  const committed = vi.fn();
  const submit = (userText: string) => submitWeeklyPlanningControlledTurn({
    session, ownerId: userId, userText, getState: () => state,
    dispatch(action) { state = weeklyPlanningReducer(state, action); return state; },
    async execute({ snapshot, pending }) {
      const result = await executeTurn({ ...turnInput({ userText, traceRequestId: pending.requestId, previousState: snapshot.intakeState }), messages: snapshot.messages });
      observed.push({ requestId: pending.requestId, result });
      return result;
    },
    prepareExecutionCommit: prepared, onCommittedTurn: committed,
    discardExecutionResult({ pending }) { weeklyPlanningTurnStagingLifecycle.discard(pending); },
    onFailedTurn({ pending }) { weeklyPlanningTurnStagingLifecycle.discard(pending); },
    now: () => '2026-08-11T05:55:00.000Z',
  });
  return { submit, get state() { return state; }, observed, prepared, committed };
}

function correctionTimeWorkDocument(): WeeklyPlanningSemanticDocumentV5 {
  const document = initialPreviewDocument();
  const task = document.tasks[0];
  task.workloads[0] = { ...task.workloads[0], amount: 3, unitCode: 'hour', unitLabel: '時間', sourceText: '数学を3時間' };
  task.effortEstimates[0] = { ...task.effortEstimates[0], kind: 'session_duration', minutes: 45, unitCode: null, sourceText: '1回45分' };
  task.sourceText = '数学を3時間、1回45分';
  return document;
}

function acceptValidatedCorrection(document: WeeklyPlanningSemanticDocumentV5) {
  normalizeMock.mockImplementationOnce(async (input: WeeklyPlanningSemanticNormalizerInputV5) => {
    const valid = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { ...input, currentUserText: input.userText });
    expect(valid.errors).toEqual([]);
    expect(valid.document).not.toBeNull();
    return acceptedResult(valid.document!);
  });
}

describe('Stable V5 repair-safe preview integration', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    normalizeMock.mockReset();
  });

  it('keeps the previous preview visible but non-promotable across unresolved repair turns', async () => {
    normalizeMock.mockResolvedValueOnce(acceptedResult(initialPreviewDocument()));
    const initial = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      userText: '8月17日から23日で数学30ページ。1ページ5分くらいで予定を作って',
      traceRequestId: 'request-preview-repair-1',
    }));

    expect(initial.draftCandidates.length).toBeGreaterThan(0);
    expect(initial.state.status).toBe('draft_ready');

    normalizeMock.mockResolvedValueOnce(acceptedResult(addedTaskMissingEffortDocument()));
    const repair = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      previousState: initial.state,
      userText: '英単語80語も追加したい',
      traceRequestId: 'request-preview-repair-2',
    }));

    expect(repair.draftCandidates).toEqual([]);
    expect(repair.preserveExistingPreview).toBe(true);
    expect(repair.state.status).toBe('revision_pending');
    expect(repair.state.shouldCreateDraft).toBe(false);
    expect(repair.state.draftGenerationIntent).toBe('user_authorized');
    expect(repair.state.questions.length).toBe(1);

    normalizeMock.mockResolvedValueOnce(acceptedResult(incompatiblePendingReplyDocument()));
    const stillRepairing = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      previousState: repair.state,
      userText: 'ちょっと待って',
      traceRequestId: 'request-preview-repair-3',
    }));

    expect(stillRepairing.draftCandidates).toEqual([]);
    expect(stillRepairing.preserveExistingPreview).toBe(true);
    expect(stillRepairing.state.status).toBe('revision_pending');
    expect(stillRepairing.state.shouldCreateDraft).toBe(false);
  });

  it.each([
    ['added task date constraint', false],
    ['replaced task date constraint', false],
    ['removed task date constraint', false],
    ['added plan-wide availability', false],
    ['unchanged placement facts', true],
    ['object key order only', true],
    ['undefined optional field only', true],
    ['array order changed', false],
    ['uncertainty-only cleanup', true],
    ['unrelated new task', true],
    ['future placement field', false],
    ['source metadata only', true],
    ['grounding acceptance metadata', true],
    ['grounding reject same resolved range', true],
    ['grounding reject changed range', false],
    ['missing previous grounding', false],
    ['expired previous grounding', false],
    ['new fixed task blocks old preview', false],
    ['new unresolved fixed task', false],
    ['same-day open absolute window', true],
    ['same-day ended absolute window', false],
    ['absolute range without grounding', true],
    ['no accepted window fallback', true],
  ] as const)('projects preview retention from accepted placement facts: %s', async (change, preserve) => {
    const document = initialPreviewDocument();
    if (change === 'no accepted window fallback') document.planningWindow = null;
    if (change === 'same-day open absolute window' || change === 'same-day ended absolute window') document.planningWindow = {
      ...document.planningWindow!, value: '2026-08-11', start: '2026-08-11', end: '2026-08-11',
    };
    const groundingChange = change.startsWith('grounding ') || change.includes('previous grounding');
    if (groundingChange) document.planningWindow = {
      ...document.planningWindow!, kind: 'relative_week', value: 'next_week', start: null, end: null,
    };
    document.tasks[0].temporalConstraints = [{
      localId: 'deadline-math', targetLocalId: 'task-math', kind: 'deadline',
      constraintLevel: 'hard', dateExpression: change.startsWith('same-day ') ? '2026-08-11' : '2026-08-23', namedTimePeriod: null,
      startTime: null, endTime: null, precision: 'exact', sourceText: '8月23日まで',
    }];
    normalizeMock.mockResolvedValueOnce(acceptedResult(document));
    const initial = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
      userText: '8月17日から23日で数学30ページ。1ページ5分、23日までに',
      traceRequestId: 'request-placement-basis-initial',
    }));
    expect(initial.draftCandidates.length).toBeGreaterThan(0);
    expect(initial.stableV5Graph).toBeDefined();
    const previous = structuredClone(initial.stableV5Graph!);
    const deadline = previous.temporalConstraints.find(fact => fact.kind === 'deadline')!;
    expect(deadline).toBeDefined();
    const active = (factId: string) => ({
      factId, status: 'active' as const, createdRevision: previous.revision,
      terminalRevision: null, supersededByFactId: null,
    });
    // A non-placement fact can be retired without invalidating the same candidate.
    previous.uncertainties.push({
      id: 'uncertainty-obsolete', targetFactId: null, field: 'context', reason: 'resolved context',
      source: deadline.source, createdRevision: previous.revision,
    });
    previous.factLifecycles.push(active('uncertainty-obsolete'));
    if (change === 'array order changed') {
      Object.assign(previous.workloads[0], { futurePlacementSequence: ['first', 'second'] });
    }
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: 'owner-preview-repair', conversationId: 'conversation-preview-repair',
      weekStartDate: '2026-08-17', graph: previous,
    });
    let next = structuredClone(previous);
    next.revision += 1;
    next.appliedTurnKeys.push('conversation-preview-repair:request-placement-basis-next');
    if (change === 'added task date constraint' || change === 'replaced task date constraint') {
      next.temporalConstraints.push({
        ...deadline, id: 'date-next', dateExpression: 'custom:unresolved-date',
        createdRevision: next.revision,
      });
      next.factLifecycles.push({ ...active('date-next'), createdRevision: next.revision });
    }
    if (change === 'replaced task date constraint' || change === 'removed task date constraint') {
      const entry = next.factLifecycles.find(item => item.factId === deadline.id)!;
      entry.status = change === 'removed task date constraint' ? 'removed' : 'superseded';
      entry.terminalRevision = next.revision;
      entry.supersededByFactId = change === 'replaced task date constraint' ? 'date-next' : null;
    }
    if (change === 'added plan-wide availability') {
      next.availabilityDeclarations.push({
        id: 'availability-next', kind: 'unavailable', dateExpression: 'custom:unresolved-date',
        namedTimePeriod: null, startTime: '20:00', endTime: '22:00',
        recurrenceKind: null, days: [], constraintLevel: 'hard', resolutionStatus: 'unresolved',
        source: deadline.source, createdRevision: next.revision,
      });
      next.factLifecycles.push({ ...active('availability-next'), createdRevision: next.revision });
    }
    if (change === 'uncertainty-only cleanup') {
      const entry = next.factLifecycles.find(item => item.factId === 'uncertainty-obsolete')!;
      entry.status = 'removed';
      entry.terminalRevision = next.revision;
    }
    if (change === 'new fixed task blocks old preview' || change === 'new unresolved fixed task') {
      next.tasks.push({ ...previous.tasks[0], id: 'new-fixed-task', createdRevision: next.revision });
      const oldCandidate = initial.draftCandidates[0];
      next.temporalConstraints.push({
        ...deadline, id: 'new-fixed-interval', taskId: 'new-fixed-task', targetFactId: 'new-fixed-task',
        kind: 'fixed_interval', constraintLevel: 'hard',
        dateExpression: change === 'new unresolved fixed task' ? 'custom:unresolved-date' : oldCandidate.date,
        startTime: oldCandidate.startTime, endTime: oldCandidate.endTime, createdRevision: next.revision,
      });
      next.factLifecycles.push(...['new-fixed-task', 'new-fixed-interval'].map((id) => ({ ...active(id), createdRevision: next.revision })));
    }
    if (change === 'object key order only') {
      const beforeKeyPermutation = structuredClone(next);
      next = JSON.parse(JSON.stringify(next), (_key, value: unknown) =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse()) : value);
      expect(next).toEqual(beforeKeyPermutation);
      expect(JSON.stringify(next.workloads[0])).not.toBe(JSON.stringify(beforeKeyPermutation.workloads[0]));
    }
    if (change === 'undefined optional field only') {
      Object.assign(next.workloads[0], { futureOptionalPlacement: undefined });
    }
    if (change === 'array order changed') {
      Object.assign(next.workloads[0], { futurePlacementSequence: ['second', 'first'] });
    }
    if (change === 'future placement field') {
      // A field unknown to this comparator must not silently disappear from the basis.
      Object.assign(next.workloads[0], { futurePlacementSentinel: { limit: 17 } });
    }
    if (change === 'source metadata only') {
      next.workloads[0].source.sourceText = 'same typed work, different explanation';
      next.workloads[0].createdRevision = next.revision;
    }
    if (change === 'unrelated new task') {
      next.tasks.push({ ...previous.tasks[0], id: 'new-unresolved-task', createdRevision: next.revision });
      next.factLifecycles.push({ ...active('new-unresolved-task'), createdRevision: next.revision });
    }
    commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: 'owner-preview-repair', conversationId: 'conversation-preview-repair', graph: next,
    });
    const priorState = structuredClone(initial.state);
    const nextGroundingRecords = structuredClone(initial.state.groundingRecords ?? []);
    if (change === 'grounding acceptance metadata') {
      nextGroundingRecords[0].status = 'continuation_accepted';
      nextGroundingRecords[0].acceptedAtTurnId = 'later-acceptance';
    }
    if (change === 'grounding reject same resolved range' || change === 'grounding reject changed range') {
      nextGroundingRecords[0].status = 'rejected';
    }
    if (change === 'missing previous grounding' || change === 'absolute range without grounding') priorState.groundingRecords = [];
    const projectionInput = turnInput({
      previousState: priorState, userText: 'opaque turn; meaning is already typed',
      traceRequestId: 'request-placement-basis-next',
    });
    if (change === 'grounding reject changed range' || change === 'expired previous grounding') {
      const date = change === 'expired previous grounding' ? '2026-08-25' : '2026-08-18';
      projectionInput.requestContext = {
        ...requestContext, currentDate: date, notBeforeDate: date, startedAtIso: `${date}T05:55:00.000Z`,
      };
    }
    if (change === 'same-day ended absolute window') projectionInput.requestContext = {
      ...requestContext, currentTime: '23:59', notBeforeTime: '24:00', startedAtIso: '2026-08-11T14:59:59.500Z',
    };
    const projected = weeklyPlanningStableV5ResultProjector.core({
      input: projectionInput,
      result: {
        state: { ...createInitialPlanningIntakeState(), status: 'needs_scope', questions: ['pending'], groundingRecords: nextGroundingRecords },
        message: 'opaque presentation', draftCandidates: [],
      },
    });
    expect(projected.preserveExistingPreview === true).toBe(preserve);
    expect(projected.state.shouldCreateDraft).toBe(false);
    expect(projected.state.shouldSavePlan).toBe(false);
    expect(projected.draftCandidates).toEqual([]);
    expect(projected.stableV5Graph).toEqual(next);
    expect(getWeeklyPlanningStableV5RuntimeSession('conversation-preview-repair')?.graph).toEqual(previous);
  });


  it.each(['rejected relative range', 'new fixed commitment'] as const)(
    'invalidates through the instrumented runtime after accepting %s', async (change) => {
      const document = initialPreviewDocument();
      document.planningWindow = { ...document.planningWindow!, kind: 'relative_week', value: 'next_week', start: null, end: null };
      document.tasks[0].temporalConstraints = [{
        localId: 'old-deadline', targetLocalId: 'task-math', kind: 'deadline', constraintLevel: 'hard',
        dateExpression: '2026-08-23', namedTimePeriod: null, startTime: null, endTime: null,
        precision: 'exact', sourceText: '8月23日まで',
      }];
      normalizeMock.mockResolvedValueOnce(acceptedResult(document));
      const initial = await executeWeeklyPlanningStableV5RuntimeTurn(turnInput({
        userText: '来週の数学の計画', traceRequestId: 'request-accepted-basis-1',
      }));
      expect(initial.draftCandidates.length).toBeGreaterThan(0);
      const committed = finalizeWeeklyPlanningStableV5RuntimeGraph({
        ownerId: 'owner-preview-repair', conversationId: 'conversation-preview-repair', requestId: 'request-accepted-basis-1',
      });
      const repairDocument = change === 'new fixed commitment'
        ? addedTaskMissingEffortDocument() : incompatiblePendingReplyDocument();
      repairDocument.planningIntent = 'update_plan';
      if (change === 'rejected relative range') {
        repairDocument.decisions = [{
          localId: 'reject-window', decision: 'reject',
          target: { kind: 'planning_window', publicId: committed.graph.planningWindows[0].id, localId: null, mention: null },
          sourceText: '以前の相対期間の解釈を取り下げる',
        }];
      } else {
        const candidate = initial.draftCandidates[0];
        repairDocument.tasks.push({
          localId: 'fixed-appointment', category: 'non_study', title: '固定の用事', study: null,
          workloads: [], effortEstimates: [], recurrence: [], sourceText: '同じ時間の固定予定',
          temporalConstraints: [{
            localId: 'fixed-time', targetLocalId: 'fixed-appointment', kind: 'fixed_interval', constraintLevel: 'hard',
            dateExpression: candidate.date, namedTimePeriod: null, startTime: candidate.startTime, endTime: candidate.endTime,
            precision: 'exact', sourceText: '同じ時間の固定予定',
          }],
        });
      }
      normalizeMock.mockResolvedValueOnce(acceptedResult(repairDocument));
      const nextInput = turnInput({
        previousState: initial.state, userText: '受理する条件を変更する', traceRequestId: 'request-accepted-basis-2',
      });
      if (change === 'rejected relative range') nextInput.requestContext = {
        ...requestContext, currentDate: '2026-08-18', notBeforeDate: '2026-08-18', startedAtIso: '2026-08-18T05:55:00.000Z',
      };
      const repair = await executeWeeklyPlanningStableV5RuntimeTurn(nextInput);
      expect(repair.draftCandidates).toEqual([]);
      expect(repair.state.questions.length).toBeGreaterThan(0);
      expect(repair.preserveExistingPreview).toBe(false);
      expect(repair.stableV5Graph!.revision).toBeGreaterThan(committed.graph.revision);
      if (change === 'rejected relative range') {
        expect(repair.state.groundingRecords?.[0].status).toBe('rejected');
        expect(repair.state.lastQuestionContext?.targetSlot).toBe('stable_v5:hard_date_bound_outside_planning_window');
      } else {
        expect(repair.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
        expect(repair.stableV5Graph!.temporalConstraints).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'fixed_interval', dateExpression: initial.draftCandidates[0].date }),
        ]));
        expect(repair.stableV5Graph!.tasks).toHaveLength(3);
      }
      expect(getWeeklyPlanningStableV5RuntimeSession('conversation-preview-repair')!.graph).toEqual(committed.graph);
    },
  );


  it('commits temporal invalidation through the controller, preserves failure, and rejects old approval after recomputation', async () => {
    const userId = 'owner-preview-repair';
    const conversationId = 'conversation-preview-repair';
    const h = controllerFixture();
    const submit = h.submit;
    normalizeMock.mockResolvedValueOnce(acceptedResult(initialPreviewDocument()));
    expect((await submit('数学の計画を作る')).accepted).toBe(true);
    const oldCandidates = structuredClone(h.state.previewCandidates);
    if (!oldCandidates) throw new Error('Expected the committed initial preview');
    const oldIntake = h.state.intakeState;
    const oldGraph = getWeeklyPlanningStableV5RuntimeSession(conversationId)!.graph;
    expect(oldCandidates.length).toBeGreaterThan(0);
    const blocks = (candidates: typeof oldCandidates) => createWeeklyDraftBlocksFromPreviewCandidates({
      candidates, userId, createdAt: '2026-08-11T05:55:00.000Z',
    });
    const oldBlocks = blocks(oldCandidates);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId }).kind).toBe('eligible');

    normalizeMock.mockRejectedValueOnce(new Error('injected provider failure before acceptance'));
    // The controller commits fail_turn preservation, then rethrows ordinary execution errors.
    await expect(submit('日時条件を伝える')).rejects.toThrow('injected provider failure before acceptance');
    expect(h.state.previewCandidates).toEqual(oldCandidates);
    expect(h.state.intakeState).toBe(oldIntake);
    expect(getWeeklyPlanningStableV5RuntimeSession(conversationId)!.graph).toEqual(oldGraph);

    const change = incompatiblePendingReplyDocument();
    change.planningIntent = 'update_plan';
    change.availabilityDeclarations = [{
      localId: 'new-preference', kind: 'preferred', dateExpression: 'custom:unspecified-weekday',
      namedTimePeriod: null, startTime: '20:00', endTime: '22:00', recurrenceKind: null,
      days: [], constraintLevel: 'soft', sourceText: 'typed new date condition',
    }];
    normalizeMock.mockResolvedValueOnce(acceptedResult(change));
    expect((await submit('新しい日時希望を追加')).accepted).toBe(true);
    expect(h.state.previewCandidates).toEqual([]);
    const changedGraph = getWeeklyPlanningStableV5RuntimeSession(conversationId)!.graph;
    expect(changedGraph.revision).toBeGreaterThan(oldGraph.revision);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId }).kind).toBe('recompute_required');

    const answer = incompatiblePendingReplyDocument();
    answer.planningIntent = 'update_plan';
    answer.corrections = [{
      localId: 'remove-new-preference', operation: 'remove', replacementLocalId: null,
      target: { kind: 'availability_declaration', publicId: changedGraph.availabilityDeclarations[0].id, localId: null, mention: null },
      sourceText: '追加した日時希望は取り下げる',
    }];
    normalizeMock.mockResolvedValueOnce(acceptedResult(answer));
    expect((await submit('追加した希望は取り下げて作り直す')).accepted).toBe(true);
    const newCandidates = h.state.previewCandidates;
    if (!newCandidates) throw new Error('Expected the recomputed preview');
    expect(newCandidates.length).toBeGreaterThan(0);
    expect(newCandidates).not.toEqual(oldCandidates);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: blocks(newCandidates), userId }).kind).toBe('eligible');
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId }).kind).toBe('recompute_required');
  });

  it('invalidates a committed preview after accepted paired workload and effort correction enters unrelated repair', async () => {
    const h = controllerFixture();
    normalizeMock.mockResolvedValueOnce(acceptedResult(correctionTimeWorkDocument()));
    await h.submit('8月17日から23日で数学を3時間、1回45分');
    const before = getWeeklyPlanningStableV5RuntimeSession('conversation-preview-repair')!.graph;
    const oldCandidates = structuredClone(h.state.previewCandidates);
    if (!oldCandidates) throw new Error('Expected the committed preview before correction');
    expect(oldCandidates.length).toBeGreaterThan(0);
    const oldWork = before.workloads[0];
    const oldEffort = before.effortEstimates[0];
    const replacement = correctionTimeWorkDocument().tasks[0];
    replacement.localId = 'replacement-math';
    replacement.existingPublicId = oldWork.taskId; // Public validator requires the existing same-name task binding.
    replacement.workloads[0] = { ...replacement.workloads[0], localId: 'replacement-work', amount: 1, sourceText: '数学を1時間' };
    replacement.effortEstimates[0] = { ...replacement.effortEstimates[0], localId: 'replacement-effort', targetLocalId: 'replacement-work', minutes: 30, sourceText: '1回30分' };
    replacement.sourceText = '数学を1時間、1回30分';
    const correction = addedTaskMissingEffortDocument();
    correction.tasks.unshift(replacement);
    correction.corrections = [
      { localId: 'replace-work', operation: 'replace', replacementLocalId: 'replacement-work', target: { kind: 'workload', publicId: oldWork.id, localId: null, mention: null }, sourceText: '数学を1時間' },
      { localId: 'replace-effort', operation: 'replace', replacementLocalId: 'replacement-effort', target: { kind: 'effort_estimate', publicId: oldEffort.id, localId: null, mention: null }, sourceText: '1回30分' },
    ];
    acceptValidatedCorrection(correction);
    expect((await h.submit('数学を1時間、1回30分に変更。英単語80語も追加')).accepted).toBe(true);
    const after = getWeeklyPlanningStableV5RuntimeSession('conversation-preview-repair')!.graph;
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(after);
    const work = active.workloads.filter(row => row.taskId === oldWork.taskId);
    const efforts = active.effortEstimates.filter(row => row.taskId === oldWork.taskId);
    expect(work).toEqual([expect.objectContaining({ amount: 1, unitCode: 'hour' })]);
    expect(work[0].id).not.toBe(oldWork.id);
    expect(efforts).toEqual([expect.objectContaining({ kind: 'session_duration', minutes: 30, targetFactId: work[0].id })]);
    expect(active.tasks.some(row => row.id === oldWork.taskId)).toBe(true);
    expect(active.workloads.some(row => row.id === oldWork.id)).toBe(false);
    expect(h.observed[h.observed.length - 1].result.preserveExistingPreview).toBe(false);
    expect(h.state.intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
    expect(h.state.previewCandidates).toEqual([]);
    const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: oldCandidates, userId: 'owner-preview-repair', createdAt: requestContext.startedAtIso });
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId: 'owner-preview-repair' }).kind).toBe('recompute_required');
  });

  it('preserves committed temporal and preview state on real structured canonicalization failure through the outer executor', async () => {
    // Initial success uses the already-covered runtime path; only the failure turn
    // needs the outer failure-diagnostics/result projection, never a fabricated result.
    let useOuterExecutor = false;
    const h = controllerFixture(input => useOuterExecutor ? executeWeeklyPlanningTurn(input) : executeWeeklyPlanningStableV5RuntimeTurn(input));
    const document = correctionTimeWorkDocument();
    const task = document.tasks[0];
    task.study!.components = [{ localId: 'math-material', parentLocalId: null, role: 'material', label: '数学教材', workloads: task.workloads, sourceText: '数学教材' }];
    task.workloads = [];
    normalizeMock.mockResolvedValueOnce(acceptedResult(document));
    await h.submit('8月17日から23日で数学教材、数学を3時間、1回45分');
    const before = getWeeklyPlanningStableV5RuntimeSession('conversation-preview-repair')!.graph;
    const intake = h.state.intakeState;
    const candidates = h.state.previewCandidates;
    if (!candidates) throw new Error('Expected the committed preview before rejection');
    expect(candidates.length).toBeGreaterThan(0);
    const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: 'owner-preview-repair', createdAt: requestContext.startedAtIso });
    const approval = classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId: 'owner-preview-repair' });
    const preparedBefore = h.prepared.mock.calls.length;
    const committedBefore = h.committed.mock.calls.length;
    const replacement = structuredClone(document.tasks[0]);
    replacement.localId = 'replacement-task';
    replacement.title = '追加課題';
    replacement.sourceText = '追加課題を1時間';
    replacement.study!.components[0].localId = 'replacement-material';
    replacement.study!.components[0].workloads[0] = { ...replacement.study!.components[0].workloads[0], localId: 'replacement-work', amount: 1, sourceText: '1時間' };
    replacement.effortEstimates = [];
    const correction = incompatiblePendingReplyDocument();
    correction.planningIntent = 'update_plan';
    correction.tasks = [replacement];
    correction.corrections = [{ localId: 'replace-only-work', operation: 'replace', replacementLocalId: 'replacement-work',
      target: { kind: 'workload', publicId: before.workloads[0].id, localId: null, mention: null }, sourceText: '1時間' }];
    acceptValidatedCorrection(correction);
    useOuterExecutor = true;
    // accepted=true can acknowledge the failure message; it is not semantic acceptance.
    expect((await h.submit('数学教材の追加課題を1時間に変更')).accepted).toBe(true);
    const failed = h.observed[h.observed.length - 1];
    expect(failed.result.failure?.code).toBe('stable_v5_canonicalization_rejected');
    const events = takeWeeklyPlanningStableV5DebugTrace(failed.requestId);
    const semantic = events.find(event => event.stage === 'runtime_semantic_result_received')!.data as { canonicalization: { errors: string[] } };
    expect(semantic.canonicalization.errors.join('|')).toContain('replacement-container-not-installed');
    expect(h.prepared).toHaveBeenCalledTimes(preparedBefore);
    expect(h.committed).toHaveBeenCalledTimes(committedBefore);
    expect(getWeeklyPlanningStableV5RuntimeSession('conversation-preview-repair')!.graph).toEqual(before);
    expect(h.state.intakeState).toBe(intake);
    expect(h.state.previewCandidates).toBe(candidates);
    expect(hasWeeklyPlanningStableV5StagedGraph({ conversationId: 'conversation-preview-repair', requestId: failed.requestId })).toBe(false);
    expect(classifyWeeklyPlanningApprovalAvailability({ blocks: oldBlocks, userId: 'owner-preview-repair' })).toEqual(approval);
    expect(h.state.draftBlocks).toEqual([]);
  });

  it.each(['earliest_start', 'latest_end'] as const)('enforces the pre-resolved %s date for newly timeboxed work', async kind => {
    const evaluationSpy = vi.spyOn(planningEvaluation, 'evaluateWeeklyPlanningStableV5Planning');
    try {
      const document = initialPreviewDocument();
      const endDate = kind === 'earliest_start' ? '2026-08-19' : '2026-08-18';
      document.planningWindow = { ...document.planningWindow!, value: `2026-08-17/${endDate}`,
        start: '2026-08-17', end: endDate };
      document.tasks[0].effortEstimates = []; // A creates the real missing-effort authorization target.
      const noWork = structuredClone(document.tasks[0]);
      noWork.localId = 'task-physics';
      noWork.title = '物理';
      noWork.study = { purpose: 'homework', contextLabel: '物理', components: [] };
      noWork.workloads = [];
      noWork.sourceText = 'typed workload-free task';
      const boundDate = kind === 'earliest_start' ? '2026-08-19' : '2026-08-17';
      noWork.temporalConstraints = [{ localId: 'physics-bound', targetLocalId: noWork.localId, kind,
        constraintLevel: 'hard', dateExpression: boundDate, namedTimePeriod: null,
        startTime: kind === 'earliest_start' ? '20:00' : null,
        endTime: kind === 'latest_end' ? '13:00' : null, precision: 'exact', sourceText: 'typed date-clock bound' }];
      document.tasks.push(noWork);
      normalizeMock.mockResolvedValueOnce({ ...acceptedResult(document),
        contextualDirective: { kind: 'provisional_timebox', scope: 'current_missing_effort' } });
      const traceRequestId = `provisional-clock-${kind}`;
      const input = turnInput({ userText: 'typed provisional workload request', traceRequestId });
      if (kind === 'latest_end') input.requestContext = createWeeklyPlanningTurnRequestContext({
        startedAtIso: '2026-08-18T00:00:00.000Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday',
      });
      const result = await executeWeeklyPlanningStableV5RuntimeTurn(input);
      const evaluationIndex = evaluationSpy.mock.calls.findIndex(([params]) => params.input.traceRequestId === traceRequestId);
      expect(evaluationIndex).toBeGreaterThanOrEqual(0);
      const evaluationResult = evaluationSpy.mock.results[evaluationIndex];
      if (evaluationResult?.type !== 'return') throw new Error('Expected the real provisional evaluation to return');
      const graph = result.stableV5Graph!;
      const physics = graph.tasks.find(task => task.title === '物理');
      if (!physics) throw new Error('Expected the accepted workload-free task');
      expect(graph.workloads.some(work => work.taskId === physics.id)).toBe(false);
      expect(result.state.provisionalTimebox?.workloadFactIds).toEqual([graph.workloads[0].id]);
      const work = evaluationResult.value.compilation.input?.movableWorkItems.find(item => item.taskId === physics.id);
      if (!work) throw new Error('Expected the actual compiled timeboxed work');
      expect(work.workloadFactId).toBe(`wptb_${physics.id}`);
      expect(work.estimatedMinutes).toBe(60);
      const events = takeWeeklyPlanningStableV5DebugTrace(traceRequestId);
      const previewEvent = events.find(event => event.stage === 'runtime_preview_scheduler_evaluated');
      if (!previewEvent) throw new Error('Expected the real provisional scheduler to execute');
      const preview = previewEvent.data as { status: string; candidateCount: number;
        candidates: Array<{ workItemKey: string; date: string; durationMinutes: number }>;
        unscheduledCount: number; unscheduledWorkItems: string[] };
      const candidate = result.draftCandidates.find(item => item.workItemKey === work.id);
      if (kind === 'earliest_start') {
        // Existing A work precedes appended B work. Without B's date bound, ordinary
        // ordinal distribution picks Aug18 for B, rather than the required Aug19.
        expect(result.draftCandidates).toHaveLength(2);
        if (!candidate) throw new Error('Expected actual provisional work for the workload-free task');
        expect(candidate).toMatchObject({ date: boundDate, startTime: '20:00', durationMinutes: 60 });
        expect(result.draftCandidates.find(item => item !== candidate)).toMatchObject({ date: '2026-08-17', durationMinutes: 60 });
        expect(preview).toMatchObject({ status: 'ready', candidateCount: 2, unscheduledCount: 0 });
      } else {
        // The real request clock leaves only Aug18 available. B must be unscheduled,
        // while A still fits; application partial-preview policy is not changed here.
        expect(input.requestContext.notBeforeDate).toBe('2026-08-18');
        expect(candidate).toBeUndefined();
        expect(preview).toMatchObject({ status: 'insufficient_capacity', candidateCount: 1, unscheduledCount: 1 });
        expect(preview.unscheduledWorkItems).toEqual([work.id]);
        expect(preview.candidates[0]).toMatchObject({ date: '2026-08-18', durationMinutes: 60 });
        expect(preview.candidates[0].workItemKey).not.toBe(work.id);
      }
    } finally {
      evaluationSpy.mockRestore();
    }
  });

  it.each([false, true, 'hard-clock'] as const)('persists actual temporal runtime diagnostics through outbox retry and Worker preparation (question=%s)', async (scenario) => {
    const question = scenario === true;
    const hardClock = scenario === 'hard-clock';
    const conversationId = 'weekly-conversation-733e4567-e89b-42d3-a456-426614174010';
    const userId = 'owner-preview-repair';
    const restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    const canonicalIds = {
      sessionId: 'weekly-trace-733e4567-e89b-42d3-a456-426614174010', logicalConversationId: conversationId,
    };
    const writes: WeeklyPlanningTraceAppendInput[] = [];
    // The remote repository retries transient append once before the durable outbox owns it.
    let failuresRemaining = 2;
    const api: WeeklyPlanningTraceApiClient = {
      async getPolicyStatus() { return { policyVersion: 'test', accepted: true, acceptedAt: '2026-08-11T05:55:00.000Z' }; },
      async acceptPolicy() { return { policyVersion: 'test', accepted: true, acceptedAt: '2026-08-11T05:55:00.000Z' }; },
      async startSession() { return canonicalIds; },
      async append(payload) {
        if (failuresRemaining-- > 0) throw new TypeError('injected temporal append failure');
        writes.push(structuredClone(payload));
      },
      async deleteCurrentUserTrace() { return { deletedSessions: 0, deletedEntries: 0 }; },
      async listAdminSessions() { return []; },
      async listAdminEntries() { return []; },
      async archiveAdminSession() {},
    };
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(createRemoteWeeklyPlanningTraceRepository(api));
    try {
      const document = initialPreviewDocument();
      document.tasks[0].workloads[0].amount = 12;
      document.tasks[0].temporalConstraints = [{
        localId: 'temporal-1', targetLocalId: 'task-math',
        kind: question ? 'deadline' : hardClock ? 'earliest_start' : 'preferred_window',
        constraintLevel: question || hardClock ? 'hard' : 'soft',
        dateExpression: question ? '2026-08-14' : 'weekday:friday',
        namedTimePeriod: null, startTime: question ? null : '20:00', endTime: question || hardClock ? null : '22:00',
        precision: 'exact', sourceText: 'typed temporal diagnostic',
      }];
      normalizeMock.mockResolvedValueOnce(acceptedResult(document));
      const traceRequestId = `${conversationId}:request:1`;
      const result = await executeWeeklyPlanningStableV5RuntimeTurn({
        ...turnInput({ userText: 'typed temporal diagnostic', traceRequestId }), conversationId,
      });
      expect(result.draftCandidates).toHaveLength(question ? 0 : 1);
      if (question) {
        expect(result.state.lastQuestionContext?.targetSlot).toBe('stable_v5:hard_date_bound_outside_planning_window');
      } else {
        const acceptedGraph = result.stableV5Graph!;
        expect(acceptedGraph.workloads[0]).toMatchObject({ amount: 12, unitCode: 'page' });
        expect(acceptedGraph.effortEstimates[0]).toMatchObject({ kind: 'duration_per_unit', minutes: 5 });
        expect(acceptedGraph.workloads[0].amount! * acceptedGraph.effortEstimates[0].minutes).toBe(60);
        // Existing 1.1 safety buffer and five-minute upward rounding: 60 -> 66 -> 70.
        expect(result.draftCandidates[0]).toMatchObject({ date: '2026-08-21', startTime: '20:00', endTime: '21:10', durationMinutes: 70 });
      }
      const events = takeWeeklyPlanningStableV5DebugTrace(traceRequestId);
      const evaluation = events.find((event) => event.stage === 'runtime_scheduler_dialogue_evaluated');
      expect(evaluation).toBeDefined();
      const horizon = (evaluation!.data as { resolvedHorizon: Record<string, unknown> }).resolvedHorizon;
      expect(horizon).toEqual({ startDate: '2026-08-17', endDate: '2026-08-23' });
      horizon.futureTemporalScopeField = 'future-temporal-scope-field';
      const compilation = (evaluation!.data as { compilation: { hardClockBounds?: Array<Record<string, unknown>> } }).compilation;
      const expectedClockBounds = hardClock ? [{
        taskId: result.stableV5Graph!.tasks[0].id, targetFactId: result.stableV5Graph!.tasks[0].id,
        sourceFactId: result.stableV5Graph!.temporalConstraints[0].id,
        kind: 'earliest_start', minute: 1200, anchorDate: '2026-08-21',
      }] : null;
      if (hardClock) {
        expect(compilation.hardClockBounds).toEqual(expectedClockBounds);
        compilation.hardClockBounds![0].futureClockField = 'future-hard-clock-field';
      }

      const first = {
        userId, conversationId, requestId: traceRequestId, userText: 'typed temporal diagnostic',
        assistantMessage: result.message, responseSource: 'ai' as const,
        outcome: question ? 'scheduler_needs_resolution' : 'scheduler_ready',
        previewCount: result.draftCandidates.length, debugTraceEvents: events,
      };
      await recordWeeklyPlanningStableV5TurnTrace(first);
      expect(writes).toHaveLength(0);
      expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toHaveLength(1);

      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      setWeeklyPlanningTraceRepositoryForTests(createRemoteWeeklyPlanningTraceRepository(api));
      const oversized = structuredClone(first);
      oversized.requestId = `${conversationId}:request:2`;
      const largeEvaluation = oversized.debugTraceEvents.find((event) => event.stage === evaluation!.stage)!;
      (largeEvaluation.data as { resolvedHorizon: Record<string, unknown> }).resolvedHorizon.futureLargeScopeField = 'temporal-extension'.repeat(10_000);
      if (hardClock) {
        (largeEvaluation.data as { compilation: { hardClockBounds: Array<Record<string, unknown>> } })
          .compilation.hardClockBounds[0].oversizedClockField = 'hard-clock-extension'.repeat(10_000);
      }

      await recordWeeklyPlanningStableV5TurnTrace(oversized);
      expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toEqual([]);
      expect(writes).toHaveLength(2);
      for (const [index, write] of writes.entries()) {
        expect(write.entries).toHaveLength(1);
        const entry = write.entries[0];
        if (entry.kind !== 'turn_diagnostic') throw new Error('expected actual runtime diagnostic');
        expect(entry.userId).toBeUndefined();
        expect(entry.sessionId).toBe(canonicalIds.sessionId);
        expect(entry.logicalConversationId).toBe(canonicalIds.logicalConversationId);
        expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
        const prepared = prepareWeeklyPlanningTraceServerWrite({
          session: write.session as unknown as Record<string, unknown>, entries: [entry] as unknown as Record<string, unknown>[],
        }, { token: `wpt_${'f'.repeat(43)}`, epoch: '107' }, canonicalIds, '2026-08-11T05:55:00.000Z');
        expect(prepared.entries).toHaveLength(1);
        expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
        for (const persisted of [entry, prepared.entries[0]]) {
          const serialized = JSON.stringify(persisted);
          if (index === 0) {
            expect(serialized).toContain('future-temporal-scope-field');
            expect(serialized).toContain(question ? 'hard_date_bound_outside_planning_window' : '2026-08-21');
            if (hardClock) {
              const diagnostic = persisted as { constraintContext: { scheduler?: { hardClockBounds?: unknown } } };
              expect(diagnostic.constraintContext.scheduler?.hardClockBounds).toEqual([
                { ...expectedClockBounds![0], futureClockField: 'future-hard-clock-field' },
              ]);
            }

          } else {
            expect(serialized).toMatch(/traceProjectionTruncated|traceTruncated|truncated/u);
            expect(serialized).not.toContain('temporal-extension'.repeat(10_000));
            if (hardClock) {
              const diagnostic = persisted as { constraintContext: { scheduler?: { hardClockBounds?: unknown } } };
              expect(diagnostic.constraintContext.scheduler?.hardClockBounds).toMatchObject({ traceTruncated: true });
              expect(serialized).not.toContain('hard-clock-extension'.repeat(10_000));
            }

          }
        }
      }
    } finally {
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      restoreStorage();
    }
  });

});
