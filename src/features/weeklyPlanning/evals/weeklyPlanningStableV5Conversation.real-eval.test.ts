import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
import {
  classifyWeeklyPlanningApprovalAvailability,
} from '../application/weeklyPlanningApprovalAvailability';
import {
  approveWeeklyPlanningDraftBlocks,
} from '../application/weeklyPlanningApprovalApplication';
import {
  resetWeeklyPlanningRuntimeModeForTest,
  setWeeklyPlanningRuntimeMode,
} from '../application/weeklyPlanningRuntimeMode';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import {
  discardWeeklyPlanningApplicationTurn,
  finalizeWeeklyPlanningApplicationTurn,
} from '../application/weeklyPlanningTurnSideEffects';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from '../application/weeklyPlanningTurnApplication';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import {
  parseWeeklyPlanningPlanSourceId,
} from '../planning/weeklyPlanningPlanProvenance';
import {
  clearWeeklyPlanningSessionRuntime,
} from '../planning/weeklyPlanningSessionRuntime';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
} from '../preview/weeklyPlanningPreviewBlocks';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningDialogueRendererTrace } from '../trace/weeklyPlanningDialogueRendererTrace';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import {
  executeWeeklyPlanningTurn,
  type WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from '../weeklyPlanningReducer';
import {
  allConversationEvalChecksPass,
  evaluateExplicitRepairContract,
  evaluatePreviewCorrectionContract,
  type ConversationEvalPreviewSnapshot,
  type ConversationEvalRepairSnapshot,
} from './weeklyPlanningConversationEvalContracts';
import {
  driveConversationUntilPreview,
  renderConversationEvalTranscript,
  type ConversationEvalAdapter,
  type ConversationEvalStateSnapshot,
  type ConversationEvalSubmissionSnapshot,
} from './weeklyPlanningConversationEvalDriver';
import {
  evaluateWeeklyPlanningConversationTurnAiUsage,
  shouldContinueWeeklyPlanningRealEvalAfterScenario,
  summarizeWeeklyPlanningConversationEvalAiUsage,
  type WeeklyPlanningConversationEvalSuiteAiUsage,
  type WeeklyPlanningConversationEvalTurnAiUsage,
} from './weeklyPlanningConversationEvalExecutionPolicy';
import {
  WEEKLY_PLANNING_CONVERSATION_EVAL_SCENARIO_MANIFESTS,
  validateWeeklyPlanningConversationEvalScenarioExecution,
  type WeeklyPlanningConversationEvalScenarioManifest,
} from './weeklyPlanningConversationEvalScenarioManifest';

const shouldRun =
  process.env.WEEKLY_PLANNING_REAL_API_CONVERSATION_EVAL === '1';

const ARTIFACT_DIR = 'artifacts/weekly-planning-real-api-conversation-eval';
const DEFAULT_AUTHORIZATION_TEXT = 'この条件で予定を作って';
const MAX_TURNS_PER_SCENARIO = 16;

interface MachineQuestionSnapshot {
  code: string | null;
  targetFactId: string | null;
  actionId: string | null;
}

interface ActiveGraphSummary {
  revision: number | null;
  planningWindows: Array<{
    id: string;
    kind: string;
    value: string;
    start: string | null;
    end: string | null;
  }>;
  tasks: Array<{ id: string; title: string; category: string }>;
  workloads: Array<{
    id: string;
    taskId: string;
    taskTitle: string | null;
    amount: number;
    unitCode: string;
    quantityRole: string;
  }>;
  effortEstimates: Array<{
    id: string;
    taskId: string;
    taskTitle: string | null;
    minutes: number;
    kind: string;
  }>;
  correctionIntents: Array<{
    id: string;
    operation: string;
    targetFactId: string | null;
    publicId: string | null;
    replacementFactId: string | null;
  }>;
}

interface TurnReport {
  index: number;
  label: string;
  requestId: string;
  userText: string;
  assistantText: string;
  responseSource: string | null;
  failureCode: string | null;
  failureTraceCode: string | null;
  intakeStatus: string | null;
  machineQuestion: MachineQuestionSnapshot;
  graph: ActiveGraphSummary;
  draftCandidates: WeeklyDraftCandidate[];
  trace: unknown[];
  dialogueRendererTrace: WeeklyPlanningDialogueRendererTrace | null;
  aiUsage: WeeklyPlanningConversationEvalTurnAiUsage;
}

interface PreviewReport {
  label: string;
  graphRevision: number | null;
  candidates: WeeklyDraftCandidate[];
}

interface ApprovalReport {
  promotedBlockCount: number;
  savedPlanCount: number;
  completedOperationCount: number;
  duplicateApprovalAddedPlans: number;
  savedPlans: Plan[];
}

interface ScenarioReport {
  id: string;
  description: string;
  selectedDate: string;
  weekStartDate: string;
  status: 'running' | 'passed' | 'failed';
  turns: TurnReport[];
  previews: PreviewReport[];
  approval: ApprovalReport | null;
  checks: Record<string, boolean>;
  failure: string | null;
}

interface SuiteReport {
  generatedAt: string;
  status: 'running' | 'passed' | 'failed';
  model: string;
  baseUrl: string;
  apiUsageBoundary: {
    meaningInterpretation: true;
    assistantResponseGeneration: true;
    userSimulation: false;
    scoring: false;
    failureDiagnosis: false;
  };
  apiUsage: WeeklyPlanningConversationEvalSuiteAiUsage;
  scenarios: ScenarioReport[];
  notRunScenarioIds: string[];
}

interface ScenarioDefinition {
  manifest: WeeklyPlanningConversationEvalScenarioManifest;
  selectedDate: string;
  weekStartDate: string;
  existingPlans?: Plan[];
  run(harness: ConversationHarness, report: ScenarioReport): Promise<void>;
}

interface SubmissionSnapshot {
  result: WeeklyPlanningTurnExecutionResult;
  candidates: WeeklyDraftCandidate[];
  state: PlanningState;
  turn: TurnReport;
}

interface QuestionAnswerContext {
  question: MachineQuestionSnapshot;
  state: PlanningState;
  graph: WeeklyPlanningFactGraphV5 | undefined;
  turnCount: number;
}

type QuestionAnswerResolver = (context: QuestionAnswerContext) => string;

function manifest(id: string): WeeklyPlanningConversationEvalScenarioManifest {
  const found = WEEKLY_PLANNING_CONVERSATION_EVAL_SCENARIO_MANIFESTS.find(
    (scenario) => scenario.id === id,
  );
  if (!found) throw new Error(`Missing conversation eval manifest: ${id}`);
  return found;
}

function createStore(weekStartDate: string) {
  let state: PlanningState = createInitialPlanningState(weekStartDate);
  return {
    getState: () => state,
    dispatch(action: WeeklyPlanningAction): PlanningState {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function resetRuntime(): void {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
  resetWeeklyPlanningRuntimeModeForTest();
  setWeeklyPlanningRuntimeMode('stable_v5');
}

function previewCandidates(state: PlanningState): WeeklyDraftCandidate[] {
  return [...(state.previewCandidates ?? [])];
}

function machineQuestion(state: PlanningState): MachineQuestionSnapshot {
  const context = state.intakeState?.lastQuestionContext;
  const targetSlot = context?.targetSlot;
  return {
    code: targetSlot?.startsWith('stable_v5:')
      ? targetSlot.slice('stable_v5:'.length) || null
      : null,
    targetFactId: context?.topicId ?? null,
    actionId: context?.actionId ?? null,
  };
}

function activeFactIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

function graphSummary(
  graph: WeeklyPlanningFactGraphV5 | undefined,
): ActiveGraphSummary {
  if (!graph) {
    return {
      revision: null,
      planningWindows: [],
      tasks: [],
      workloads: [],
      effortEstimates: [],
      correctionIntents: [],
    };
  }
  const activeIds = activeFactIds(graph);
  const taskTitleById = new Map(graph.tasks.map((task) => [task.id, task.title]));
  return {
    revision: graph.revision,
    planningWindows: graph.planningWindows
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        id: fact.id,
        kind: fact.kind,
        value: fact.value,
        start: fact.start,
        end: fact.end,
      })),
    tasks: graph.tasks
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({ id: fact.id, title: fact.title, category: fact.category })),
    workloads: graph.workloads
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        id: fact.id,
        taskId: fact.taskId,
        taskTitle: taskTitleById.get(fact.taskId) ?? null,
        amount: fact.amount,
        unitCode: fact.unitCode,
        quantityRole: fact.quantityRole,
      })),
    effortEstimates: graph.effortEstimates
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        id: fact.id,
        taskId: fact.taskId,
        taskTitle: taskTitleById.get(fact.taskId) ?? null,
        minutes: fact.minutes,
        kind: fact.kind,
      })),
    correctionIntents: graph.correctionIntents
      .filter((fact) => activeIds.has(fact.id))
      .map((fact) => ({
        id: fact.id,
        operation: fact.operation,
        targetFactId: fact.target.factId,
        publicId: fact.target.publicId,
        replacementFactId: fact.replacementFactId,
      })),
  };
}

function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time in eval result: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function candidateMinutes(candidate: WeeklyDraftCandidate): number {
  return Number.isFinite(candidate.durationMinutes)
    ? candidate.durationMinutes
    : timeToMinutes(candidate.endTime) - timeToMinutes(candidate.startTime);
}

function totalCandidateMinutes(candidates: readonly WeeklyDraftCandidate[]): number {
  return candidates.reduce((total, candidate) => total + candidateMinutes(candidate), 0);
}

function candidateMinutesForLabel(
  candidates: readonly WeeklyDraftCandidate[],
  expectedLabel: string,
): number {
  const normalized = expectedLabel.replace(/\s+/g, '');
  return candidates
    .filter((candidate) =>
      `${candidate.title}${candidate.field}`.replace(/\s+/g, '').includes(normalized))
    .reduce((total, candidate) => total + candidateMinutes(candidate), 0);
}

function overlapsExistingPlan(candidate: WeeklyDraftCandidate, plan: Plan): boolean {
  if (candidate.date !== plan.date) return false;
  return (
    timeToMinutes(candidate.startTime) < timeToMinutes(plan.endTime)
    && timeToMinutes(candidate.endTime) > timeToMinutes(plan.startTime)
  );
}

function persistedPlan(draft: PlanDraft, index: number, scenarioId: string): Plan {
  return {
    ...createPlanFromDraft(draft),
    id: `${scenarioId}-saved-${index}`,
  };
}

function noOpTraceWriter(): null {
  return null;
}

function readAsyncCapture<T>(read: () => T): T {
  return read();
}

function suiteAiUsage(report: SuiteReport): WeeklyPlanningConversationEvalSuiteAiUsage {
  return summarizeWeeklyPlanningConversationEvalAiUsage(
    report.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.aiUsage)),
  );
}

class ConversationHarness {
  readonly scenario: ScenarioDefinition;
  readonly report: ScenarioReport;
  readonly userId: string;
  readonly conversationId: string;
  readonly store: ReturnType<typeof createStore>;

  private readonly suite: SuiteReport;
  private readonly session: ReturnType<typeof createWeeklyPlanningControllerSession>;
  private readonly capture: {
    latestResult: WeeklyPlanningTurnExecutionResult | null;
    traceRequestId: string | null;
  } = { latestResult: null, traceRequestId: null };
  private readonly services: WeeklyPlanningTurnApplicationServices;
  private turnIndex = 0;

  constructor(scenario: ScenarioDefinition, report: ScenarioReport, suite: SuiteReport) {
    resetRuntime();
    this.scenario = scenario;
    this.report = report;
    this.suite = suite;
    this.userId = `real-api-eval-${scenario.manifest.id}`;
    this.conversationId = `weekly-conversation-real-api-${scenario.manifest.id}`;
    this.store = createStore(scenario.weekStartDate);
    this.session = createWeeklyPlanningControllerSession(
      this.userId,
      scenario.weekStartDate,
      this.conversationId,
    );
    this.services = {
      submitControlledTurn: submitWeeklyPlanningControlledTurn,
      executeTurn: async (input) => {
        this.capture.traceRequestId = input.traceRequestId;
        const result = await executeWeeklyPlanningTurn(input);
        this.capture.latestResult = result;
        return result;
      },
      isStableV5Enabled: () => true,
      bindStableV5SessionScope: bindWeeklyPlanningStableV5RuntimeSessionScope,
      saveOwnedState: () => undefined,
      finalizeTurn: finalizeWeeklyPlanningApplicationTurn,
      discardTurn: discardWeeklyPlanningApplicationTurn,
      recordCommittedTurn: noOpTraceWriter,
      recordDiscardedTurn: noOpTraceWriter,
      recordFailedTurn: noOpTraceWriter,
    };
  }

  get state(): PlanningState {
    return this.store.getState();
  }

  get latestGraph(): WeeklyPlanningFactGraphV5 | undefined {
    return this.capture.latestResult?.stableV5Graph;
  }

  get turnCount(): number {
    return this.turnIndex;
  }

  currentQuestion(): MachineQuestionSnapshot {
    return machineQuestion(this.state);
  }

  stateSnapshot(): ConversationEvalStateSnapshot {
    return {
      machineQuestion: this.currentQuestion(),
      graphRevision: this.latestGraph?.revision ?? null,
      previewCount: previewCandidates(this.state).length,
    };
  }

  repairSnapshot(): ConversationEvalRepairSnapshot {
    return {
      graphRevision: this.latestGraph?.revision ?? null,
      previewCount: previewCandidates(this.state).length,
      questionCode: this.currentQuestion().code,
      targetFactId: this.currentQuestion().targetFactId,
      activeTaskCount: graphSummary(this.latestGraph).tasks.length,
      totalPreviewMinutes: totalCandidateMinutes(previewCandidates(this.state)),
    };
  }

  previewSnapshot(): ConversationEvalPreviewSnapshot {
    const candidates = previewCandidates(this.state);
    return {
      graphRevision: this.latestGraph?.revision ?? null,
      previewKeys: candidates.map((candidate) => candidate.stableKey),
      totalPreviewMinutes: totalCandidateMinutes(candidates),
    };
  }

  async submit(userText: string, label: string): Promise<SubmissionSnapshot> {
    if (this.turnIndex >= MAX_TURNS_PER_SCENARIO) {
      throw new Error(`Exceeded ${MAX_TURNS_PER_SCENARIO} turns.`);
    }
    this.turnIndex += 1;
    this.capture.latestResult = null;
    this.capture.traceRequestId = null;

    const scenarioPlans = (this.scenario.existingPlans ?? []).map((plan) => ({
      ...plan,
      userId: this.userId,
    }));
    const submission = await submitWeeklyPlanningApplicationTurn({
      session: this.session,
      userId: this.userId,
      ownerId: this.userId,
      userText,
      selectedDate: this.scenario.selectedDate,
      plans: scenarioPlans,
      scheduleTemplates: [],
      weekStartsOn: 'monday',
      getState: this.store.getState,
      dispatch: this.store.dispatch,
    }, this.services);

    const result = readAsyncCapture<WeeklyPlanningTurnExecutionResult | null>(
      () => this.capture.latestResult,
    );
    const requestId = readAsyncCapture<string | null>(
      () => this.capture.traceRequestId,
    );
    if (!result || !requestId) {
      throw new Error(`Turn ${this.turnIndex} did not expose execution diagnostics.`);
    }

    const trace = takeWeeklyPlanningStableV5DebugTrace(requestId);
    const dialogueRendererTrace = result.dialogueRendererTrace ?? null;
    const aiUsage = evaluateWeeklyPlanningConversationTurnAiUsage({
      responseSource: result.responseSource ?? null,
      semanticTrace: trace,
      dialogueRendererTrace,
    });
    const turn: TurnReport = {
      index: this.turnIndex,
      label,
      requestId,
      userText,
      assistantText: this.state.lastAssistantMessage ?? '',
      responseSource: result.responseSource ?? null,
      failureCode: result.failure?.code ?? null,
      failureTraceCode: result.failure?.traceCode ?? null,
      intakeStatus: this.state.intakeState?.status ?? null,
      machineQuestion: this.currentQuestion(),
      graph: graphSummary(result.stableV5Graph),
      draftCandidates: [...submission.draftCandidates],
      trace,
      dialogueRendererTrace,
      aiUsage,
    };
    this.report.turns.push(turn);
    writeSuiteArtifacts(this.suite);

    if (!submission.accepted) {
      throw new Error(`Turn ${this.turnIndex} was rejected by the controller.`);
    }
    if (result.failure) {
      throw new Error(
        `Turn ${this.turnIndex} failed: ${result.failure.code} ${result.failure.traceCode}`,
      );
    }
    if (aiUsage.errors.length > 0) {
      throw new Error(
        `Turn ${this.turnIndex} violated real API usage policy: ${aiUsage.errors.join(', ')}`,
      );
    }
    return {
      result,
      candidates: [...submission.draftCandidates],
      state: this.state,
      turn,
    };
  }

  async continueUntilPreview(params: {
    answer: QuestionAnswerResolver;
    authorizationText?: string;
    authorizationLabel?: string;
  }): Promise<WeeklyDraftCandidate[]> {
    const adapter: ConversationEvalAdapter = {
      snapshot: () => this.stateSnapshot(),
      submit: async (userText, label): Promise<ConversationEvalSubmissionSnapshot> => {
        const submitted = await this.submit(userText, label);
        return {
          ...this.stateSnapshot(),
          accepted: true,
          turnIndex: submitted.turn.index,
          label,
          userText,
          assistantText: submitted.turn.assistantText,
          failureCode: submitted.turn.failureCode,
        };
      },
    };

    await driveConversationUntilPreview(adapter, {
      answerQuestion: ({ question }) => params.answer({
        question,
        state: this.state,
        graph: this.latestGraph,
        turnCount: this.turnCount,
      }),
      authorizationText: params.authorizationText ?? DEFAULT_AUTHORIZATION_TEXT,
      authorizationLabel: params.authorizationLabel,
      maxTurns: MAX_TURNS_PER_SCENARIO - this.turnCount,
    });
    return previewCandidates(this.state);
  }

  recordPreview(label: string): WeeklyDraftCandidate[] {
    const candidates = previewCandidates(this.state);
    this.report.previews.push({
      label,
      graphRevision: this.latestGraph?.revision ?? null,
      candidates,
    });
    writeSuiteArtifacts(this.suite);
    return candidates;
  }

  async approveCurrentPreview(): Promise<ApprovalReport> {
    const candidates = previewCandidates(this.state);
    if (candidates.length === 0) throw new Error('No preview candidates to approve.');
    const promotedBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates,
      userId: this.userId,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    expect(classifyWeeklyPlanningApprovalAvailability({
      blocks: promotedBlocks,
      userId: this.userId,
    })).toMatchObject({ kind: 'eligible' });
    this.store.dispatch({ type: 'add_draft_blocks', blocks: promotedBlocks });

    const savedDrafts: PlanDraft[] = [];
    const savedPlans: Plan[] = [];
    const completedOperations: WeeklyDraftApprovalOperation[] = [];
    const ledgerOperations: WeeklyDraftApprovalOperation[] = [];
    const scenarioId = this.scenario.manifest.id;
    const scenarioPlans = (this.scenario.existingPlans ?? []).map((plan) => ({
      ...plan,
      userId: this.userId,
    }));
    const approve = () => approveWeeklyPlanningDraftBlocks({
      userId: this.userId,
      plans: [...scenarioPlans, ...savedPlans],
      approvalOperations: ledgerOperations,
      saveWeeklyApprovedPlan: async (draft) => {
        savedDrafts.push(draft);
        const plan = persistedPlan(draft, savedDrafts.length, scenarioId);
        savedPlans.push(plan);
        return plan;
      },
      completeWeeklyApprovalOperation: async (operation) => {
        completedOperations.push(operation);
      },
      getState: this.store.getState,
      dispatch: this.store.dispatch,
      onOperationCompleted(operation) {
        ledgerOperations.push(operation);
      },
    });

    await approve();
    const savedCountAfterFirstApproval = savedPlans.length;
    await approve();

    savedDrafts.forEach((draft) => {
      expect(draft.sourceType).toBe('weekly-planning');
      expect(parseWeeklyPlanningPlanSourceId(draft.sourceId)).not.toBeNull();
    });
    expect(savedPlans).toHaveLength(promotedBlocks.length);
    expect(completedOperations).toHaveLength(1);
    expect(savedPlans.length - savedCountAfterFirstApproval).toBe(0);
    expect(this.state.pendingApproval).toBeUndefined();
    expect(this.state.draftBlocks).toEqual([]);
    expect(this.state.mode).toBe('idle');

    const approval: ApprovalReport = {
      promotedBlockCount: promotedBlocks.length,
      savedPlanCount: savedPlans.length,
      completedOperationCount: completedOperations.length,
      duplicateApprovalAddedPlans: savedPlans.length - savedCountAfterFirstApproval,
      savedPlans,
    };
    this.report.approval = approval;
    writeSuiteArtifacts(this.suite);
    return approval;
  }
}

function defaultAnswer(params: {
  taskText: string;
  effortText: string;
  planningWindowText: string;
  timeBoundsText?: string;
}): QuestionAnswerResolver {
  return ({ question }) => {
    switch (question.code) {
      case 'missing_schedulable_work':
        return params.taskText;
      case 'missing_effort_estimate':
        return params.effortText;
      case 'quantity_role_unresolved':
        return '今回進めたい量です';
      case 'invalid_planning_horizon':
      case 'ambiguous_planning_window':
      case 'missing_availability_date_scope':
      case 'missing_commitment_date_scope':
        return params.planningWindowText;
      case 'missing_time_bounds':
      case 'invalid_time_interval':
      case 'named_time_period_unresolved':
      case 'invalid_commitment_interval':
        return params.timeBoundsText ?? '18時から20時です';
      default:
        throw new Error(`No deterministic answer for question code: ${question.code}`);
    }
  };
}

function createExistingPlan(params: {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
}): Plan {
  return {
    id: params.id,
    seriesId: '',
    userId: 'scenario-user-is-rebound-by-harness',
    title: params.title,
    subject: '',
    date: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

const scenarios: ScenarioDefinition[] = [
  {
    manifest: manifest('tomorrow-natural-multiturn'),
    selectedDate: '2026-08-03',
    weekStartDate: '2026-08-03',
    existingPlans: [
      createExistingPlan({
        id: 'existing-baito',
        title: 'バイト',
        date: '2026-08-04',
        startTime: '18:00',
        endTime: '20:00',
      }),
    ],
    async run(harness, report) {
      await harness.submit('次の日の勉強計画を立てたいです', 'start');
      const candidates = await harness.continueUntilPreview({
        answer: defaultAnswer({
          taskText: '英語を2時間やりたいです',
          effortText: '合計で2時間です',
          planningWindowText: '明日です',
        }),
      });
      harness.recordPreview('initial-preview');
      const approval = await harness.approveCurrentPreview();
      report.checks = {
        multiTurn: report.turns.length >= 2,
        noFailure: report.turns.every((turn) => turn.failureCode === null),
        traceCaptured: report.turns.every((turn) => turn.trace.length > 0),
        tomorrowResolved: candidates.every((candidate) => candidate.date === '2026-08-04'),
        workloadPreserved: totalCandidateMinutes(candidates) === 120,
        existingPlanAvoided: !candidates.some((candidate) =>
          (harness.scenario.existingPlans ?? []).some((plan) =>
            overlapsExistingPlan(candidate, plan))),
        saved: approval.savedPlanCount === candidates.length,
        duplicateApprovalSuppressed: approval.duplicateApprovalAddedPlans === 0,
      };
    },
  },
  {
    manifest: manifest('next-week-non-study-paraphrase'),
    selectedDate: '2026-08-03',
    weekStartDate: '2026-08-03',
    async run(harness, report) {
      await harness.submit('来週のやることをいい感じに組みたいです', 'start');
      const candidates = await harness.continueUntilPreview({
        answer: defaultAnswer({
          taskText: '部屋の掃除を1時間入れたいです',
          effortText: '全部で1時間です',
          planningWindowText: '来週です',
        }),
      });
      harness.recordPreview('initial-preview');
      const approval = await harness.approveCurrentPreview();
      report.checks = {
        multiTurn: report.turns.length >= 2,
        noFailure: report.turns.every((turn) => turn.failureCode === null),
        nextWeekResolved: candidates.every((candidate) =>
          candidate.date >= '2026-08-10' && candidate.date <= '2026-08-16'),
        workloadPreserved: totalCandidateMinutes(candidates) === 60,
        nonStudyTypePreserved: approval.savedPlans.every((plan) => plan.type === 'other'),
        saved: approval.savedPlanCount === candidates.length,
      };
    },
  },
  {
    manifest: manifest('wrong-unit-explicit-repair'),
    selectedDate: '2026-08-03',
    weekStartDate: '2026-08-03',
    async run(harness, report) {
      await harness.submit('来週、数学の問題を40問進める予定を立てたいです', 'start');
      const normalAnswer = defaultAnswer({
        taskText: '数学の問題を40問進めたいです',
        effortText: '合計で3時間です',
        planningWindowText: '来週です',
      });

      while (harness.currentQuestion().code !== 'missing_effort_estimate') {
        const question = harness.currentQuestion();
        if (!question.code) {
          throw new Error('Expected a machine question before the effort estimate repair case.');
        }
        await harness.submit(
          normalAnswer({
            question,
            state: harness.state,
            graph: harness.latestGraph,
            turnCount: harness.turnCount,
          }),
          `prepare:${question.code}`,
        );
      }

      const beforeWrongAnswer = harness.repairSnapshot();
      await harness.submit('3ページです', 'intentional-wrong-unit');
      const afterWrongAnswer = harness.repairSnapshot();
      await harness.submit(
        '違います。ページ数ではなく、数学40問の所要時間は合計3時間です',
        'explicit-repair',
      );
      const candidates = await harness.continueUntilPreview({ answer: normalAnswer });
      harness.recordPreview('repaired-preview');
      const afterRepair = harness.repairSnapshot();
      const repairChecks = evaluateExplicitRepairContract({
        expectedQuestionCode: 'missing_effort_estimate',
        expectedTargetFactId: beforeWrongAnswer.targetFactId,
        activeTaskCountBeforeWrongAnswer: beforeWrongAnswer.activeTaskCount,
        expectedRepairedTotalMinutes: 180,
        beforeWrongAnswer,
        afterWrongAnswer,
        afterRepair,
      });
      const approval = await harness.approveCurrentPreview();
      report.checks = {
        ...repairChecks,
        saved: approval.savedPlanCount === candidates.length,
      };
    },
  },
  {
    manifest: manifest('cross-task-correction-before-preview'),
    selectedDate: '2026-08-03',
    weekStartDate: '2026-08-03',
    async run(harness, report) {
      await harness.submit(
        '来週、英語を2時間、数学を3時間やりたいです',
        'start-with-two-tasks',
      );
      const correction = await harness.submit(
        '訂正です。英語は3時間、数学は2時間です',
        'cross-task-correction',
      );
      expect(correction.candidates).toEqual([]);
      const candidates = await harness.continueUntilPreview({
        answer: defaultAnswer({
          taskText: '英語を3時間、数学を2時間やりたいです',
          effortText: '英語3時間、数学2時間です',
          planningWindowText: '来週です',
        }),
        authorizationText: '修正後の条件で予定を作って',
      });
      harness.recordPreview('corrected-preview');
      const approval = await harness.approveCurrentPreview();
      report.checks = {
        twoActiveTasksRemain: correction.turn.graph.tasks.length === 2,
        totalPreserved: totalCandidateMinutes(candidates) === 300,
        englishCorrected: candidateMinutesForLabel(candidates, '英語') === 180,
        mathCorrected: candidateMinutesForLabel(candidates, '数学') === 120,
        noDuplicateTask: correction.turn.graph.tasks.filter((task) =>
          task.title.includes('英語')).length === 1
          && correction.turn.graph.tasks.filter((task) =>
            task.title.includes('数学')).length === 1,
        saved: approval.savedPlanCount === candidates.length,
      };
    },
  },
  {
    manifest: manifest('preview-correction-recompute'),
    selectedDate: '2026-08-03',
    weekStartDate: '2026-08-03',
    async run(harness, report) {
      await harness.submit(
        '来週、英語を2時間、数学を3時間やる予定を作ってください',
        'start-and-authorize',
      );
      const initialCandidates = previewCandidates(harness.state).length > 0
        ? previewCandidates(harness.state)
        : await harness.continueUntilPreview({
            answer: defaultAnswer({
              taskText: '英語を2時間、数学を3時間やりたいです',
              effortText: 'それぞれ英語2時間、数学3時間です',
              planningWindowText: '来週です',
            }),
          });
      harness.recordPreview('before-correction');
      const beforeCorrection = harness.previewSnapshot();
      const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
        candidates: initialCandidates,
        userId: harness.userId,
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      await harness.submit(
        '訂正です。数学は3時間ではなく1時間にしてください',
        'preview-correction',
      );
      const correctionTurn = harness.previewSnapshot();
      const staleAvailability = classifyWeeklyPlanningApprovalAvailability({
        blocks: oldBlocks,
        userId: harness.userId,
      });

      const correctedCandidates = await harness.continueUntilPreview({
        answer: defaultAnswer({
          taskText: '英語を2時間、数学を1時間やりたいです',
          effortText: '英語2時間、数学1時間です',
          planningWindowText: '来週です',
        }),
        authorizationText: '修正後の条件で予定を作って',
        authorizationLabel: 'reauthorize-corrected-preview',
      });
      harness.recordPreview('after-correction');
      const afterCorrection = harness.previewSnapshot();
      const correctionChecks = evaluatePreviewCorrectionContract({
        expectedCorrectedTotalMinutes: 180,
        beforeCorrection,
        correctionTurn,
        afterCorrection,
      });
      const approval = await harness.approveCurrentPreview();
      report.checks = {
        ...correctionChecks,
        stalePreviewRejected:
          staleAvailability.kind === 'recompute_required'
          && staleAvailability.reason === 'state_revision_mismatch',
        englishPreserved: candidateMinutesForLabel(correctedCandidates, '英語') === 120,
        mathCorrected: candidateMinutesForLabel(correctedCandidates, '数学') === 60,
        saved: approval.savedPlanCount === correctedCandidates.length,
        duplicateApprovalSuppressed: approval.duplicateApprovalAddedPlans === 0,
      };
    },
  },
];

function createScenarioReport(scenario: ScenarioDefinition): ScenarioReport {
  return {
    id: scenario.manifest.id,
    description: scenario.manifest.description,
    selectedDate: scenario.selectedDate,
    weekStartDate: scenario.weekStartDate,
    status: 'running',
    turns: [],
    previews: [],
    approval: null,
    checks: {},
    failure: null,
  };
}

function writeScenarioArtifacts(report: ScenarioReport): void {
  const dir = `${ARTIFACT_DIR}/scenarios/${report.id}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  report.turns.forEach((turn) => {
    writeFileSync(
      `${dir}/turn-${String(turn.index).padStart(2, '0')}.json`,
      JSON.stringify(turn, null, 2),
    );
  });
  report.previews.forEach((preview, index) => {
    writeFileSync(
      `${dir}/preview-${String(index + 1).padStart(2, '0')}.json`,
      JSON.stringify(preview, null, 2),
    );
  });
  if (report.approval) {
    writeFileSync(`${dir}/approval.json`, JSON.stringify(report.approval, null, 2));
  }
  if (report.failure) writeFileSync(`${dir}/failure.txt`, report.failure);

  writeFileSync(
    `${dir}/transcript.md`,
    renderConversationEvalTranscript({
      scenarioId: report.id,
      description: report.description,
      status: report.status,
      turns: report.turns.map((turn) => ({
        index: turn.index,
        label: turn.label,
        userText: turn.userText,
        assistantText: turn.assistantText,
        machineQuestion: turn.machineQuestion,
        graphRevision: turn.graph.revision,
        previewCount: turn.draftCandidates.length,
      })),
      checks: report.checks,
      failure: report.failure,
    }),
  );
}

function prepareSuiteArtifacts(): void {
  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });
}

function writeSuiteArtifacts(report: SuiteReport): void {
  report.apiUsage = suiteAiUsage(report);
  report.scenarios.forEach(writeScenarioArtifacts);
  writeFileSync(`${ARTIFACT_DIR}/report.json`, JSON.stringify(report, null, 2));

  const scenarioLines = report.scenarios.flatMap((scenario) => [
    `## ${scenario.id}`,
    '',
    `Status: ${scenario.status}`,
    `Turns: ${scenario.turns.length}`,
    `Previews: ${scenario.previews.length}`,
    `Saved plans: ${scenario.approval?.savedPlanCount ?? 0}`,
    `Failure: ${scenario.failure ?? 'none'}`,
    '',
    ...Object.entries(scenario.checks).map(
      ([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'}: ${name}`,
    ),
    '',
  ]);
  writeFileSync(
    `${ARTIFACT_DIR}/report.md`,
    [
      '# Weekly Planning Real API Conversation Suite',
      '',
      `Status: ${report.status}`,
      `Model: ${report.model}`,
      `Generated: ${report.generatedAt}`,
      `Executed turns: ${report.apiUsage.turnCount}`,
      `Semantic API requests: ${report.apiUsage.semanticRequestCount}`,
      `Renderer API requests: ${report.apiUsage.rendererRequestCount}`,
      `Total API requests: ${report.apiUsage.totalRequestCount}`,
      `Maximum allowed requests for executed turns: ${report.apiUsage.maximumAllowedRequestCount}`,
      `All turns used required AI paths: ${report.apiUsage.allTurnsUsedRequiredAiPaths}`,
      `Within request budget: ${report.apiUsage.withinSuiteRequestBudget}`,
      `Not run scenarios: ${report.notRunScenarioIds.join(', ') || 'none'}`,
      '',
      'AI API is used only for meaning interpretation and assistant response generation.',
      'Conversation naturalness is reviewed from transcripts by the external development agent.',
      '',
      ...scenarioLines,
    ].join('\n'),
  );
}

describe.skipIf(!shouldRun)(
  'Weekly Planning Stable V5 real API conversation suite',
  () => {
    it('runs natural dialogue, explicit repair, cross-task correction, preview correction, approval, and save', async () => {
      const suite: SuiteReport = {
        generatedAt: new Date().toISOString(),
        status: 'running',
        model: process.env.VITE_AI_MODEL?.trim() || 'gpt-5.4-mini',
        baseUrl: process.env.VITE_AI_BASE_URL?.trim() || 'https://api.openai.com/v1',
        apiUsageBoundary: {
          meaningInterpretation: true,
          assistantResponseGeneration: true,
          userSimulation: false,
          scoring: false,
          failureDiagnosis: false,
        },
        apiUsage: summarizeWeeklyPlanningConversationEvalAiUsage([]),
        scenarios: [],
        notRunScenarioIds: scenarios.map((scenario) => scenario.manifest.id),
      };
      prepareSuiteArtifacts();
      writeSuiteArtifacts(suite);

      for (const scenario of scenarios) {
        const report = createScenarioReport(scenario);
        suite.scenarios.push(report);
        suite.notRunScenarioIds = scenarios
          .map((candidate) => candidate.manifest.id)
          .filter((id) => !suite.scenarios.some((executed) => executed.id === id));
        writeSuiteArtifacts(suite);
        try {
          const harness = new ConversationHarness(scenario, report, suite);
          await scenario.run(harness, report);
          const executionErrors = validateWeeklyPlanningConversationEvalScenarioExecution({
            manifest: scenario.manifest,
            actualUserUtterances: report.turns.map((turn) => turn.userText),
            checks: report.checks,
          });
          expect(executionErrors, executionErrors.join('\n')).toEqual([]);
          expect(allConversationEvalChecksPass(report.checks)).toBe(true);
          report.status = 'passed';
        } catch (error) {
          report.status = 'failed';
          report.failure = error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
            : String(error);
        } finally {
          resetRuntime();
          writeSuiteArtifacts(suite);
        }

        if (!shouldContinueWeeklyPlanningRealEvalAfterScenario(report.status)) {
          break;
        }
      }

      suite.apiUsage = suiteAiUsage(suite);
      suite.status =
        suite.scenarios.length === scenarios.length
        && suite.scenarios.every((scenario) => scenario.status === 'passed')
        && suite.apiUsage.allTurnsUsedRequiredAiPaths
        && suite.apiUsage.withinSuiteRequestBudget
          ? 'passed'
          : 'failed';
      writeSuiteArtifacts(suite);
      console.info(
        '[weekly-planning-real-api-conversation-suite]',
        JSON.stringify({
          status: suite.status,
          model: suite.model,
          apiUsage: suite.apiUsage,
          notRunScenarioIds: suite.notRunScenarioIds,
          scenarios: suite.scenarios.map((scenario) => ({
            id: scenario.id,
            status: scenario.status,
            turns: scenario.turns.length,
            previews: scenario.previews.length,
            failure: scenario.failure,
          })),
        }, null, 2),
      );

      const failures = suite.scenarios.filter((scenario) => scenario.status !== 'passed');
      expect(
        {
          failures,
          notRunScenarioIds: suite.notRunScenarioIds,
          apiUsage: suite.apiUsage,
        },
        JSON.stringify({
          failures,
          notRunScenarioIds: suite.notRunScenarioIds,
          apiUsage: suite.apiUsage,
        }, null, 2),
      ).toEqual({
        failures: [],
        notRunScenarioIds: [],
        apiUsage: expect.objectContaining({
          allTurnsUsedRequiredAiPaths: true,
          withinSuiteRequestBudget: true,
          errors: [],
        }),
      });
    }, 45 * 60 * 1000);
  },
);
