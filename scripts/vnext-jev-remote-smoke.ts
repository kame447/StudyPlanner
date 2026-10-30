import { startVNextJevRemote } from './vnext-jev-remote';
import { vnextOptionChoiceBasis } from '../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextOptionChoice';
import { createCandidateManifest, selectApplicationCandidate, type CandidateChoiceRequest } from '../src/features/weeklyPlanning/application/candidateSelection';
import { createEmptyWeeklyPlanningVNextState, applyWeeklyPlanningVNextTurn } from '../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { presentWeeklyPlanningVNextQuestion } from '../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextQuestionText';

// One synthetic request, produced by the same manifest/selection path as the adapter.
export async function remoteSmokeRequest(): Promise<CandidateChoiceRequest> {
  const seed = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), {
    add: [{ kind: 'task', localId: 't', title: 'Synthetic slides', category: 'study' },
      ...([['scope_total', 20], ['completed', 12], ['remaining', 7]] as const).map(([quantityRole, amount]) => ({
        kind: 'workload' as const, localId: quantityRole, taskRef: { localId: 't' }, componentRef: null,
        quantityRole, amount, unitCode: 'page' as const, unitLabel: '枚', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null,
      }))], patch: [], remove: [], relate: [], defer: [],
  }, { expectedRevision: 0, acceptedDate: '2026-11-02', weekStartsOn: 'monday',
    planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, turnKey: 'smoke', conversationId: 'synthetic', turnId: 'seed', sourceText: 'synthetic' });
  if (seed.status !== 'applied') throw new Error('Synthetic remote seed failed.');
  const question = projectWeeklyPlanningVNext(seed.state).questions[0];
  if (question?.code !== 'remaining_inconsistent') throw new Error('Synthetic remote question missing.');
  const basis = await vnextOptionChoiceBasis({ ownerId: 'synthetic', conversationId: 'synthetic', graphRevision: seed.state.graph.revision,
    question, presentation: presentWeeklyPlanningVNextQuestion(seed.state, question) });
  const manifest = await createCandidateManifest(basis);
  let captured: CandidateChoiceRequest | undefined;
  await selectApplicationCandidate({ manifest, wholeUtterance: '進捗から計算した残り8枚にしてください。',
    maximumChildrenPerMenu: 2, maximumDecisions: 1,
    // Invocation-only capture; this never stages a result or claims live calibration.
    policy: { id: 'request-capture', calibrationEvidenceId: 'synthetic-shape-only',
      rules: [{ menuKind: 'leaves', optionCount: 3, depth: 0, minimumTopProbability: 1, minimumMargin: 1 }] },
    readCurrent: () => ({ ...basis, sourceAccess: 'allowed', intentProvenance: 'validated_current_turn',
      targetStatus: 'active', questionPresentation: 'fresh', formalEligibility: 'eligible' }),
    choose: async (request, beforeDispatch) => { beforeDispatch(); captured = request; throw new Error('Capture only.'); },
  });
  if (!captured) throw new Error('Synthetic remote request capture failed.');
  return captured;
}

export async function runVNextJevRemoteSmoke(mode: 'both' | 'ready' | 'luna' | 'jev' = 'both') {
  const remote = await startVNextJevRemote({ worker: 'studyplanner-ai-proxy', ttlMs: 180_000 });
  try {
    console.info(JSON.stringify({ stage: 'ready', openAi: true, openRouter: true }));
    if (mode === 'ready') return;
    if (mode !== 'jev') {
      await remote.lunaClient.createChatCompletion({ messages: [{ role: 'user', content: 'Reply with the word ready.' }], maxCompletionTokens: 1024 });
      console.info(JSON.stringify({ stage: 'luna', usage: remote.usage().luna }));
    }
    if (mode !== 'luna') {
      const result = await remote.evaluateJev(await remoteSmokeRequest());
      console.info(JSON.stringify({ stage: 'jev', jevStatus: result.status, usage: remote.usage().jev }));
      if (result.status !== 'evaluated') throw new Error('Jev did not return a validated evaluation.');
    }
  } finally { await remote.stop(); }
}
