import { CANDIDATE_CHOICE_CATALOG_VERSION, type CandidateChoiceWireRequest } from './candidateChoiceDecision';
export function choiceRequest(): CandidateChoiceWireRequest {
  return { wholeUtterance: '30分', requestId: 'request-choice', selectionEpoch: 4, candidateSetHash: `sha256:${'a'.repeat(64)}`,
    context: { question: { id: 'question-1', code: 'missing_effort_estimate' }, target: { kind: 'workload', id: 'workload-1' }, scope: { session: 'session-1', measurement: 'total_duration' } },
    menu: { nodeId: 'group:0:1', depth: 0, kind: 'leaves', options: [{ kind: 'leaf', id: 'leaf:0', candidate: { id: 'candidate-1', label: '30 minutes exact total', tuple: { targetId: 'workload-1', measurement: 'total_duration', minutes: 30, precision: 'exact', unit: 'minute' } } }, { kind: 'none', id: 'none' }] } };
}
export function choiceEvaluation(r = choiceRequest()) {
  return { status: 'evaluated' as const, catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION, requestId: r.requestId, selectionEpoch: r.selectionEpoch,
    candidateSetHash: r.candidateSetHash, nodeId: r.menu.nodeId, optionId: 'leaf:0', probabilities: [{ optionId: 'leaf:0', probability: 0.999 }, { optionId: 'none', probability: 0.001 }], conditionChange: 0.001, independentMeaning: 0.001 };
}
