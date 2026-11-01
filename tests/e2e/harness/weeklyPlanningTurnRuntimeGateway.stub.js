import { createInitialPlanningIntakeState } from '../../../src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  commitWeeklyPlanningStableV5RuntimeGraph,
} from '../../../src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { createEmptyWeeklyPlanningVNextState, applyWeeklyPlanningVNextTurn } from '../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { serializeWeeklyPlanningVNextSessionCheckpoint } from '../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextSessionCheckpoint';
import { createWeeklyPlanningPreviewBlocks, createWeeklyPlanningPreviewDisplayBlock } from '../../../src/features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks';

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

async function execute(params, vnext) {
    record('real-runtime-execute', {
      userText: params.userText,
      requestId: params.pending.requestId,
      baseRevision: params.pending.baseRevision,
      actualIds: (params.actuals ?? []).map(actual => actual.id),
      materialIds: (params.studyMaterials ?? []).map(material => material.id),
      actualNotes: (params.actuals ?? []).map(actual => actual.note),
      materialCurrentUnits: (params.studyMaterials ?? []).map(material => material.currentUnit),
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

    const runtimeSession = vnext ? null : bindWeeklyPlanningStableV5RuntimeSessionScope({
      ownerId: params.userId,
      weekStartDate: params.snapshot.weekStartDate,
      conversationId: params.pending.conversationId,
    });
    const accepted = vnext?.session.readCheckpoint();
    const previousCore = accepted?.vnext.state ?? createEmptyWeeklyPlanningVNextState();
    const graphRevision = (vnext ? previousCore.graph : runtimeSession.graph).revision + 1;
    const stagedGraph = runtimeSession && {
      ...runtimeSession.graph,
      revision: graphRevision,
      appliedTurnKeys: [
        ...runtimeSession.graph.appliedTurnKeys,
        `${params.pending.conversationId}:${params.pending.requestId}`,
      ],
    };
    if (runtimeSession) commitWeeklyPlanningStableV5RuntimeGraph({
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

    if (vnext) {
      // The existing UI fixture substitutes execution, not language or scheduling.
      // Keep exactly its authored preview and give the real VNext application a
      // valid, staged native checkpoint so approval/reload/cancellation stay real.
      const applied = applyWeeklyPlanningVNextTurn(previousCore, { add: [
        { kind: 'task', localId: 'fixture-task', category: 'study', title: '数学のワーク' },
      ], patch: [], remove: [], relate: [], defer: [] }, {
        expectedRevision: previousCore.graph.revision,
        conversationId: params.pending.conversationId, turnId: params.pending.requestId,
        turnKey: `${params.pending.conversationId}:${params.pending.requestId}`, sourceText: params.userText,
        acceptedDate: params.snapshot.weekStartDate, weekStartsOn: 'monday',
        planningHorizon: { startDate: params.snapshot.weekStartDate, endDate: params.snapshot.weekStartDate },
      });
      if (applied.status !== 'applied') throw new Error('Invalid native weekly UI fixture');
      const taskId = applied.state.graph.tasks.at(-1).id;
      for (const candidate of draftCandidates) {
        candidate.stableV5Metadata.taskId = taskId;
        candidate.stableV5Metadata.sourceFactRefs = [taskId];
      }
      const blocks = createWeeklyPlanningPreviewBlocks(draftCandidates)
        .map(block => createWeeklyPlanningPreviewDisplayBlock(block, params.userId));
      const preview = blocks.length ? { previewId: blocks[0].behaviorMetadata.previewMetadata.previewId,
        graphRevision, blocks } : null;
      const raw = serializeWeeklyPlanningVNextSessionCheckpoint({ ownerId: params.userId,
        weekStartDate: params.snapshot.weekStartDate, conversationId: params.pending.conversationId,
        savedAt: params.pending.startedAt,
        vnext: { state: { ...applied.state, draftGenerationIntent: 'user_authorized' }, presentedQuestion: null,
          preview, messages: [] } });
      if (!raw) throw new Error('Native weekly UI fixture exceeded checkpoint budget');
      vnext.stages.set(params.pending.requestId, { before: vnext.session.checkpoint.read(), after: raw });
    }

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
}

export const weeklyPlanningTurnRuntimeGateway = {
  execute: params => execute(params),
};

// Same execution seam as the historical fixture; production owns the controller,
// UI persistence, approval and repository calls. Provider-driven specs unalias it.
export function createWeeklyPlanningVNextRuntimeGateway({ session }) {
  const stages = new Map();
  return {
    runtimeGateway: { execute: params => execute(params, { session, stages }) },
    stagingLifecycle: {
      prepare({ pending }) {
        const staged = stages.get(pending.requestId);
        if (!staged) return undefined;
        if (session.checkpoint.read() !== staged.before) throw new Error('UI fixture checkpoint changed before commit');
        session.checkpoint.write(staged.after);
        stages.delete(pending.requestId);
        return { complete() {}, rollback() {
          if (session.checkpoint.read() !== staged.after) throw new Error('UI fixture checkpoint changed before rollback');
          if (staged.before === null) session.checkpoint.remove(); else session.checkpoint.write(staged.before);
        } };
      },
      discard(pending) { stages.delete(pending.requestId); },
    },
  };
}
