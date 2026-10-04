import { buildCandidateHierarchy } from './hierarchy';
import type { CalibratedChoicePolicy, CandidateChoiceRequest, CandidateManifest, CandidateObservation, CandidateTuple } from './contracts';

export function basis(count = 3) {
  return {
    binding: {
      ownerId: 'owner-a', conversationId: 'conversation-a', requestId: 'request-a',
      inputRevision: 8, graphRevision: 4, selectionEpoch: 2,
      sources: [{ id: 'material-a', revision: 'source-revision-1' }],
      target: { kind: 'workload', id: 'workload-a' },
      scope: { taskId: 'task-a', planningWeek: '2026-10-05' },
      question: { id: 'question-a', code: 'ambiguous_effort_estimate', presentingTurnId: 'turn-a', presentingMessageId: 'message-a', presentationRevision: 8 },
    },
    candidates: Array.from({ length: count }, (_, index) => ({
      id: `candidate-${index}`, label: `完全候補 ${index}`,
      tuple: { minutes: index + 1, measurement: 'per_unit', precision: 'exact', target: 'workload-a', scope: 'task-a' },
    })),
  };
}

export function observation<T extends CandidateTuple>(manifest: CandidateManifest<T>): CandidateObservation<T> {
  return { binding: manifest.binding, candidates: manifest.candidates, sourceAccess: 'allowed', intentProvenance: 'validated_current_turn', targetStatus: 'active', questionPresentation: 'fresh', formalEligibility: 'eligible' };
}

/** Synthetic fixture thresholds, NOT empirical calibration or a production policy. */
export function fixturePolicy<T extends CandidateTuple>(manifest: CandidateManifest<T>, width: number): CalibratedChoicePolicy {
  const rules: CalibratedChoicePolicy['rules'][number][] = [];
  const walk = (node: ReturnType<typeof buildCandidateHierarchy<T>>) => {
    if (!rules.some((rule) => rule.menuKind === node.menu.kind && rule.optionCount === node.menu.options.length && rule.depth === node.menu.depth)) {
      rules.push({ menuKind: node.menu.kind, optionCount: node.menu.options.length, depth: node.menu.depth, minimumTopProbability: 0.65, minimumMargin: 0.2 });
    }
    node.children.forEach(walk);
  };
  walk(buildCandidateHierarchy(manifest, width));
  return { id: 'test-policy', calibrationEvidenceId: 'synthetic-fixture-not-calibration-evidence', rules };
}

export function responseFor<T extends CandidateTuple>(request: CandidateChoiceRequest<T>, optionId = request.menu.options[0].id) {
  return {
    nodeId: request.menu.nodeId, requestId: request.requestId, selectionEpoch: request.selectionEpoch,
    candidateSetHash: request.candidateSetHash, semanticSufficiency: 'only_candidate_meaning', optionId,
    probabilities: request.menu.options.map((option) => ({ optionId: option.id, probability: option.id === optionId ? 0.9 : 0.1 / (request.menu.options.length - 1) })),
  };
}
