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

const shouldRun =
  process.env.WEEKLY_PLANNING_REAL_API_CONVERSATION_EVAL === '1';

const ARTIFACT_DIR = 'artifacts/weekly-planning-real-api-conversation-eval';
const DEFAULT_AUTHORIZATION_TEXT = 'この条件で予定を作って';
const MAX_TURNS_PER_SCENARIO = 14;

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
  scenarios: ScenarioReport[];
}

interface ScenarioDefinition {
  id: string;
  description: string;
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

class ConversationHarness {
  readonly scenario: ScenarioDefinition;
  readonly report: ScenarioReport;
  readonly userId: string;
  readonly conversationId: string;
  readonly store: ReturnType<typeof createStore>;

  private readonly session;
  private readonly capture: {
    latestResult: WeeklyPlanningTurnExecutionResult | null;
    traceRequestId: string | null;
  } = { latestResult: null, traceRequestId: null };
  private readonly services: WeeklyPlanningTurnApplicationServices;
  private turnIndex = 0;

  constructor(scenario: ScenarioDefinition, report: ScenarioReport) {
    resetRuntime();
    this.scenario = scenario;
    this.report = report;
    this.userId = `real-api-eval-${scenario.id}`;
    this.conversationId = `weekly-conversation-real-api-${scenario.id}`;
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

  async submit(userText: string, label: string): Promise<SubmissionSnapshot> {
    if (this.turnIndex >= MAX_TURNS_PER_SCENARIO) {
      throw new Error(`Exceeded ${MAX_TURNS_PER_SCENARIO} turns.`);
    }
    this.turnIndex += 1;
    this.capture.latestResult = null;
    this.capture.traceRequestId = null;

    const submission = await submitWeeklyPlanningApplicationTurn({
      session: this.session,
      userId: this.userId,
      ownerId: this.userId,
      userText,
      selectedDate: this.scenario.selectedDate,
      plans: this.scenario.existingPlans ?? [],
      scheduleTemplates: [],
      weekStartsOn: 'monday',
      getState: this.store.getState,
      dispatch: this.store.dispatch,
    }, this.services);

    const result = this.capture.latestResult;
    const requestId = this.capture.traceRequestId;
    if (!result || !requestId) {
      throw new Error(`Turn ${this.turnIndex} did not expose execution diagnostics.`);
    }

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
      trace: takeWeeklyPlanningStableV5DebugTrace(requestId),
    };
    this.report.turns.push(turn);

    if (!submission.accepted) {
      throw new Error(`Turn ${this.turnIndex} was rejected by the controller.`);
    }
    if (result.failure) {
      throw new Error(
        `Turn ${this.turnIndex} failed: ${result.failure.code} ${result.failure.traceCode}`,
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
    let authorizationSent = false;
    while (this.state.previewCandidates.length === 0) {
      const question = this.currentQuestion();
      let nextText: string;
      let label: string;
      if (question.code) {
        nextText = params.answer({
          question,
          state: this.state,
          graph: this.latestGraph,
          turnCount: this.turnCount,
        });
        label = `answer:${question.code}`;
      } else if (!authorizationSent) {
        nextText = params.authorizationText ?? DEFAULT_AUTHORIZATION_TEXT;
        label = params.authorizationLabel ?? 'authorize-preview';
        authorizationSent = true;
      } else {
        throw new Error('Conversation stopped without a machine question or preview.');
      }
      await this.submit(nextText, label);
    }
    return [...this.state.previewCandidates];
  }

  recordPreview(label: string): WeeklyDraftCandidate[] {
    const candidates = [...this.state.previewCandidates];
    this.report.previews.push({
      label,
      graphRevision: this.latestGraph?.revision ?? null,
      candidates,
    });
    return candidates;
  }

  async approveCurrentPreview(): Promise<ApprovalReport> {
    const candidates = [...this.state.previewCandidates];
    if (candidates.length === 0) throw new Error('No preview candidates to approve.');
    const promotedBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates,
      userId: this.userId,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    const availability = classifyWeeklyPlanningApprovalAvailability({
      blocks: promotedBlocks,
      userId: this.userId,
    });
    expect(availability).toMatchObject({ kind: 'eligible' });
    this.store.dispatch({ type: 'add_draft_blocks', blocks: promotedBlocks });

    const savedDrafts: PlanDraft[] = [];
    const savedPlans: Plan[] = [];
    const completedOperations: WeeklyDraftApprovalOperation[] = [];
    const ledgerOperations: WeeklyDraftApprovalOperation[] = [];
    const approve = () => approveWeeklyPlanningDraftBlocks({
      userId: this.userId,
      plans: [...(this.scenario.existingPlans ?? []), ...savedPlans],
      approvalOperations: ledgerOperations,
      async saveWeeklyApprovedPlan(draft) {
        savedDrafts.push(draft);
        const plan = persistedPlan(draft, savedDrafts.length, this.scenario.id);
        savedPlans.push(plan);
        return plan;
      },
      async completeWeeklyApprovalOperation(operation) {
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
  userId: string;
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
}): Plan {
  return {
    id: params.id,
    seriesId: '',
    userId: params.userId,
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
    id: 'tomorrow-natural-multiturn',
    description: '明日の計画を自然な複数ターンで作り、既存予定を避けて保存する。',
    selectedDate: '2026-08-03',
    weekStartDate: '2026-08-03',
    existingPlans: [
      createExistingPlan({
        userId: 'real-api-eval-tomorrow-natural-multiturn',
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
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.every((candidate) => candidate.date === '2026-08-04')).toBe(true);
      expect(totalCandidateMinutes(candidates)).toBe(120);
      expect(candidates.some((candidate) =>
        (harness.scenario.existingPlans ?? []).some((plan) =>
          overlapsExistingPlan(candidate, plan))),
      ).toBe(false);
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
    id: 'next-week-non-study-paraphrase',
    description: '別表現と非学習タスクでも同じ会話構造でpreviewと保存まで進む。',
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
      expect(candidates.length).toBeGreaterThan(0);
      expect(totalCandidateMinutes(candidates)).toBe(60);
      expect(candidates.every((candidate) =>
        candidate.date >= '2026-08-10' && candidate.date <= '2026-08-16'),
      ).toBe(true);
      const approval = await harness.approveCurrentPreview();
      report.checks = {
        multiTurn: report.turns.length >= 2,
        noFailure: report.turns.every((turn) => turn.failureCode === null),
        nextWeekResolved: candidates.every((candidate) =>
          candidate.date >= '2026-08-10' && candidate.date <= '2026-08-16'),
        workloadPreserved: totalCandidateMinutes(candidates) === 60,
        nonStudyConversationCompleted: approval.savedPlanCount === candidates.length,
      };
    },
  },
  {
    id: 'wrong-unit-explicit-repair',
    description: '所要時間質問へ誤った単位で答えた後、聞き返しと明示的修復で復帰する。',
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

      const targetBefore = harness.currentQuestion().targetFactId;
      const wrong = await harness.submit('3ページです', 'intentional-wrong-unit');
      const questionAfterWrong = harness.currentQuestion();
      expect(wrong.candidates).toEqual([]);
      expect(questionAfterWrong.code).toBe('missing_effort_estimate');
      expect(questionAfterWrong.targetFactId).toBe(targetBefore);
      expect(wrong.turn.graph.tasks).toHaveLength(1);

      await harness.submit(
        '違います。ページ数ではなく、数学40問の所要時間は合計3時間です',
        'explicit-repair',
      );
      const candidates = await harness.continueUntilPreview({ answer: normalAnswer });
      harness.recordPreview('repaired-preview');
      expect(totalCandidateMinutes(candidates)).toBe(180);
      const approval = await harness.approveCurrentPreview();
      report.checks = {
        wrongUnitNotAcceptedAsPreview: wrong.candidates.length === 0,
        questionTargetPreserved:
          questionAfterWrong.code === 'missing_effort_estimate'
          && questionAfterWrong.targetFactId === targetBefore,
        noSpuriousTaskAfterWrongAnswer: wrong.turn.graph.tasks.length === 1,
        repairedWorkloadScheduled: totalCandidateMinutes(candidates) === 180,
        saved: approval.savedPlanCount === candidates.length,
      };
    },
  },
  {
    id: 'preview-correction-recompute',
    description: 'preview表示後に条件を訂正し、旧previewを無効化して再preview・保存する。',
    selectedDate: '2026-08-03',
    weekStartDate: '2026-08-03',
    async run(harness, report) {
      await harness.submit(
        '来週、英語を2時間、数学を3時間やる予定を作ってください',
        'start-and-authorize',
      );
      const initialCandidates = harness.state.previewCandidates.length > 0
        ? [...harness.state.previewCandidates]
        : await harness.continueUntilPreview({
            answer: defaultAnswer({
              taskText: '英語を2時間、数学を3時間やりたいです',
              effortText: 'それぞれ英語2時間、数学3時間です',
              planningWindowText: '来週です',
            }),
          });
      harness.recordPreview('before-correction');
      expect(totalCandidateMinutes(initialCandidates)).toBe(300);
      const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
        candidates: initialCandidates,
        userId: harness.userId,
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      const oldRevision = harness.latestGraph?.revision ?? null;

      const correction = await harness.submit(
        '訂正です。数学は3時間ではなく1時間にしてください',
        'preview-correction',
      );
      expect(correction.candidates).toEqual([]);
      expect(harness.state.previewCandidates).toEqual([]);
      expect(harness.latestGraph?.revision ?? null).not.toBe(oldRevision);
      expect(classifyWeeklyPlanningApprovalAvailability({
        blocks: oldBlocks,
        userId: harness.userId,
      })).toMatchObject({
        kind: 'recompute_required',
        reason: 'state_revision_mismatch',
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
      expect(totalCandidateMinutes(correctedCandidates)).toBe(180);
      expect(correctedCandidates.map((candidate) => candidate.stableKey).sort())
        .not.toEqual(initialCandidates.map((candidate) => candidate.stableKey).sort());
      const approval = await harness.approveCurrentPreview();
      report.checks = {
        initialPreviewCreated: initialCandidates.length > 0,
        oldPreviewCleared: correction.candidates.length === 0,
        graphRevisionAdvanced: (harness.latestGraph?.revision ?? 0) > (oldRevision ?? -1),
        oldPreviewRejected: classifyWeeklyPlanningApprovalAvailability({
          blocks: oldBlocks,
          userId: harness.userId,
        }).kind === 'recompute_required',
        correctedTotalApplied: totalCandidateMinutes(correctedCandidates) === 180,
        previewRecomputed:
          correctedCandidates.map((candidate) => candidate.stableKey).sort().join('|')
          !== initialCandidates.map((candidate) => candidate.stableKey).sort().join('|'),
        saved: approval.savedPlanCount === correctedCandidates.length,
      };
    },
  },
];

function createScenarioReport(scenario: ScenarioDefinition): ScenarioReport {
  return {
    id: scenario.id,
    description: scenario.description,
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

  const transcript = report.turns.flatMap((turn) => [
    `## Turn ${turn.index}: ${turn.label}`,
    '',
    `ユーザー: ${turn.userText}`,
    '',
    `アプリ: ${turn.assistantText}`,
    '',
    `machine: question=${turn.machineQuestion.code ?? 'none'}, target=${turn.machineQuestion.targetFactId ?? 'none'}, graphRevision=${turn.graph.revision ?? 'none'}, preview=${turn.draftCandidates.length}`,
    '',
  ]).join('\n');
  writeFileSync(
    `${dir}/transcript.md`,
    [
      `# ${report.id}`,
      '',
      report.description,
      '',
      `Status: ${report.status}`,
      '',
      transcript || 'No turns.',
      '## Checks',
      '',
      ...Object.entries(report.checks).map(
        ([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'}: ${name}`,
      ),
      '',
      '## Failure',
      '',
      report.failure ?? 'none',
      '',
    ].join('\n'),
  );
}

function writeSuiteArtifacts(report: SuiteReport): void {
  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });
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
    it('runs natural dialogue, explicit repair, preview correction, approval, and save', async () => {
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
        scenarios: [],
      };

      for (const scenario of scenarios) {
        const report = createScenarioReport(scenario);
        suite.scenarios.push(report);
        try {
          const harness = new ConversationHarness(scenario, report);
          await scenario.run(harness, report);
          expect(Object.values(report.checks).every(Boolean)).toBe(true);
          report.status = 'passed';
        } catch (error) {
          report.status = 'failed';
          report.failure = error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
            : String(error);
        } finally {
          resetRuntime();
        }
      }

      suite.status = suite.scenarios.every((scenario) => scenario.status === 'passed')
        ? 'passed'
        : 'failed';
      writeSuiteArtifacts(suite);
      console.info(
        '[weekly-planning-real-api-conversation-suite]',
        JSON.stringify({
          status: suite.status,
          model: suite.model,
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
      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    }, 45 * 60 * 1000);
  },
);
