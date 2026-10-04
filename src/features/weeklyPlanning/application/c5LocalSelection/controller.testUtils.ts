import { createInitialPlanningIntakeState } from '../../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5, type PlanningFactSourceV5, type WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { resolveGenericWorkItemEstimate } from '../../semantic/weeklyPlanningGenericWorkEstimation';
import { createInitialPlanningState, weeklyPlanningReducer } from '../../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, submitWeeklyPlanningControlledTurn } from '../../weeklyPlanningTurnController';
import type { PlanningState, WeeklyPlanningAction } from '../../types';
import type { WeeklyPlanningTurnExecutionResult } from '../../weeklyPlanningTurnExecutionTypes';
import { hydrateWeeklyPlanningStableV5RuntimeSession } from '../weeklyPlanningStableV5RuntimeSession';
import { saveWeeklyPlanningStableV5PersistedSession } from '../weeklyPlanningStableV5SessionStorage';
import { c5PlanningWorkloads } from './basis';
import type { C5LocalSelectionOptions } from './contracts';

export const OWNER = 'c5-test-owner';
export const WEEK = '2026-10-05';
let sequence = 0;
export function c5Graph(conversationId: string): WeeklyPlanningFactGraphV5 {
  const source = (id: string): PlanningFactSourceV5 => ({ conversationId, turnId: 'original-turn', semanticLocalId: id,
    sourceText: `private-source-${id}`, origin: 'user' });
  const graph: WeeklyPlanningFactGraphV5 = {
    ...createEmptyWeeklyPlanningFactGraphV5(), revision: 3,
    tasks: ['a', 'b'].map((id) => ({ id: `task-${id}`, category: 'study', title: `教材${id}`, source: source(id), createdRevision: 1 })),
    workloads: [{ id: 'work-a', taskId: 'task-a', componentId: null, quantityRole: 'target', amount: 10,
      unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
      source: source('wa'), createdRevision: 1 },
      { id: 'work-b', taskId: 'task-b', componentId: null, quantityRole: 'target', amount: 10,
        unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source: source('wb'), createdRevision: 1 },
      { id: 'completed-b', taskId: 'task-b', componentId: null, quantityRole: 'completed', amount: 2,
        unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source: source('cb'), createdRevision: 1 }],
    effortEstimates: [{ id: 'estimate-5', taskId: 'task-a', targetFactId: 'work-a', kind: 'duration_per_unit', minutes: 5,
      unitCode: 'problem', precision: 'exact', source: source('e5'), createdRevision: 1 },
      { id: 'estimate-7', taskId: 'task-a', targetFactId: 'work-a', kind: 'duration_per_unit', minutes: 7,
        unitCode: 'problem', precision: 'exact', source: source('e7'), createdRevision: 1 },
      { id: 'pace-b', taskId: 'task-b', targetFactId: 'completed-b', kind: 'total_duration', minutes: 8,
        unitCode: null, precision: 'exact', source: source('pb'), createdRevision: 1 }],
  };
  graph.factLifecycles = [...graph.tasks, ...graph.workloads, ...graph.effortEstimates].map((fact) => ({
    factId: fact.id, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null,
  }));
  return graph;
}

export function resolution(graph: WeeklyPlanningFactGraphV5, workloadId: string) {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const workloads = c5PlanningWorkloads(active);
  return resolveGenericWorkItemEstimate({ workload: workloads.find((w) => w.id === workloadId)!, workloads, estimates: active.effortEstimates });
}

export function c5ControllerHarness() {
  const conversationId = `weekly-conversation-623e4567-e89b-52d3-a456-${String(++sequence).padStart(12, '0')}`;
  const graph = c5Graph(conversationId);
  hydrateWeeklyPlanningStableV5RuntimeSession({ ownerId: OWNER, weekStartDate: WEEK, conversationId, graph });
  let state = createInitialPlanningState(WEEK);
  const actions: WeeklyPlanningAction[] = [];
  const session = createWeeklyPlanningControllerSession(OWNER, WEEK, conversationId);
  const controls = { access: 'allowed' as 'allowed' | 'denied' | 'unknown',
    beforeReducer: undefined as ((action: WeeklyPlanningAction) => void) | undefined };
  const dispatch = (action: WeeklyPlanningAction) => {
    actions.push(action); controls.beforeReducer?.(action); state = weeklyPlanningReducer(state, action); return state;
  };
  const options: C5LocalSelectionOptions = {
    // Structural test policy, never a calibrated production claim.
    policy: { id: 'test-only', calibrationEvidenceId: 'test-double-not-gold',
      rules: [{ menuKind: 'leaves', optionCount: 3, depth: 0, minimumTopProbability: 0.9, minimumMargin: 0.8 }] },
    maximumChildrenPerMenu: 2, maximumDecisions: 1,
    sourceAccess: () => controls.access,
    async choose(request, beforeDispatch) {
      beforeDispatch();
      const optionId = request.menu.options.find((o) => o.kind === 'leaf' && o.candidate.id === 'estimate-7')!.id;
      return { nodeId: request.menu.nodeId, requestId: request.requestId, selectionEpoch: request.selectionEpoch,
        candidateSetHash: request.candidateSetHash, semanticSufficiency: 'only_candidate_meaning', optionId,
        probabilities: request.menu.options.map((option) => ({ optionId: option.id, probability: option.id === optionId ? 0.96 : 0.02 })) };
    },
    async continueSelectedTurn({ snapshot, graph: selectedGraph }) {
      // The actual domain resolver observes the accepted local plan. No semantic interpretation occurs here.
      if (resolution(selectedGraph, 'work-a').estimatedMinutes !== 70) throw new Error('local plan invalid');
      return { state: { ...snapshot.intakeState!, questions: [], lastQuestionContext: undefined },
        message: '選択を反映しました。', draftCandidates: [], stableV5Graph: selectedGraph, responseSource: 'deterministic_fallback' };
    },
  };
  const execute = async ({ snapshot }: { snapshot: PlanningState }): Promise<WeeklyPlanningTurnExecutionResult> => ({
    state: snapshot.intakeState ?? createInitialPlanningIntakeState(), message: '通常経路の返答', draftCandidates: [], stableV5Graph: graph,
  });
  const submit = (userText: string, overrides: Partial<Parameters<typeof submitWeeklyPlanningControlledTurn>[0]> = {}) =>
    submitWeeklyPlanningControlledTurn({ session, ownerId: OWNER, userText, getState: () => state, dispatch, execute,
      c5LocalSelection: options, ...overrides });
  const present = () => submit('計画を相談します', {
    execute: async () => ({ state: { ...createInitialPlanningIntakeState(), intent: 'weekly_study_planning',
      draftGenerationIntent: 'not_requested', questions: ['教材aは1問5分と7分のどちらですか。'],
      lastQuestionContext: { kind: 'ambiguity', targetSlot: 'stable_v5:ambiguous_effort_estimate',
        topicId: 'work-a', actionId: 'question-a', intent: 'ambiguous_effort_estimate' } },
      message: '教材aは1問5分と7分のどちらですか。', draftCandidates: [], stableV5Graph: graph,
      questionPresentationContent: { responseSource: 'deterministic_fallback', currentTurnGrounding: 'none', selfRepairNotice: false,
        groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false } }),
    onCommittedTurn: ({ committed }) => {
      if (!saveWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, conversationId, weekStartDate: WEEK, graph, planningState: committed })) throw new Error('fixture checkpoint failed');
    },
  });
  return { conversationId, graph, session, options, actions, controls, getState: () => state,
    replaceState: (next: PlanningState) => { state = next; }, dispatch, submit, present };
}
