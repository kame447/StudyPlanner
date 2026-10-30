import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { getAiConfig } from '../../../lib/aiConfig';
import { createOpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  resetUserPlanningContextRuntimeForTestV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  getWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningTurnRuntimeGateway } from '../application/weeklyPlanningTurnRuntimeGateway';
import { weeklyPlanningTurnStagingLifecycle } from '../application/weeklyPlanningTurnSideEffects';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from '../application/weeklyPlanningTurnApplication';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
import type { WeeklyPlanningTurnFailure } from '../weeklyPlanningTurnExecutionTypes';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from '../semantic/weeklyPlanningPlacementGraphViewV5';
import {
  compileGenericSchedulerInput,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  scheduleWeeklyPlanningStableV5Preview,
} from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  readWeeklyPlanningVNextExperimentalSession,
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
  type WeeklyPlanningVNextExperimentalTurn,
} from '../vnext/application/weeklyPlanningVNextExperimentalSession';
import { projectWeeklyPlanningVNext } from '../vnext/projection/weeklyPlanningVNextProjection';
import { createWeeklyPlanningVNextProviderInterpreter } from '../vnext/semantic/weeklyPlanningVNextProvider';
import type {
  RealApiConversation,
  RealApiConversationTurn,
  RealApiWorkRole,
  RealApiWorkUnit,
  RealApiTurnOracle,
  RealApiWorkloadOracle,
} from './vnextRealApiConversations';
import { vnextRealApiConversations } from './vnextRealApiConversations';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR ?? 'artifacts/issue156-real-api';
const artifactDir = `${outputDir}/vnext-comparison`;
const weekStartDate = '2026-11-02';
function clockFor(conversation: RealApiConversation) {
  return conversation.clock ?? { currentDate: weekStartDate, weekStartDate, planningEndDate: '2026-11-08' };
}
function contextFor(conversation: RealApiConversation) {
  const clock = clockFor(conversation);
  return { currentDate: clock.currentDate, planningStartDate: clock.weekStartDate,
    planningEndDate: clock.planningEndDate, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' as const };
}

interface ObservedWorkload {
  factId: string;
  taskId: string;
  role: RealApiWorkRole;
  amount: number;
  unitCode: RealApiWorkUnit;
  unitLabel: string;
  perOccurrence: boolean;
  periodExpression: string | null;
}

interface ObservedEffort {
  factId: string;
  taskId: string;
  kind: string;
  minutes: number;
  unitCode: string | null;
  unitLabel: string | null;
  forRole: RealApiWorkRole | 'task';
  bindingKind?: string | null;
}

interface ObservedTemporal {
  taskId: string;
  kind: string;
  dateExpression: string | null;
  constraintLevel: string;
  startTime: string | null;
  endTime: string | null;
}

interface ObservedFacts {
  taskIds: string[];
  workloads: ObservedWorkload[];
  efforts: ObservedEffort[];
  temporal: ObservedTemporal[];
}

interface V5TurnObservation {
  turn: number;
  status: 'pass' | 'fail' | 'not_reached' | 'out_of_scope';
  userText: string;
  inVNextScope: boolean;
  accepted: boolean | null;
  error: string | null;
  failureDetail?: {
    failure: WeeklyPlanningTurnFailure | null;
    candidateCommitRejectionReason: WeeklyPlanningTurnExecutionResult['candidateCommitRejectionReason'] | null;
    responseSource: WeeklyPlanningTurnExecutionResult['responseSource'] | null;
    debugTraceEvents: unknown[];
  };
  questionCode: string | null;
  taskIds: string[];
  workloads: ObservedWorkload[];
  efforts: ObservedEffort[];
  temporal: Array<{ taskId: string; kind: string; dateExpression: string | null; constraintLevel: string; startTime: string | null; endTime: string | null }>;
  schedulerStatus: string | null;
  workMinutes: number | null;
  previewMinutes: number | null;
  aiCalls: number;
  rendererCalls: number;
  latencyMs: number | null;
  clarificationCount: number;
  wrongAcceptance: boolean;
  wrongRejection: boolean;
  repeatedQuestionCount: number;
  oracleDifferences: string[];
}

interface VNextTurnObservation extends V5TurnObservation {
  outcome: string;
  repairs: number;
  interpretation: WeeklyPlanningVNextExperimentalTurn['interpretation'];
  transactionErrors: WeeklyPlanningVNextExperimentalTurn['errors'];
  appliedDelta: WeeklyPlanningVNextExperimentalTurn['appliedDelta'];
  previewBlockedBy: string[];
}

interface ConversationObservation {
  id: string;
  source: string;
  description: string;
  turns: V5TurnObservation[];
  error: string | null;
}

interface VNextConversationObservation extends Omit<ConversationObservation, 'turns'> {
  turns: VNextTurnObservation[];
}

function createStore(initialState: PlanningState) {
  let state = structuredClone(initialState);
  return {
    getState: () => state,
    dispatch(action: WeeklyPlanningAction): PlanningState {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function currentFactId(graph: WeeklyPlanningFactGraphV5, factId: string): string {
  let current = factId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const next = graph.factLifecycles.find((entry) => entry.factId === current)?.supersededByFactId;
    if (!next) break;
    current = next;
  }
  return current;
}

function activeIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
}

function questionCode(questionContext: unknown): string | null {
  if (typeof questionContext !== 'object' || questionContext === null) return null;
  const targetSlot = (questionContext as Record<string, unknown>).targetSlot;
  if (typeof targetSlot !== 'string') return null;
  return targetSlot.startsWith('stable_v5:') ? targetSlot.slice('stable_v5:'.length) : targetSlot;
}

function observedFacts(graph: WeeklyPlanningFactGraphV5): ObservedFacts {
  const active = activeIds(graph);
  const taskIds = graph.tasks.filter((fact) => active.has(fact.id)).map((fact) => fact.id);
  const workloads = graph.workloads.filter((fact) => active.has(fact.id)).map((fact) => ({
    factId: fact.id, taskId: fact.taskId, role: fact.quantityRole, amount: fact.amount,
    unitCode: fact.unitCode, unitLabel: fact.unitLabel, perOccurrence: fact.perOccurrence,
    periodExpression: fact.periodExpression,
  }));
  const workloadById = new Map(workloads.map((fact) => [fact.factId, fact]));
  const efforts = graph.effortEstimates.filter((fact) => active.has(fact.id)).map((fact) => {
    const targetId = currentFactId(graph, fact.targetFactId);
    const extension = fact as typeof fact & { unitLabel?: string | null; workBinding?: { kind: string } | null };
    const binding = extension.workBinding;
    const forRole: RealApiWorkRole | 'task' = workloadById.get(targetId)?.role
      ?? (binding?.kind === 'observed_pace' ? 'completed'
        : binding?.kind === 'future_work' ? 'remaining' : 'task');
    return {
      factId: fact.id, taskId: fact.taskId, kind: fact.kind, minutes: fact.minutes,
      unitCode: fact.unitCode, unitLabel: extension.unitLabel ?? null,
      forRole,
      bindingKind: binding?.kind ?? null,
    };
  });
  const temporal = graph.temporalConstraints.filter((fact) => active.has(fact.id)).map((fact) => ({
    taskId: fact.taskId, kind: fact.kind, dateExpression: fact.dateExpression,
    constraintLevel: fact.constraintLevel, startTime: fact.startTime, endTime: fact.endTime,
  }));
  return { taskIds, workloads, efforts, temporal };
}

function previewMinutes(graph: WeeklyPlanningFactGraphV5, conversation: RealApiConversation): { status: string; minutes: number | null; workMinutes: number | null } {
  const clock = clockFor(conversation);
  const placementGraph = createWeeklyPlanningPlacementGraphViewV5(graph);
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const compiled = compileGenericSchedulerInput({ graph: activeGraph, context: { ownerId: 'vnext-real-api', ...contextFor(conversation) } });
  if (compiled.status !== 'ready' || !compiled.input) return { status: compiled.status, minutes: null, workMinutes: null };
  const preview = scheduleWeeklyPlanningStableV5Preview({
    input: compiled.input,
    graph: placementGraph,
    notBefore: { date: clock.currentDate, time: '09:00' },
  });
  if (preview.status !== 'ready') return { status: preview.status, minutes: null, workMinutes: null };
  const estimates = compiled.input.movableWorkItems.map((item) => item.baseEstimatedMinutes);
  const workMinutes = estimates.length > 0 && estimates.every((minutes) => typeof minutes === 'number')
    ? estimates.reduce((sum, minutes) => sum + (minutes ?? 0), 0) : null;
  return { status: preview.status, minutes: preview.candidates.reduce((sum, candidate) => sum + candidate.durationMinutes, 0), workMinutes };
}

function sameUnitIdentity(
  actual: { unitCode: string | null; unitLabel: string | null },
  expected: { unitCode: string | null; unitLabel: string | null },
  expectedTask?: string,
): boolean {
  if (actual.unitCode === expected.unitCode) {
    if (expected.unitCode === 'custom') return actual.unitLabel === expected.unitLabel;
    return actual.unitLabel === null || actual.unitLabel === '' || actual.unitLabel === actual.unitCode
      || expected.unitLabel === null || expected.unitLabel === actual.unitLabel;
  }
  // These corpus cases have equivalent closed and custom encodings. The task
  // and stated label constrain each alias; unrelated custom-unit changes fail.
  const aliases: Record<string, Record<string, string[]>> = {
    vocabulary: { 'custom:個': ['word:word', 'word:単語', 'word:個'] },
    math: { 'custom:問': ['problem:problem', 'problem:問題', 'problem:問'] },
    questions: { 'custom:問': ['problem:problem', 'problem:問題', 'problem:問'] },
    slides: { 'custom:枚': ['page:page', 'page:ページ', 'page:枚'] },
  };
  const expectedKey = `${expected.unitCode}:${expected.unitLabel ?? ''}`;
  return expectedTask !== undefined && (aliases[expectedTask]?.[expectedKey] ?? []).includes(`${actual.unitCode}:${actual.unitLabel ?? ''}`);
}

function effortUnitMatchesWork(fact: ObservedEffort, work: ObservedWorkload, task: string): boolean {
  if (fact.unitCode !== work.unitCode) return false;
  if (fact.unitLabel === null || fact.unitLabel === '') return true;
  return sameUnitIdentity(fact, work, task);
}

function matchWorkloads(actual: readonly ObservedWorkload[], expected: readonly RealApiWorkloadOracle[]): { matched: boolean; pairs: Array<[RealApiWorkloadOracle, ObservedWorkload | null]> } {
  const remaining = [...actual];
  const pairs: Array<[RealApiWorkloadOracle, ObservedWorkload | null]> = [];
  for (const wanted of expected) {
    const index = remaining.findIndex((fact) => fact.role === wanted.role && fact.amount === wanted.amount
      && sameUnitIdentity(fact, wanted, wanted.task)
      && (wanted.perOccurrence === undefined || fact.perOccurrence === wanted.perOccurrence)
      && (wanted.periodExpression === undefined || fact.periodExpression === wanted.periodExpression));
    if (index < 0) {
      pairs.push([wanted, null]);
      continue;
    }
    pairs.push([wanted, remaining[index]]);
    remaining.splice(index, 1);
  }
  return { matched: pairs.length === expected.length && remaining.length === 0, pairs };
}

function compareTypedOracle(observed: ReturnType<typeof observedFacts>, question: string | null, workMinutes: number | null,
  oracle: RealApiTurnOracle, projectedWorkloads: readonly ObservedWorkload[] = []): string[] {
  if (!oracle.inVNextScope) return [];
  const differences: string[] = [];
  const workloads = matchWorkloads(observed.workloads, oracle.workloads);
  if (!workloads.matched) differences.push('workloads differ');
  if (oracle.expectedTaskCount !== undefined && observed.taskIds.length !== oracle.expectedTaskCount) {
    differences.push(`task count expected=${oracle.expectedTaskCount} observed=${observed.taskIds.length}`);
  }
  if (oracle.projectedWorkloads && !matchWorkloads(projectedWorkloads, oracle.projectedWorkloads).matched) {
    differences.push('projected workloads differ');
  }
  for (const [leftIndex, rightIndex] of oracle.distinctWorkloadPairs ?? []) {
    const left = workloads.pairs[leftIndex]?.[1];
    const right = workloads.pairs[rightIndex]?.[1];
    if (!left || !right || left.taskId === right.taskId) differences.push(`work owner identity not distinct at ${leftIndex}/${rightIndex}`);
  }
  for (const [leftIndex, rightIndex] of oracle.sameWorkloadPairs ?? []) {
    const left = workloads.pairs[leftIndex]?.[1];
    const right = workloads.pairs[rightIndex]?.[1];
    if (!left || !right || left.taskId !== right.taskId) differences.push(`work owner identity differs at ${leftIndex}/${rightIndex}`);
  }
  if (question !== oracle.questionCode) differences.push(`question expected=${oracle.questionCode ?? 'none'} observed=${question ?? 'none'}`);
  if (workMinutes !== oracle.projectedMinutes) differences.push(`work minutes expected=${oracle.projectedMinutes ?? 'none'} observed=${workMinutes ?? 'none'}`);
  for (const wanted of oracle.efforts) {
    const expectedWork = workloads.pairs.find(([expected]) => expected.task === wanted.task && expected.role === wanted.forRole)?.[0]
      ?? oracle.projectedWorkloads?.find((work) => work.task === wanted.task && work.role === wanted.forRole);
    const projectedBoundWork = expectedWork && projectedWorkloads.find((fact) => fact.role === wanted.forRole
      && fact.amount === expectedWork.amount && sameUnitIdentity(fact, expectedWork, wanted.task));
    const boundWork = (expectedWork && workloads.pairs.find(([expected]) => expected.task === wanted.task)?.[1])
      ?? projectedBoundWork;
    const found = observed.efforts.some((fact) => {
      if (fact.kind !== wanted.kind || fact.minutes !== wanted.minutes || !boundWork || fact.taskId !== boundWork.taskId) return false;
      const sameSpecificRole = fact.forRole === wanted.forRole;
      const sameTaskBinding = fact.forRole === 'task'
        && observed.workloads.filter((work) => work.taskId === boundWork.taskId && ['remaining', 'target', 'declared'].includes(work.role)).length === 1;
      const sameProjectedWorkBinding = projectedBoundWork?.taskId === fact.taskId
        && (fact.forRole === 'scope_total' || fact.bindingKind === 'future_work');
      if (!sameSpecificRole && !sameTaskBinding && !sameProjectedWorkBinding) return false;
      if (wanted.kind === 'duration_per_unit') {
        return effortUnitMatchesWork(fact, boundWork, wanted.task) && sameUnitIdentity(boundWork, wanted, wanted.task);
      }
      // V5 stores total/session estimates in minutes; null in this oracle means
      // “not per workload unit”, not “the stored unit code must be null”.
      return fact.unitCode === null || fact.unitCode === 'minute';
    });
    if (!found) differences.push(`effort missing ${wanted.kind}/${wanted.minutes}/${wanted.forRole}`);
  }
  if (oracle.checkTemporal !== false) {
    if (observed.temporal.length !== oracle.temporal.length) differences.push('temporal fact count differs');
    for (const wanted of oracle.temporal) {
      if (!observed.temporal.some((fact) => observed.taskIds.includes(fact.taskId)
        && fact.kind === wanted.kind && fact.dateExpression === wanted.dateExpression
        && (wanted.level === undefined || fact.constraintLevel === wanted.level)
        && (wanted.time === undefined || fact.startTime === wanted.time || fact.endTime === wanted.time))) {
        differences.push(`temporal missing ${wanted.kind}/${wanted.dateExpression}`);
      }
    }
  }
  return differences;
}

async function runV5Conversation(conversation: RealApiConversation): Promise<ConversationObservation> {
  const ownerId = `vnext-real-api-${conversation.id}`;
  const conversationId = ownerId;
  const clock = clockFor(conversation);
  const sessionWeekStart = clock.weekStartDate;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
  resetUserPlanningContextRuntimeForTestV1();
  bindWeeklyPlanningStableV5RuntimeSessionScope({ ownerId, weekStartDate: sessionWeekStart, conversationId });

  const store = createStore(createInitialPlanningState(sessionWeekStart));
  const session = createWeeklyPlanningControllerSession(ownerId, sessionWeekStart, conversationId);
  let capturedResult: WeeklyPlanningTurnExecutionResult | null = null;
  let capturedRequestId: string | null = null;
  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      async execute(params) {
        capturedRequestId = params.pending.requestId;
        capturedResult = await weeklyPlanningTurnRuntimeGateway.execute(params);
        return capturedResult;
      },
    },
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
    outcomeLifecycle: { committed: () => undefined, discarded: () => undefined, failed: () => undefined },
  };
  const turns: V5TurnObservation[] = [];
  let previousQuestionSignature: string | null = null;
  let clarificationCount = 0;
  let repeatedQuestionCount = 0;

  for (let index = 0; index < conversation.turns.length; index += 1) {
    const fixtureTurn: RealApiConversationTurn = conversation.turns[index];
    capturedResult = null;
    capturedRequestId = null;
    const startedAt = performance.now();
    let accepted: boolean | null = null;
    let error: string | null = null;
    try {
      const submission = await submitWeeklyPlanningApplicationTurn({
        session, userId: ownerId, ownerId,
        plannerDataAvailability: createReadyPlannerDataAvailability(ownerId),
        userText: fixtureTurn.userText,
        selectedDate: clock.currentDate,
        plans: [], scheduleTemplates: [], weekStartsOn: 'monday',
        getState: store.getState, dispatch: store.dispatch,
      }, services);
      accepted = submission.accepted;
      if (!submission.accepted) error = 'turn not accepted';
      if (capturedResult === null) throw new Error('runtime result missing');
      const result: WeeklyPlanningTurnExecutionResult = capturedResult;
      if (result.failure) error = `${result.failure.code}:${result.failure.traceCode}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const requestId = capturedRequestId;
    const debugTrace = requestId ? takeWeeklyPlanningStableV5DebugTrace(requestId) : [];
    const resultForDiagnostics = capturedResult as WeeklyPlanningTurnExecutionResult | null;
    const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
    const graph = runtime?.graph;
    const facts: ObservedFacts = graph ? observedFacts(graph) : { taskIds: [], workloads: [], efforts: [], temporal: [] };
    const currentQuestion = questionCode(store.getState().intakeState?.lastQuestionContext ?? null);
    if (fixtureTurn.oracle.inVNextScope && currentQuestion !== null) clarificationCount += 1;
    const questionSignature = currentQuestion === null ? null : JSON.stringify({ question: currentQuestion, workloads: facts.workloads });
    if (questionSignature !== null && questionSignature === previousQuestionSignature && !fixtureTurn.oracle.preservePreviousTypedState) repeatedQuestionCount += 1;
    const preview = graph ? previewMinutes(graph, conversation) : { status: 'no_graph', minutes: null, workMinutes: null };
    const oracleDifferences = error ? [error] : graph ? compareTypedOracle(facts, currentQuestion, preview.workMinutes, fixtureTurn.oracle) : ['typed state unavailable'];
    const expectedClarification = fixtureTurn.oracle.questionCode !== null;
    const wrongAcceptance = fixtureTurn.oracle.inVNextScope && expectedClarification && currentQuestion === null;
    const wrongRejection = fixtureTurn.oracle.inVNextScope && !expectedClarification && currentQuestion !== null;
    turns.push({
      turn: index + 1, userText: fixtureTurn.userText, inVNextScope: fixtureTurn.oracle.inVNextScope,
      status: !fixtureTurn.oracle.inVNextScope ? 'out_of_scope' : error || oracleDifferences.length > 0 ? 'fail' : 'pass',
      accepted, error,
      failureDetail: {
        failure: resultForDiagnostics?.failure ?? null,
        candidateCommitRejectionReason: resultForDiagnostics?.candidateCommitRejectionReason ?? null,
        responseSource: resultForDiagnostics?.responseSource ?? null,
        debugTraceEvents: error || resultForDiagnostics?.failure ? debugTrace : [],
      },
      questionCode: currentQuestion,
      ...facts, schedulerStatus: preview.status, workMinutes: preview.workMinutes, previewMinutes: preview.minutes,
      aiCalls: debugTrace.filter((event) => event.stage === 'semantic_provider_request').length,
      rendererCalls: debugTrace.filter((event) => event.stage === 'dialogue_renderer_request').length,
      latencyMs, clarificationCount, wrongAcceptance, wrongRejection, repeatedQuestionCount,
      oracleDifferences,
    });
    previousQuestionSignature = questionSignature;
  }
  return { id: conversation.id, source: conversation.source, description: conversation.description, turns, error: null };
}

function vnextPreviewMinutes(blocks: readonly { startTime: string; endTime: string }[] | null): number | null {
  if (!blocks) return null;
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return blocks.reduce((sum, block) => sum + toMinutes(block.endTime) - toMinutes(block.startTime), 0);
}

function vnextProjectedWorkMinutes(owners: ReturnType<typeof projectWeeklyPlanningVNext>['owners']): number | null {
  const work = owners.flatMap((owner) => owner.work);
  return work.length > 0 && work.every((item) => typeof item.minutes === 'number')
    ? work.reduce((sum, item) => sum + (item.minutes ?? 0), 0) : null;
}

async function runVNextConversation(conversation: RealApiConversation): Promise<VNextConversationObservation> {
  const ownerId = `vnext-real-api-${conversation.id}`;
  const clock = clockFor(conversation);
  const scope: WeeklyPlanningVNextExperimentalScope = {
    ownerId,
    weekStartDate: clock.weekStartDate,
    conversationId: ownerId,
    clock: {
      currentDate: clock.currentDate,
      planningStartDate: clock.weekStartDate,
      planningEndDate: clock.planningEndDate,
      timeZone: 'Asia/Tokyo',
    },
    notBeforeTime: '09:00',
  };
  const slots = new Map<string, string>();
  const slot = (key: string) => ({
    read: () => slots.get(key) ?? null,
    write: (raw: string) => { slots.set(key, raw); },
  });
  const plans = new Map<string, string>();
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client: createOpenAiCompatibleClient(getAiConfig()),
    interpret: createWeeklyPlanningVNextProviderInterpreter(),
    checkpoint: slot('vnext'),
    legacyV5Checkpoint: { read: () => null },
    approvalLedger: slot('ledger'),
    plans: {
      async findExistingPlanId(sourceDraftBlockId) { return plans.get(sourceDraftBlockId); },
      async saveBlock(block) {
        const planId = `plan:${block.id}`;
        plans.set(block.id, planId);
        return { planId };
      },
    },
    now: () => `${clock.currentDate}T09:00:00.000Z`,
  };
  const turns: VNextTurnObservation[] = [];
  let previousQuestionSignature: string | null = null;
  let clarificationCount = 0;
  let repeatedQuestionCount = 0;

  for (let index = 0; index < conversation.turns.length; index += 1) {
    const fixtureTurn = conversation.turns[index];
    const startedAt = performance.now();
    let error: string | null = null;
    let outcome = 'not_reached';
    let calls = 0;
    let repairs = 0;
    let latencyMs: number | null = null;
    let question: string | null = null;
    let facts: ObservedFacts = { taskIds: [], workloads: [], efforts: [], temporal: [] };
    let readiness: string | null = null;
    let minutes: number | null = null;
    let workMinutes: number | null = null;
    let interpretation: WeeklyPlanningVNextExperimentalTurn['interpretation'] = null;
    let transactionErrors: WeeklyPlanningVNextExperimentalTurn['errors'] = [];
    let appliedDelta: WeeklyPlanningVNextExperimentalTurn['appliedDelta'] = null;
    let previewBlockedBy: string[] = [];
    try {
      const result = await submitWeeklyPlanningVNextExperimentalTurn({
        scope, ports, turnId: `turn-${index + 1}`, userText: fixtureTurn.userText,
      });
      outcome = result.outcome;
      interpretation = result.interpretation;
      transactionErrors = result.errors;
      appliedDelta = result.appliedDelta;
      previewBlockedBy = result.previewBlockedBy;
      calls = result.interpretation?.metrics.calls ?? 0;
      repairs = result.interpretation?.metrics.repairs ?? 0;
      latencyMs = result.interpretation?.metrics.latencyMs ?? Math.round(performance.now() - startedAt);
      if (result.outcome === 'interpretation_failed' || result.outcome === 'checkpoint_unreadable' || result.outcome === 'rejected') {
        error = `${result.outcome}:${result.interpretation?.status === 'failed' ? result.interpretation.reason : result.errors.map(({ code }) => code).join(',') || 'session'}`;
      }
      const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
      if (read.status !== 'ready') throw new Error('VNext session unreadable after turn');
      const state = read.checkpoint.state;
      const projection = projectWeeklyPlanningVNext(state);
      const observed = observedFacts(state.graph);
      facts = observed;
      question = projection.questions[0]?.code ?? null;
      readiness = projection.readiness;
      minutes = vnextPreviewMinutes(result.preview?.blocks ?? null);
      workMinutes = vnextProjectedWorkMinutes(projection.owners);
      const projectedWorkloads: ObservedWorkload[] = projection.owners.flatMap((owner) => owner.work.map((work) => ({
        factId: work.definingFactId,
        taskId: work.taskId,
        role: work.quantityRole,
        amount: work.amount,
        unitCode: work.unitCode,
        unitLabel: work.unitLabel,
        perOccurrence: work.perOccurrence,
        periodExpression: work.periodExpression,
      })));
      const differences = error ? [error] : compareTypedOracle(facts, question, workMinutes, fixtureTurn.oracle, projectedWorkloads);
      const expectedClarification = fixtureTurn.oracle.questionCode !== null;
      const wrongAcceptance = fixtureTurn.oracle.inVNextScope && expectedClarification && question === null;
      const wrongRejection = fixtureTurn.oracle.inVNextScope && !expectedClarification && question !== null;
      const signature = question === null ? null : JSON.stringify({ question, workloads: facts.workloads });
      if (fixtureTurn.oracle.inVNextScope && question !== null) clarificationCount += 1;
      if (signature !== null && signature === previousQuestionSignature && !fixtureTurn.oracle.preservePreviousTypedState) repeatedQuestionCount += 1;
      turns.push({
        turn: index + 1,
        status: !fixtureTurn.oracle.inVNextScope ? 'out_of_scope' : error || differences.length > 0 ? 'fail' : 'pass',
        userText: fixtureTurn.userText,
        inVNextScope: fixtureTurn.oracle.inVNextScope,
        accepted: error === null && ['applied', 'noop', 'duplicate'].includes(outcome),
        error,
        questionCode: question,
        ...facts,
        schedulerStatus: readiness,
        workMinutes,
        previewMinutes: minutes,
        aiCalls: calls,
        rendererCalls: 0,
        latencyMs,
        clarificationCount,
        wrongAcceptance,
        wrongRejection,
        repeatedQuestionCount,
        oracleDifferences: differences,
        outcome,
        repairs,
        interpretation,
        transactionErrors,
        appliedDelta,
        previewBlockedBy,
      } as VNextTurnObservation);
      previousQuestionSignature = signature;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      latencyMs = Math.round(performance.now() - startedAt);
      turns.push({
        turn: index + 1,
        status: !fixtureTurn.oracle.inVNextScope ? 'out_of_scope' : 'fail',
        userText: fixtureTurn.userText,
        inVNextScope: fixtureTurn.oracle.inVNextScope,
        accepted: false,
        error,
        questionCode: question,
        ...facts,
        schedulerStatus: readiness,
        workMinutes,
        previewMinutes: minutes,
        aiCalls: calls,
        rendererCalls: 0,
        latencyMs,
        clarificationCount,
        wrongAcceptance: false,
        wrongRejection: false,
        repeatedQuestionCount,
        oracleDifferences: [error],
        outcome,
        repairs,
        interpretation,
        transactionErrors,
        appliedDelta,
        previewBlockedBy,
      } as VNextTurnObservation);
    }
  }
  return { id: conversation.id, source: conversation.source, description: conversation.description, turns, error: null };
}

function summarize(observations: readonly ConversationObservation[]) {
  const turns = observations.flatMap((conversation) => conversation.turns);
  const inScope = turns.filter((turn) => turn.inVNextScope);
  return {
    conversations: observations.length,
    erroredConversations: observations.filter((conversation) => conversation.error !== null).length,
    inScopeTurns: inScope.length,
    passedOracle: inScope.filter((turn) => turn.status === 'pass').length,
    failedOracle: inScope.filter((turn) => turn.status === 'fail').length,
    notReached: turns.filter((turn) => turn.status === 'not_reached').length,
    wrongAcceptance: inScope.filter((turn) => turn.wrongAcceptance).length,
    wrongRejection: inScope.filter((turn) => turn.wrongRejection).length,
    outOfScopeTurns: turns.length - inScope.length,
    aiCalls: turns.reduce((sum, turn) => sum + turn.aiCalls, 0),
    rendererCalls: turns.reduce((sum, turn) => sum + turn.rendererCalls, 0),
    totalLatencyMs: turns.reduce((sum, turn) => sum + (turn.latencyMs ?? 0), 0),
    clarificationPrompts: observations.reduce((sum, conversation) =>
      sum + (conversation.turns[conversation.turns.length - 1]?.clarificationCount ?? 0), 0),
    repeatedQuestions: observations.reduce((sum, conversation) =>
      sum + (conversation.turns[conversation.turns.length - 1]?.repeatedQuestionCount ?? 0), 0),
    finalPreviewMinutes: observations.map((conversation) => ({ id: conversation.id, minutes: conversation.turns[conversation.turns.length - 1]?.previewMinutes ?? null })),
  };
}

const runRealApi = shouldRun ? describe : describe.skip;

describe('VNext real API conversation fixture contract (offline)', () => {
  it('contains only synthetic turns and typed per-turn oracles', () => {
    expect(vnextRealApiConversations).toHaveLength(14);
    expect(new Set(vnextRealApiConversations.map(({ id }) => id)).size).toBe(vnextRealApiConversations.length);
    for (const conversation of vnextRealApiConversations) {
      expect(conversation.turns.length, conversation.id).toBeGreaterThan(0);
      for (const turn of conversation.turns) {
        expect(turn.userText.length, conversation.id).toBeGreaterThan(0);
        expect(Array.isArray(turn.oracle.workloads), conversation.id).toBe(true);
        expect(Array.isArray(turn.oracle.efforts), conversation.id).toBe(true);
        if (!turn.oracle.inVNextScope) expect(turn.oracle.outOfScopeReason, conversation.id).toBeTruthy();
      }
    }
    const deadlineCase = vnextRealApiConversations.find(({ id }) => id === 'issue881-final-b-deadline-at-13');
    expect(deadlineCase?.turns.map(({ userText }) => userText)).toEqual([
      '明日の予定を立てたいです',
      '研究室のレポートを仕上げたいです',
      '締切は明日の13時です',
      '完成を100%とすると、今は50%くらいです',
      '残りは1時間半くらいです',
    ]);
    expect(deadlineCase?.turns[2].oracle.temporal).toEqual([
      { task: 'report', kind: 'deadline', dateExpression: '2026-08-27', time: '13:00', level: 'hard' },
    ]);
    const progressCase = vnextRealApiConversations.find(({ id }) => id === 'issue881-final-c-corrected-completion');
    expect(progressCase?.turns[2].oracle.projectedWorkloads).toEqual([
      { task: 'slides', role: 'remaining', amount: 8, unitCode: 'custom', unitLabel: '枚' },
    ]);
    const yesterdayCase = vnextRealApiConversations.find(({ id }) => id === 'yesterday-math-completed-30-minutes');
    expect(yesterdayCase?.clock?.currentDate).toBe('2026-10-30');
    expect(yesterdayCase?.turns[0].userText).toBe('昨日は数学を30分勉強しました。');
    expect(yesterdayCase?.turns[0].oracle).toMatchObject({
      inVNextScope: true,
      questionCode: null,
      workloads: [{ task: 'math', role: 'completed', amount: 30, unitCode: 'minute', unitLabel: '分' }],
      temporal: [],
    });
  });

  it('compares equivalent unit encodings while rejecting a changed custom unit', () => {
    expect(sameUnitIdentity(
      { unitCode: 'word', unitLabel: 'word' },
      { unitCode: 'custom', unitLabel: '個' },
      'vocabulary',
    )).toBe(true);
    expect(effortUnitMatchesWork(
      { unitCode: 'custom', unitLabel: null } as ObservedEffort,
      { unitCode: 'custom', unitLabel: 'セット' } as ObservedWorkload,
      'cards',
    )).toBe(true);
    expect(sameUnitIdentity(
      { unitCode: 'custom', unitLabel: '枚' },
      { unitCode: 'custom', unitLabel: 'セット' },
      'cards',
    )).toBe(false);
  });
});

runRealApi('Issue #926 V5 / VNext native real-provider comparison', () => {
  const observations: ConversationObservation[] = [];
  const vnextObservations: VNextConversationObservation[] = [];
  afterAll(() => {
    mkdirSync(artifactDir, { recursive: true });
    const v5Summary = summarize(observations);
    const vnextSummary = summarize(vnextObservations);
    const comparison = vnextObservations.map((next) => {
      const baseline = observations.find((item) => item.id === next.id);
      return {
        id: next.id,
        turns: next.turns.map((vnextTurn) => {
          const v5Turn = baseline?.turns.find((turn) => turn.turn === vnextTurn.turn);
          return {
            turn: vnextTurn.turn,
            v5: v5Turn?.status ?? 'not_reached',
            vnext: vnextTurn.status,
            providerCalls: { v5: v5Turn ? v5Turn.aiCalls + v5Turn.rendererCalls : null, vnext: vnextTurn.aiCalls },
            questions: { v5: v5Turn?.questionCode ?? null, vnext: vnextTurn.questionCode },
            workMinutes: { v5: v5Turn?.workMinutes ?? null, vnext: vnextTurn.workMinutes },
            previewMinutes: { v5: v5Turn?.previewMinutes ?? null, vnext: vnextTurn.previewMinutes },
            wrongAcceptance: { v5: v5Turn?.wrongAcceptance ?? false, vnext: vnextTurn.wrongAcceptance },
            wrongRejection: { v5: v5Turn?.wrongRejection ?? false, vnext: vnextTurn.wrongRejection },
            diagnostics: {
              v5: v5Turn?.failureDetail ?? null,
              vnext: {
                interpretation: vnextTurn.interpretation,
                transactionErrors: vnextTurn.transactionErrors,
                appliedDelta: vnextTurn.appliedDelta,
                previewBlockedBy: vnextTurn.previewBlockedBy,
              },
            },
            oracleDifferences: { v5: v5Turn?.oracleDifferences ?? ['not reached'], vnext: vnextTurn.oracleDifferences },
          };
        }),
      };
    });
    writeFileSync(`${artifactDir}/v5-baseline.json`, `${JSON.stringify({ summary: v5Summary, conversations: observations }, null, 2)}\n`);
    writeFileSync(`${artifactDir}/vnext-native.json`, `${JSON.stringify({ summary: vnextSummary, conversations: vnextObservations }, null, 2)}\n`);
    writeFileSync(`${artifactDir}/comparison.json`, `${JSON.stringify({ v5: v5Summary, vnext: vnextSummary, conversations: comparison }, null, 2)}\n`);
    writeFileSync(`${artifactDir}/comparison.md`, `# V5 / VNext real-provider comparison\n\nThe same synthetic turns are run independently through both paths. VNext replies are deterministic and do not call a renderer model; provider-call totals cover interpretation.\n\n## Counts\n\n| Metric | V5 | VNext |\n| --- | ---: | ---: |\n| In-scope turns passed | ${v5Summary.passedOracle} | ${vnextSummary.passedOracle} |\n| In-scope turns failed | ${v5Summary.failedOracle} | ${vnextSummary.failedOracle} |\n| Not reached | ${v5Summary.notReached} | ${vnextSummary.notReached} |\n| Out of scope | ${v5Summary.outOfScopeTurns} | ${vnextSummary.outOfScopeTurns} |\n| Wrong acceptance | ${v5Summary.wrongAcceptance} | ${vnextSummary.wrongAcceptance} |\n| Wrong rejection | ${v5Summary.wrongRejection} | ${vnextSummary.wrongRejection} |\n| Semantic provider calls | ${v5Summary.aiCalls} | ${vnextSummary.aiCalls} |\n| Clarification prompts | ${v5Summary.clarificationPrompts} | ${vnextSummary.clarificationPrompts} |\n| Repeated questions | ${v5Summary.repeatedQuestions} | ${vnextSummary.repeatedQuestions} |\n| Total semantic latency (ms) | ${v5Summary.totalLatencyMs} | ${vnextSummary.totalLatencyMs} |\n\nPer-turn typed observations are in comparison.json.\n`);
  });

  it.each(vnextRealApiConversations)('$id', async (conversation) => {
    try {
      observations.push(await runV5Conversation(conversation));
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      observations.push({
        id: conversation.id,
        source: conversation.source,
        description: conversation.description,
        turns: conversation.turns.map((turn, index) => ({
          turn: index + 1,
          status: 'not_reached',
          userText: turn.userText,
          inVNextScope: turn.oracle.inVNextScope,
          accepted: null,
          error,
          failureDetail: { failure: null, candidateCommitRejectionReason: null, responseSource: null, debugTraceEvents: [] },
          questionCode: null,
          taskIds: [],
          workloads: [],
          efforts: [],
          temporal: [],
          schedulerStatus: null,
          workMinutes: null,
          previewMinutes: null,
          aiCalls: 0,
          rendererCalls: 0,
          latencyMs: null,
          clarificationCount: 0,
          wrongAcceptance: false,
          wrongRejection: false,
          repeatedQuestionCount: 0,
          oracleDifferences: ['not reached'],
        })),
        error,
      });
    }
    try {
      vnextObservations.push(await runVNextConversation(conversation));
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      vnextObservations.push({
        id: conversation.id,
        source: conversation.source,
        description: conversation.description,
        turns: conversation.turns.map((turn, index) => ({
          turn: index + 1,
          status: 'not_reached',
          userText: turn.userText,
          inVNextScope: turn.oracle.inVNextScope,
          accepted: null,
          error,
          failureDetail: undefined,
          questionCode: null,
          taskIds: [],
          workloads: [],
          efforts: [],
          temporal: [],
          schedulerStatus: null,
          workMinutes: null,
          previewMinutes: null,
          aiCalls: 0,
          rendererCalls: 0,
          latencyMs: null,
          clarificationCount: 0,
          wrongAcceptance: false,
          wrongRejection: false,
          repeatedQuestionCount: 0,
          oracleDifferences: ['not reached'],
          outcome: 'not_reached',
          repairs: 0,
          interpretation: null,
          transactionErrors: [],
          appliedDelta: null,
          previewBlockedBy: [],
        } as VNextTurnObservation)),
        error,
      });
    }
  }, 300_000);
});
