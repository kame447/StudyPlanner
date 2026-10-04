import { describe, expect, it } from 'vitest';
import { prepareC5PairedEvaluation, completeC5LeavesInRequests } from './evaluationHarness.testUtils';
import { c5Graph, OWNER, WEEK } from './controller.testUtils';
import { captureC5Question } from './basis';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createInitialPlanningIntakeState } from '../../intake/weeklyPlanningIntakeReducer';
import { bindWeeklyPlanningQuestionPresentation } from '../../intake/weeklyPlanningQuestionPresentation';
import { createCandidateManifest } from '../candidateSelection/manifest';
import { buildCandidateHierarchy } from '../candidateSelection/hierarchy';
import { projectCandidateProviderContext } from '../candidateSelection/manifest';

describe('C5 paired preregistration preparation (no API run)', () => {
  it('isolates all three arms with the same original state/full tuple, and detects omitted leaves/qualifiers', async () => {
    const conversationId = 'evaluation-only'; const graph = c5Graph(conversationId);
    const state = captureC5Question({ ownerId: OWNER, conversationId, graph, state: bindWeeklyPlanningQuestionPresentation({
      state: { ...createInitialPlanningIntakeState(), questions: ['effort question'], lastQuestionContext: { kind: 'ambiguity', topicId: 'work-a',
        targetSlot: 'stable_v5:ambiguous_effort_estimate', actionId: 'q' } },
      content: { responseSource: 'deterministic_fallback', currentTurnGrounding: 'none', selfRepairNotice: false,
        groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false },
      turnId: 'turn', assistantMessageId: 'turn:assistant', planningStateRevision: 2, graphRevision: 3,
    }) });
    const snapshot = state.lastQuestionContext!.c5!;
    const prepared = prepareC5PairedEvaluation({ caseId: 'synthetic-structure-only', wholeUtterance: '1問7分', provenance: 'synthetic_diagnostic',
      snapshot, planningState: { ...createInitialPlanningState(WEEK), intakeState: state }, graph }, ['luna_only','flat_complete_tuple','hierarchy_same_leaves']);
    expect(new Set(prepared.map((a) => a.identity)).size).toBe(1); expect(new Set(prepared.map((a) => a.leafIdentity)).size).toBe(1);
    prepared[0].input.graph.effortEstimates[0].minutes = 999; expect(prepared[1].input.graph.effortEstimates[0].minutes).toBe(5); expect(graph.effortEstimates[0].minutes).toBe(5);
    const manifest = await createCandidateManifest({ candidates: snapshot.candidates, binding: { question: snapshot.question,
      selectionEpoch: 1, ownerId: OWNER, conversationId, requestId: 'answer', graphRevision: 3, inputRevision: 2,
      sources: snapshot.sources, target: snapshot.target, scope: snapshot.scope } });
    const { menu } = buildCandidateHierarchy(manifest, 2);
    const request = { menu, wholeUtterance: '1問7分', requestId: 'answer', selectionEpoch: 1,
      candidateSetHash: manifest.candidateSetHash, context: projectCandidateProviderContext(manifest) };
    expect(completeC5LeavesInRequests(snapshot, [request])).toBe(true);
    expect(completeC5LeavesInRequests(snapshot, [{ ...request, menu: { ...menu, options: menu.options.slice(1) } }])).toBe(false);
    const omitted = structuredClone(request); const leaf = omitted.menu.options[0];
    if (leaf.kind !== 'leaf') throw new Error('missing leaf');
    const { precision: _removed, ...tuple } = leaf.candidate.tuple;
    const bad = { ...request, menu: { ...menu, options: [{ ...leaf, candidate: { ...leaf.candidate, tuple } }, ...menu.options.slice(1)] } };
    expect(completeC5LeavesInRequests(snapshot, [bad])).toBe(false);
  });
});
