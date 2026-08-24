import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resetUserPlanningContextRuntimeForTestV1,
  userPlanningContextPromptSummaryV1,
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
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE152_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE152_OUTPUT_DIR
  ?? 'artifacts/issue152-adversarial-real-api';
const timeoutMs = Number(process.env.WEEKLY_PLANNING_ISSUE152_TIMEOUT_MS ?? '300000');
const maxProviderRetries = 2;

interface ObservedTurn {
  userText: string;
  assistantText: string;
  mode: PlanningState['mode'];
  draftCount: number;
  previewCount: number;
  graphRevision: number;
  graph: WeeklyPlanningFactGraphV5 | null;
  failureCode: string | null;
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

function writeArtifact(value: unknown): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    `${outputDir}/semantic-retention.json`,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function runTurn(params: {
  conversationId: string;
  userText: string;
  allowNormalizationRejection?: boolean;
  providerRetryAttempt?: number;
}): Promise<ObservedTurn> {
  const ownerId = `issue152-retention-${params.conversationId}`;
  const weekStartDate = '2026-08-17';
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetUserPlanningContextRuntimeForTestV1();
  clearWeeklyPlanningSessionRuntime();
  bindWeeklyPlanningStableV5RuntimeSessionScope({
    ownerId,
    weekStartDate,
    conversationId: params.conversationId,
  });

  const store = createStore(createInitialPlanningState(weekStartDate));
  const session = createWeeklyPlanningControllerSession(
    ownerId,
    weekStartDate,
    params.conversationId,
  );
  let capturedResult: WeeklyPlanningTurnExecutionResult | null = null;
  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      async execute(runtimeParams) {
        capturedResult = await weeklyPlanningTurnRuntimeGateway.execute(runtimeParams);
        return capturedResult;
      },
    },
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
    outcomeLifecycle: {
      committed: () => undefined,
      discarded: () => undefined,
      failed: () => undefined,
    },
  };

  const submission = await submitWeeklyPlanningApplicationTurn({
    session,
    userId: ownerId,
    ownerId,
    userText: params.userText,
    selectedDate: '2026-08-17',
    plans: [],
    scheduleTemplates: [],
    weekStartsOn: 'monday',
    getState: store.getState,
    dispatch: store.dispatch,
  }, services);
  expect(submission.accepted).toBe(true);
  if (!capturedResult) throw new Error(`semantic-retention runtime result missing: ${params.conversationId}`);
  const result: WeeklyPlanningTurnExecutionResult = capturedResult;

  if (result.failure?.code === 'stable_v5_provider_failure') {
    const retryAttempt = params.providerRetryAttempt ?? 0;
    if (retryAttempt < maxProviderRetries) {
      return runTurn({
        ...params,
        providerRetryAttempt: retryAttempt + 1,
      });
    }
  }
  if (result.failure
    && (!params.allowNormalizationRejection
      || result.failure.code !== 'stable_v5_normalization_rejected')) {
    throw new Error(`${params.conversationId}: ${result.failure.code} ${result.failure.traceCode}`);
  }

  const state = store.getState();
  const runtime = getWeeklyPlanningStableV5RuntimeSession(params.conversationId);
  return {
    userText: params.userText,
    assistantText: state.lastAssistantMessage ?? result.message,
    mode: state.mode,
    draftCount: state.draftBlocks.length,
    previewCount: state.previewCandidates?.length ?? 0,
    graphRevision: runtime?.graph.revision ?? -1,
    graph: runtime?.graph ?? null,
    failureCode: result.failure?.code ?? null,
  };
}

function active(turn: ObservedTurn) {
  if (!turn.graph) throw new Error('semantic-retention graph missing');
  return createWeeklyPlanningActiveSchedulerGraphViewV5(turn.graph);
}

function contextFor(conversationId: string) {
  return userPlanningContextPromptSummaryV1({
    ownerId: `issue152-retention-${conversationId}`,
    currentDate: '2026-08-17',
  });
}

const run = shouldRun ? describe : describe.skip;

run('Issue #152 compacted semantic retention Real API audit', () => {
  it('preserves load-bearing distinctions that prompt compaction previously shortened', async () => {
    const observations: Record<string, unknown> = {};

    const ambiguousModifier = await runTurn({
      conversationId: 'ambiguous-modifier',
      userText: '数学と英語を勉強したいです。30分くらいです。',
    });
    observations.ambiguousModifier = ambiguousModifier;
    const ambiguousActive = active(ambiguousModifier);
    const thirtyAssignments = [
      ...ambiguousActive.workloads.filter((fact) => fact.amount === 30),
      ...ambiguousActive.effortEstimates.filter((fact) => fact.minutes === 30),
    ];
    expect(thirtyAssignments.length).toBeLessThanOrEqual(1);

    const namedDaypart = await runTurn({
      conversationId: 'named-daypart',
      userText: '夜に数学を勉強したいです。',
    });
    observations.namedDaypart = namedDaypart;
    const daypartActive = active(namedDaypart);
    const nightTiming = [
      ...daypartActive.temporalConstraints,
      ...daypartActive.availabilityDeclarations,
    ].filter((fact) => fact.source.sourceText.includes('夜'));
    expect(nightTiming.length).toBeGreaterThan(0);
    for (const fact of nightTiming) {
      expect(fact.namedTimePeriod).toBe('night');
      expect(fact.startTime).toBeNull();
      expect(fact.endTime).toBeNull();
    }

    const unrelatedQuantities = await runTurn({
      conversationId: 'unrelated-quantities',
      userText: '数学を100問、英語を20ページ進めたいです。',
    });
    observations.unrelatedQuantities = unrelatedQuantities;
    const relationActive = active(unrelatedQuantities);
    expect(relationActive.relations).toHaveLength(0);
    expect(relationActive.workloads.some((fact) => fact.amount === 100)).toBe(true);
    expect(relationActive.workloads.some((fact) => fact.amount === 20)).toBe(true);

    const standardUnit = await runTurn({
      conversationId: 'standard-unit',
      userText: '英単語を200語覚えたいです。',
    });
    observations.standardUnit = standardUnit;
    const unitActive = active(standardUnit);
    const wordWorkload = unitActive.workloads.find((fact) => fact.amount === 200);
    expect(wordWorkload?.unitCode).toBe('word');
    expect(wordWorkload?.unitCode).not.toBe('custom');

    const qualitativeProgress = await runTurn({
      conversationId: 'qualitative-progress',
      userText: '英単語はだいぶ進んでいます。残りも勉強したいです。',
      allowNormalizationRejection: true,
    });
    observations.qualitativeProgress = qualitativeProgress;
    const qualitativeActive = active(qualitativeProgress);
    expect(qualitativeActive.workloads).toHaveLength(0);
    expect(qualitativeActive.effortEstimates).toHaveLength(0);

    const eventOccurrence = await runTurn({
      conversationId: 'event-occurrence',
      userText: '9月1日にTOEICを受けます。来週は英語を勉強したいです。',
    });
    observations.eventOccurrence = eventOccurrence;
    const eventActive = active(eventOccurrence);
    expect(eventActive.temporalConstraints.some((fact) =>
      fact.kind === 'deadline' && fact.source.sourceText.includes('9月1日'))).toBe(false);

    const undecomposedProject = await runTurn({
      conversationId: 'undecomposed-project',
      userText: '卒論プロジェクトを進めたいです。作業内容はまだ分解できていません。',
      allowNormalizationRejection: true,
    });
    observations.undecomposedProject = undecomposedProject;
    const projectActive = active(undecomposedProject);
    expect(projectActive.uncertainties.some((fact) => fact.field === 'work_breakdown')).toBe(true);

    const neutralLargeWorkload = await runTurn({
      conversationId: 'neutral-large-workload',
      userText: '英単語は2000語あって量が多いです。',
      allowNormalizationRejection: true,
    });
    const neutralContext = contextFor('neutral-large-workload');
    observations.neutralLargeWorkload = { turn: neutralLargeWorkload, context: neutralContext };
    expect(neutralContext.some((record) => record.kind === 'concern')).toBe(false);

    const explicitConcern = await runTurn({
      conversationId: 'explicit-concern',
      userText: '英単語が苦手で、かなり不安です。',
      allowNormalizationRejection: true,
    });
    const concernContext = contextFor('explicit-concern');
    observations.explicitConcern = { turn: explicitConcern, context: concernContext };
    expect(concernContext.some((record) => record.kind === 'concern')).toBe(true);

    writeArtifact(observations);
  }, timeoutMs);
});
