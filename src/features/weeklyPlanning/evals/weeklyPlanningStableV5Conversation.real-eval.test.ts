import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Plan, PlanDraft } from '../../../types/domain';
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

const USER_ID = 'real-api-conversation-eval-user';
const SELECTED_DATE = '2026-08-03';
const EXPECTED_PLAN_DATE = '2026-08-04';
const WEEK_START_DATE = '2026-08-03';
const CONVERSATION_ID =
  'weekly-conversation-62cfef12-b8e6-4b76-ad79-f24e1ce2df8a';
const AUTHORIZATION_TEXT = 'この条件で予定を作って';
const EXPECTED_TOTAL_MINUTES = 120;
const MAX_TURNS = 8;
const ARTIFACT_DIR = 'artifacts/weekly-planning-real-api-conversation-eval';

interface TurnReport {
  index: number;
  requestId: string;
  userText: string;
  assistantText: string;
  responseSource: string | null;
  failureCode: string | null;
  intakeStatus: string | null;
  questionCode: string | null;
  graphRevision: number | null;
  draftCandidateCount: number;
  trace: unknown[];
}

interface ApprovalReport {
  promotedBlockCount: number;
  savedPlanCount: number;
  completedOperationCount: number;
  duplicateApprovalAddedPlans: number;
  savedPlans: Plan[];
}

interface EvaluationReport {
  generatedAt: string;
  status: 'running' | 'passed' | 'failed';
  model: string;
  baseUrl: string;
  scenario: {
    id: string;
    selectedDate: string;
    expectedPlanDate: string;
    initialUserText: string;
    answersByQuestionCode: Record<string, string>;
    authorizationText: string;
    existingPlans: Plan[];
  };
  turns: TurnReport[];
  previewCandidates: WeeklyDraftCandidate[];
  approval: ApprovalReport | null;
  checks: Record<string, boolean>;
  failure: string | null;
}

const existingPlans: Plan[] = [{
  id: 'existing-plan-baito',
  seriesId: '',
  userId: USER_ID,
  title: 'バイト',
  subject: '',
  date: EXPECTED_PLAN_DATE,
  startTime: '18:00',
  endTime: '20:00',
  repeat: 'none',
  repeatUntil: null,
  excludedDates: [],
  recurrenceRules: [],
  type: 'other',
  memo: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}];

const answersByQuestionCode: Record<string, string> = {
  missing_schedulable_work: '英語を2時間勉強したいです',
  missing_effort_estimate: '合計で2時間です',
  quantity_role_unresolved: '今回進めたい量です',
  invalid_planning_horizon: '明日です',
  ambiguous_planning_window: '明日です',
  missing_availability_date_scope: '明日です',
  missing_time_bounds: '18時から20時です',
  invalid_time_interval: '18時から20時です',
};

function createStore() {
  let state: PlanningState = createInitialPlanningState(WEEK_START_DATE);
  return {
    getState: () => state,
    dispatch(action: WeeklyPlanningAction): PlanningState {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function requestIdFor(index: number): string {
  return `${CONVERSATION_ID}:request:${index}`;
}

function questionCode(state: PlanningState): string | null {
  const targetSlot = state.intakeState?.lastQuestionContext?.targetSlot;
  if (!targetSlot?.startsWith('stable_v5:')) return null;
  return targetSlot.slice('stable_v5:'.length) || null;
}

function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time in eval result: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function candidateMinutes(candidate: WeeklyDraftCandidate): number {
  if (Number.isFinite(candidate.durationMinutes)) {
    return candidate.durationMinutes;
  }
  return timeToMinutes(candidate.endTime) - timeToMinutes(candidate.startTime);
}

function overlapsExistingPlan(candidate: WeeklyDraftCandidate, plan: Plan): boolean {
  if (candidate.date !== plan.date) return false;
  return (
    timeToMinutes(candidate.startTime) < timeToMinutes(plan.endTime)
    && timeToMinutes(candidate.endTime) > timeToMinutes(plan.startTime)
  );
}

function persistedPlan(draft: PlanDraft, index: number): Plan {
  return {
    ...createPlanFromDraft(draft),
    id: `real-api-conversation-eval-plan-${index}`,
  };
}

function createReport(): EvaluationReport {
  return {
    generatedAt: new Date().toISOString(),
    status: 'running',
    model: process.env.VITE_AI_MODEL?.trim() || 'gpt-5.4-mini',
    baseUrl: process.env.VITE_AI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    scenario: {
      id: 'tomorrow-plan-through-approval-and-save',
      selectedDate: SELECTED_DATE,
      expectedPlanDate: EXPECTED_PLAN_DATE,
      initialUserText: '明日の予定立てたいです',
      answersByQuestionCode,
      authorizationText: AUTHORIZATION_TEXT,
      existingPlans,
    },
    turns: [],
    previewCandidates: [],
    approval: null,
    checks: {},
    failure: null,
  };
}

function writeReport(report: EvaluationReport): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    `${ARTIFACT_DIR}/report.json`,
    JSON.stringify(report, null, 2),
  );

  const checkLines = Object.entries(report.checks)
    .map(([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'}: ${name}`)
    .join('\n');
  const turnLines = report.turns
    .map((turn) => [
      `### Turn ${turn.index}`,
      '',
      `- requestId: \`${turn.requestId}\``,
      `- user: ${turn.userText}`,
      `- assistant: ${turn.assistantText}`,
      `- responseSource: ${turn.responseSource ?? 'unknown'}`,
      `- failureCode: ${turn.failureCode ?? 'none'}`,
      `- intakeStatus: ${turn.intakeStatus ?? 'none'}`,
      `- questionCode: ${turn.questionCode ?? 'none'}`,
      `- graphRevision: ${turn.graphRevision ?? 'none'}`,
      `- draftCandidateCount: ${turn.draftCandidateCount}`,
    ].join('\n'))
    .join('\n\n');

  writeFileSync(
    `${ARTIFACT_DIR}/scenario.json`,
    JSON.stringify(report.scenario, null, 2),
  );
  report.turns.forEach((turn) => {
    writeFileSync(
      `${ARTIFACT_DIR}/turn-${String(turn.index).padStart(2, '0')}.json`,
      JSON.stringify(turn, null, 2),
    );
  });
  if (report.approval) {
    writeFileSync(
      `${ARTIFACT_DIR}/approval.json`,
      JSON.stringify(report.approval, null, 2),
    );
  }
  if (report.failure) {
    writeFileSync(`${ARTIFACT_DIR}/failure.txt`, report.failure);
  }

  writeFileSync(
    `${ARTIFACT_DIR}/report.md`,
    [
      '# Weekly Planning Real API Conversation Eval',
      '',
      `Status: ${report.status}`,
      `Model: ${report.model}`,
      `Generated: ${report.generatedAt}`,
      '',
      '## Checks',
      '',
      checkLines || '- No checks recorded.',
      '',
      '## Turns',
      '',
      turnLines || 'No turns recorded.',
      '',
      '## Failure',
      '',
      report.failure ?? 'none',
      '',
    ].join('\n'),
  );
}

function noOpTraceWriter(): null {
  return null;
}

function createApplicationServices(
  capture: { latestResult: WeeklyPlanningTurnExecutionResult | null },
): WeeklyPlanningTurnApplicationServices {
  return {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    async executeTurn(input) {
      const result = await executeWeeklyPlanningTurn(input);
      capture.latestResult = result;
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

afterEach(() => {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
  resetWeeklyPlanningRuntimeModeForTest();
});

describe.skipIf(!shouldRun)(
  'Weekly Planning Stable V5 real API conversation evaluation',
  () => {
    it('runs tomorrow planning through multi-turn dialogue, preview, approval, and save', async () => {
      const report = createReport();
      const store = createStore();
      const session = createWeeklyPlanningControllerSession(
        USER_ID,
        WEEK_START_DATE,
        CONVERSATION_ID,
      );
      const capture: {
        latestResult: WeeklyPlanningTurnExecutionResult | null;
      } = { latestResult: null };
      const services = createApplicationServices(capture);
      const seenProgressStates = new Set<string>();
      let turnIndex = 0;
      let authorizationSent = false;
      let caughtError: unknown = null;

      setWeeklyPlanningRuntimeMode('stable_v5');
      resetWeeklyPlanningStableV5RuntimeSessionsForTest();
      resetWeeklyPlanningStableV5DebugTraceForTest();

      const submit = async (userText: string) => {
        turnIndex += 1;
        capture.latestResult = null;
        const requestId = requestIdFor(turnIndex);
        const submission = await submitWeeklyPlanningApplicationTurn({
          session,
          userId: USER_ID,
          ownerId: USER_ID,
          userText,
          selectedDate: SELECTED_DATE,
          plans: existingPlans,
          scheduleTemplates: [],
          weekStartsOn: 'monday',
          getState: store.getState,
          dispatch: store.dispatch,
        }, services);
        const execution = capture.latestResult;
        const state = store.getState();

        report.turns.push({
          index: turnIndex,
          requestId,
          userText,
          assistantText: state.lastAssistantMessage ?? '',
          responseSource: execution?.responseSource ?? null,
          failureCode: execution?.failure?.code ?? null,
          intakeStatus: state.intakeState?.status ?? null,
          questionCode: questionCode(state),
          graphRevision: execution?.stableV5Graph?.revision ?? null,
          draftCandidateCount: submission.draftCandidates.length,
          trace: takeWeeklyPlanningStableV5DebugTrace(requestId),
        });

        if (!submission.accepted) {
          throw new Error(`Turn ${turnIndex} was rejected by the controller.`);
        }
        if (execution?.failure) {
          throw new Error(
            `Turn ${turnIndex} failed: ${execution.failure.code} ${execution.failure.traceCode}`,
          );
        }
        return submission;
      };

      try {
        let submission = await submit(report.scenario.initialUserText);

        while (
          turnIndex < MAX_TURNS
          && submission.draftCandidates.length === 0
        ) {
          const state = store.getState();
          const code = questionCode(state);
          const signature = JSON.stringify({
            code,
            targetFactId: state.intakeState?.lastQuestionContext?.topicId ?? null,
            status: state.intakeState?.status ?? null,
          });
          if (seenProgressStates.has(signature)) {
            throw new Error(`Conversation made no progress: ${signature}`);
          }
          seenProgressStates.add(signature);

          let nextText: string;
          if (code) {
            nextText = answersByQuestionCode[code];
            if (!nextText) {
              throw new Error(`No fixed eval answer for question code: ${code}`);
            }
          } else if (!authorizationSent) {
            nextText = AUTHORIZATION_TEXT;
            authorizationSent = true;
          } else {
            throw new Error(
              `No machine question and authorization was already sent: ${signature}`,
            );
          }
          submission = await submit(nextText);
        }

        if (submission.draftCandidates.length === 0) {
          throw new Error(`Preview was not created within ${MAX_TURNS} turns.`);
        }

        const previewCandidates = [...submission.draftCandidates];
        report.previewCandidates = previewCandidates;
        expect(previewCandidates.length).toBeGreaterThan(0);
        expect(turnIndex).toBeGreaterThanOrEqual(2);
        expect(turnIndex).toBeLessThanOrEqual(MAX_TURNS);
        expect(
          report.turns.every((turn) => turn.failureCode === null),
        ).toBe(true);
        expect(
          report.turns.every(
            (turn) => !turn.assistantText.includes('構造化処理に失敗しました'),
          ),
        ).toBe(true);
        expect(
          previewCandidates.every((candidate) => candidate.date === EXPECTED_PLAN_DATE),
        ).toBe(true);
        expect(
          previewCandidates.reduce(
            (total, candidate) => total + candidateMinutes(candidate),
            0,
          ),
        ).toBe(EXPECTED_TOTAL_MINUTES);
        expect(
          previewCandidates.some((candidate) =>
            existingPlans.some((plan) => overlapsExistingPlan(candidate, plan))),
        ).toBe(false);

        const promotedBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
          candidates: previewCandidates,
          userId: USER_ID,
          createdAt: '2026-08-03T00:00:00.000Z',
        });
        store.dispatch({ type: 'add_draft_blocks', blocks: promotedBlocks });

        const savedDrafts: PlanDraft[] = [];
        const savedPlans: Plan[] = [];
        const completedOperations: WeeklyDraftApprovalOperation[] = [];
        const ledgerOperations: WeeklyDraftApprovalOperation[] = [];

        const approve = () => approveWeeklyPlanningDraftBlocks({
          userId: USER_ID,
          plans: [...existingPlans, ...savedPlans],
          approvalOperations: ledgerOperations,
          async saveWeeklyApprovedPlan(draft) {
            savedDrafts.push(draft);
            const plan = persistedPlan(draft, savedDrafts.length);
            savedPlans.push(plan);
            return plan;
          },
          async completeWeeklyApprovalOperation(operation) {
            completedOperations.push(operation);
          },
          getState: store.getState,
          dispatch: store.dispatch,
          onOperationCompleted(operation) {
            ledgerOperations.push(operation);
          },
        });

        await approve();
        const savedCountAfterFirstApproval = savedPlans.length;
        await approve();

        report.approval = {
          promotedBlockCount: promotedBlocks.length,
          savedPlanCount: savedPlans.length,
          completedOperationCount: completedOperations.length,
          duplicateApprovalAddedPlans:
            savedPlans.length - savedCountAfterFirstApproval,
          savedPlans,
        };

        expect(savedDrafts).toHaveLength(promotedBlocks.length);
        expect(savedPlans).toHaveLength(promotedBlocks.length);
        expect(completedOperations).toHaveLength(1);
        expect(savedPlans.length - savedCountAfterFirstApproval).toBe(0);
        expect(store.getState().pendingApproval).toBeUndefined();
        expect(store.getState().draftBlocks).toEqual([]);
        expect(store.getState().mode).toBe('idle');
        expect(store.getState().lastAssistantMessage).toBe(
          `${promotedBlocks.length}件の仮予定を通常予定として保存しました。`,
        );
        savedDrafts.forEach((draft, index) => {
          expect(draft.sourceType).toBe('weekly-planning');
          expect(parseWeeklyPlanningPlanSourceId(draft.sourceId)).toEqual({
            approvalOperationId: completedOperations[0]?.approvalOperationId,
            sourceDraftBlockId: promotedBlocks[index]?.id,
          });
        });

        report.checks = {
          multiTurnConversation: turnIndex >= 2,
          noSemanticFailure: report.turns.every((turn) => turn.failureCode === null),
          traceCaptured: report.turns.every((turn) => turn.trace.length > 0),
          tomorrowResolved: previewCandidates.every(
            (candidate) => candidate.date === EXPECTED_PLAN_DATE,
          ),
          totalWorkloadPreserved:
            previewCandidates.reduce(
              (total, candidate) => total + candidateMinutes(candidate),
              0,
            ) === EXPECTED_TOTAL_MINUTES,
          existingPlanConflictAvoided: !previewCandidates.some((candidate) =>
            existingPlans.some((plan) => overlapsExistingPlan(candidate, plan))),
          previewPromoted:
            promotedBlocks.length === previewCandidates.length,
          plansPersisted: savedPlans.length === promotedBlocks.length,
          provenancePreserved: savedDrafts.every(
            (draft) => draft.sourceType === 'weekly-planning'
              && Boolean(parseWeeklyPlanningPlanSourceId(draft.sourceId)),
          ),
          duplicateApprovalSuppressed:
            savedPlans.length === savedCountAfterFirstApproval,
          completionStateClean:
            store.getState().pendingApproval === undefined
            && store.getState().draftBlocks.length === 0
            && store.getState().mode === 'idle',
        };
        expect(Object.values(report.checks).every(Boolean)).toBe(true);
        report.status = 'passed';
      } catch (error) {
        caughtError = error;
        report.status = 'failed';
        report.failure = error instanceof Error
          ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
          : String(error);
      } finally {
        writeReport(report);
        console.info(
          '[weekly-planning-real-api-conversation-eval]',
          JSON.stringify({
            status: report.status,
            model: report.model,
            turnCount: report.turns.length,
            previewCount: report.previewCandidates.length,
            savedPlanCount: report.approval?.savedPlanCount ?? 0,
            failure: report.failure,
          }, null, 2),
        );
      }

      if (caughtError) throw caughtError;
    }, 20 * 60 * 1000);
  },
);
