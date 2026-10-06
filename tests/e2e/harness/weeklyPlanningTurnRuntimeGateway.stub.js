import { createInitialPlanningIntakeState } from '../../../src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../../../src/features/weeklyPlanning/intake/weeklyPlanningQuestionPresentation';
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

const INTERACTION_QUESTION = '数学のワークは1問あたりどれくらい時間がかかりますか？';
const INTERACTION_QUESTION_CONTEXT = {
  kind: 'missing',
  targetSlot: 'stable_v5:missing_effort_estimate',
  intent: 'duration_per_unit',
  topicId: 'browser-interaction-workload',
};
const INTERACTION_PRESENTATION_CONTENT = {
  responseSource: 'deterministic_fallback',
  currentTurnGrounding: 'none',
  selfRepairNotice: false,
  groundingContext: { proposed: 0, contested: 0 },
  previewPromotionControl: false,
};

/**
 * Scripted conversational-interaction results (Issue #488). The real controller, reducer,
 * storage and AiPlanningView run; only the runtime result is scripted by marker text.
 * The stub records the presentation freshness the real state had at turn start, so the
 * browser test can prove each turn's question binding through the production path.
 */
function interactionResult(params, runtimeSession, graphRevision) {
  const previousState = params.snapshot.intakeState ?? createInitialPlanningIntakeState();
  const freshness = resolveWeeklyPlanningQuestionPresentationFreshness({
    previousState: params.snapshot.intakeState,
    inputStateRevision: params.pending.baseRevision,
    messages: params.snapshot.messages,
    graphRevision: runtimeSession.graph.revision,
  }).status;
  record('real-interaction-turn', { userText: params.userText, freshness });
  const question = {
    ...previousState,
    status: 'revision_pending',
    questions: [INTERACTION_QUESTION],
    lastQuestionContext: INTERACTION_QUESTION_CONTEXT,
    sourceTurns: [...previousState.sourceTurns, params.userText],
  };
  if (params.userText.startsWith('FAIL')) {
    return {
      state: previousState,
      message: `こちらの処理で内容を安全に整理できなかったため、予定条件には反映していません。確認中の質問は変わりません。\n\n${INTERACTION_QUESTION}`,
      draftCandidates: [],
      interactionOutcome: { kind: 'recover', failure: 'semantic', representedQuestion: true },
      questionPresentationContent: INTERACTION_PRESENTATION_CONTENT,
      questionPresentationGraphRevision: runtimeSession.graph.revision,
      failure: {
        code: 'stable_v5_normalization_rejected',
        userMessage: `こちらの処理で内容を安全に整理できなかったため、予定条件には反映していません。確認中の質問は変わりません。\n\n${INTERACTION_QUESTION}`,
        traceCode: 'browser-interaction',
        diagnostics: { attemptCount: 2, repairAttempted: true, validationErrorCategories: [], providerErrorCategory: null },
      },
    };
  }
  if (params.userText.startsWith('ASIDE')) {
    // An aside keeps the machine question but does not re-present it: no presentation content.
    return {
      state: question,
      message: 'わかりました。ここまでの内容は変更していません。保留中の確認に戻るときは、そう教えてください。',
      draftCandidates: [],
      interactionOutcome: { kind: 'aside', consultationDeferred: false },
    };
  }
  const stagedGraph = {
    ...runtimeSession.graph,
    revision: graphRevision,
    appliedTurnKeys: [...runtimeSession.graph.appliedTurnKeys, `${params.pending.conversationId}:${params.pending.requestId}`],
  };
  commitWeeklyPlanningStableV5RuntimeGraph({
    ownerId: params.userId,
    conversationId: params.pending.conversationId,
    graph: stagedGraph,
  });
  const explain = params.userText.startsWith('EXPLAIN');
  return {
    state: question,
    message: explain
      ? `この確認は、予定を無理なく配置するために必要です。${INTERACTION_QUESTION}`
      : INTERACTION_QUESTION,
    draftCandidates: [],
    stableV5Graph: stagedGraph,
    interactionOutcome: explain
      ? { kind: 'explain_pending_question', consultationDeferred: false }
      : { kind: 'apply', consultationDeferred: false },
    questionPresentationContent: INTERACTION_PRESENTATION_CONTENT,
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

    if (queryParams().get('interaction') === '1') {
      const interactionSession = bindWeeklyPlanningStableV5RuntimeSessionScope({
        ownerId: params.userId,
        weekStartDate: params.snapshot.weekStartDate,
        conversationId: params.pending.conversationId,
      });
      const result = interactionResult(params, interactionSession, interactionSession.graph.revision + 1);
      if (result.failure) {
        record('real-runtime-fail', { userText: params.userText, requestId: params.pending.requestId });
      }
      return result;
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
