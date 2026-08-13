import { createInitialPlanningIntakeState } from '../../../src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  commitWeeklyPlanningStableV5RuntimeGraph,
} from '../../../src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';

const pendingResolvers = [];

function record(type, payload = null) {
  window.__realWeeklyEvents ??= [];
  window.__realWeeklyEvents.push({ type, payload });
}

function queryParams() {
  return new URLSearchParams(window.location.search);
}

function shouldGate() {
  return (queryParams().get('gate') ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes('real-weekly');
}

function shouldFailRuntime() {
  return queryParams().get('runtimeFailure') === '1';
}

function previewCandidate({ conversationId, graphRevision }) {
  return {
    stableKey: 'real-app-preview-math',
    date: '2026-08-18',
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    title: '数学のワーク',
    field: '数学',
    year: 0,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: 'math-work',
    stableV5Metadata: {
      runtime: 'stable_v5',
      conversationId,
      graphRevision,
      taskId: 'task:math-work',
      sourceFactRefs: ['fact:math-work-duration'],
      planType: 'study',
    },
  };
}

window.__realWeeklyRuntime = {
  release() {
    const resolve = pendingResolvers.shift();
    if (!resolve) return false;
    resolve();
    return true;
  },
  pending() {
    return pendingResolvers.length;
  },
};

export const weeklyPlanningTurnRuntimeGateway = {
  async execute(params) {
    record('real-runtime-execute', {
      userText: params.userText,
      requestId: params.pending.requestId,
      baseRevision: params.pending.baseRevision,
    });

    if (shouldGate()) {
      await new Promise((resolve) => pendingResolvers.push(resolve));
    }

    if (shouldFailRuntime()) {
      record('real-runtime-fail', {
        userText: params.userText,
        requestId: params.pending.requestId,
      });
      throw new Error('browser test runtime failure');
    }

    const previousState = params.snapshot.intakeState ?? createInitialPlanningIntakeState();
    const state = {
      ...previousState,
      sourceTurns: [...previousState.sourceTurns, params.userText],
    };

    const runtimeSession = bindWeeklyPlanningStableV5RuntimeSessionScope({
      ownerId: params.userId,
      weekStartDate: params.snapshot.weekStartDate,
      conversationId: params.pending.conversationId,
    });
    const graphRevision = runtimeSession.graph.revision + 1;
    const stagedGraph = {
      ...runtimeSession.graph,
      revision: graphRevision,
      appliedTurnKeys: [
        ...runtimeSession.graph.appliedTurnKeys,
        `${params.pending.conversationId}:${params.pending.requestId}`,
      ],
    };
    commitWeeklyPlanningStableV5RuntimeGraph({
      ownerId: params.userId,
      conversationId: params.pending.conversationId,
      graph: stagedGraph,
    });

    const draftCandidates = queryParams().get('preview') === '1'
      ? [previewCandidate({
          conversationId: params.pending.conversationId,
          graphRevision,
        })]
      : [];

    record('real-runtime-complete', {
      userText: params.userText,
      requestId: params.pending.requestId,
      draftCandidateCount: draftCandidates.length,
      graphRevision,
    });

    return {
      state,
      message: `テスト応答: ${params.userText}`,
      draftCandidates,
    };
  },
};
