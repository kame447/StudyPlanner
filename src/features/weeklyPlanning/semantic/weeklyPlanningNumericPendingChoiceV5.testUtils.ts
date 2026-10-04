import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import type { NumericPendingChoicePortV5, NumericPendingStateV5 } from './weeklyPlanningNumericPendingChoiceV5';
import type { CandidateChoiceRequest } from '../application/candidateSelection';
export function numericFixture(measurement: NumericPendingStateV5['measurement'] = 'total_duration') {
  const source = { conversationId: 'conversation-numeric', turnId: 'turn-before', semanticLocalId: 'source', sourceText: '問題を10問進める', origin: 'user' as const };
  const graph = { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2,
    tasks: [{ id: 'task-1', category: 'study' as const, title: '数学', source, createdRevision: 1 }],
    workloads: [{ id: 'workload-1', taskId: 'task-1', componentId: null, quantityRole: 'target' as const, amount: 10, unitCode: 'problem' as const, unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source, createdRevision: 1 }],
    factLifecycles: ['task-1', 'workload-1'].map(factId => ({ factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null })) };
  const workload = graph.workloads[0];
  const scope = { taskId: workload.taskId, componentId: workload.componentId, amount: workload.amount, unitCode: workload.unitCode, quantityRole: workload.quantityRole, rangeStart: workload.rangeStart, rangeEnd: workload.rangeEnd, perOccurrence: workload.perOccurrence, periodExpression: workload.periodExpression };
  const input: WeeklyPlanningSemanticNormalizerInputV5 = { userText: '30分', traceRequestId: 'request-numeric', committedGraph: graph,
    publicStateSummary: { graphRevision: 2, pendingQuestion: { actionId: 'question-1', questionCode: 'missing_effort_estimate', targetFactId: workload.id, graphRevision: 2, effortMeasurement: measurement },
      tasks: [{ publicId: 'task-1', category: 'study', title: '数学' }], components: [], workloads: [{ publicId: workload.id, taskPublicId: workload.taskId, componentPublicId: null, ...scope, unitLabel: '問' }] } };
  let state: NumericPendingStateV5 = { pendingTargetCount: 1, measurement, perUnit: measurement === 'duration_per_unit' ? 'problem' : null,
    binding: { ownerId: 'owner-1', conversationId: 'conversation-numeric', requestId: 'request-numeric', inputRevision: 5, graphRevision: 2, selectionEpoch: 2, sources: [{ id: 'graph', revision: '2' }], target: { kind: 'workload', id: 'workload-1' }, scope, question: { id: 'question-1', code: 'missing_effort_estimate', presentingTurnId: 'turn-before', presentingMessageId: 'message-before', presentationRevision: 5 } },
    sourceAccess: 'allowed', intentProvenance: 'validated_current_turn', targetStatus: 'active', questionPresentation: 'fresh', formalEligibility: 'eligible' };
  const port: NumericPendingChoicePortV5 = { domainMinutes: [10, 20, 30], domainPolicyVersion: 'synthetic-domain-v1', maximumChildrenPerMenu: 254, maximumDecisions: 4,
    choicePolicy: { id: 'synthetic-policy', calibrationEvidenceId: 'synthetic-test-only', rules: [{ menuKind: 'leaves', optionCount: 4, depth: 0, minimumTopProbability: 0.98, minimumMargin: 0.9 }] },
    readCurrent: () => state,
    choose: async (r, before) => { before(); return normalizedChoice(r, 'leaf:2'); } };
  return { input, graph, port, get state() { return state; }, setState(next: NumericPendingStateV5) { state = next; } };
}
export function normalizedChoice(r: CandidateChoiceRequest, id: string, semanticSufficiency = 'only_candidate_meaning') {
  return { requestId: r.requestId, selectionEpoch: r.selectionEpoch, candidateSetHash: r.candidateSetHash, nodeId: r.menu.nodeId, optionId: id, semanticSufficiency,
    probabilities: r.menu.options.map(o => ({ optionId: o.id, probability: o.id === id ? 0.999 : 0.001 / (r.menu.options.length - 1) })) };
}
