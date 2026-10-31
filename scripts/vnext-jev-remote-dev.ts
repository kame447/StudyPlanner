import { createHash } from 'node:crypto';
import type { VNextJevComparisonCase } from '../src/features/weeklyPlanning/evals/vnextJevComparisonCases';
import { vnextOptionChoiceBasis } from '../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextOptionChoice';
import { presentWeeklyPlanningVNextQuestion } from '../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextQuestionText';
import { createCandidateManifest, selectApplicationCandidate, type CandidateChoiceRequest } from '../src/features/weeklyPlanning/application/candidateSelection';
import { createEmptyWeeklyPlanningVNextState, applyWeeklyPlanningVNextTurn } from '../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { createVNextLineageResolver } from '../src/features/weeklyPlanning/vnext/weeklyPlanningVNextWorkIdentity';
import type { VNextJevRemote, ProviderCallUsage } from './vnext-jev-remote';
import { resolveCanonicalDateExpression } from '../src/features/weeklyPlanning/semantic/weeklyPlanningCalendarResolver';

export const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
export function devCasesHash(cases: readonly VNextJevComparisonCase[]): string {
  if (!cases.length || cases.some(item => item.split !== 'dev')) throw new Error('Only development cases are permitted.');
  return sha256(cases.map(item => `${item.id}\t${item.split}\t${item.userText}`).join('\n') + '\n');
}

export async function prepareVNextJevDevCase(item: VNextJevComparisonCase) {
  if (item.split !== 'dev') throw new Error('Only development cases are permitted.');
  const conversationId = `vnext-jev-dev:${item.id}`;
  const week = resolveCanonicalDateExpression({ expression: 'this_week', currentDate: item.seed.acceptedDate, weekStartsOn: 'monday' });
  if (week.status !== 'resolved') throw new Error('Development seed date rejected.');
  const seeded = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), {
    add: [{ kind: 'task', localId: 'task', category: 'study', title: item.seed.taskTitle }, ...item.seed.facts],
    patch: [], remove: [], relate: [], defer: [],
  }, { expectedRevision: 0, acceptedDate: item.seed.acceptedDate, weekStartsOn: 'monday',
    planningHorizon: { startDate: week.range.start, endDate: week.range.end }, defaultPlanningHorizon: { startDate: week.range.start, endDate: week.range.end }, turnKey: 'seed',
    conversationId, turnId: 'seed', sourceText: 'Synthetic development seed' });
  if (seeded.status !== 'applied') throw new Error('Development seed rejected.');
  const state = seeded.state;
  const question = projectWeeklyPlanningVNext(state).questions[0];
  if (!question || !['remaining_inconsistent', 'same_or_distinct_work'].includes(question.code) || question.options.length < 2) {
    throw new Error('Development case has no closed option question.');
  }
  const basis = await vnextOptionChoiceBasis({ ownerId: 'synthetic-dev', conversationId,
    graphRevision: state.graph.revision, question, presentation: presentWeeklyPlanningVNextQuestion(state, question) });
  const manifest = await createCandidateManifest(basis);
  let captured: CandidateChoiceRequest | undefined;
  await selectApplicationCandidate({ manifest, wholeUtterance: item.userText,
    maximumChildrenPerMenu: question.options.length, maximumDecisions: 1,
    policy: { id: 'dev-request-capture', calibrationEvidenceId: 'shape-only-not-calibration', rules: [{
      menuKind: 'leaves', optionCount: question.options.length + 1, depth: 0, minimumTopProbability: 1, minimumMargin: 1,
    }] },
    readCurrent: () => ({ ...basis, sourceAccess: 'allowed', intentProvenance: 'validated_current_turn',
      targetStatus: 'active', questionPresentation: 'fresh', formalEligibility: 'eligible' }),
    choose: async (request, beforeDispatch) => { beforeDispatch(); captured = request; throw new Error('Capture only.'); },
  });
  if (!captured) throw new Error('Development request capture failed.');
  const request: CandidateChoiceRequest = captured;
  const choices = Object.fromEntries(request.menu.options.map(option => [option.id,
    option.kind === 'leaf' ? String(option.candidate.tuple.optionId) : 'none']));
  let expectedChoice = typeof item.expectedChoice === 'string' ? item.expectedChoice : 'none';
  if (item.expectedChoice && typeof item.expectedChoice === 'object') {
    const wanted = item.expectedChoice.keep;
    const resolver = createVNextLineageResolver(state.graph);
    const matching = question.options.filter(option => {
      if (!option.optionId.startsWith('keep:')) return false;
      const fact = state.graph.workloads.find(fact => fact.id === resolver.leafOf(option.optionId.slice(5)));
      return fact && state.graph.tasks.find(task => task.id === fact.taskId)?.title === wanted.taskTitle
        && fact.quantityRole === wanted.quantityRole && fact.amount === wanted.amount
        && fact.unitCode === wanted.unitCode && fact.unitLabel === wanted.unitLabel;
    });
    if (matching.length !== 1) throw new Error('Development expected choice is not unique.');
    expectedChoice = matching[0].optionId;
  }
  const expectedWire = Object.keys(choices).filter(id => choices[id] === expectedChoice);
  if (expectedWire.length !== 1) throw new Error('Development expected choice is absent from menu.');
  return { request, choices, expectedChoice, expectedWireOptionId: expectedWire[0],
    requestSha256: sha256(JSON.stringify(request)), menuShape: item.menuShape, caseId: item.id,
    menu: { kind: request.menu.kind, depth: request.menu.depth, optionCount: request.menu.options.length } };
}

export interface VNextJevDevRawCall {
  caseId: string; repetition: number; menuShape: string;
  menu: { kind: string; depth: number; optionCount: number };
  expectedChoice: string; expectedWireOptionId: string; requestSha256: string;
  status: string; reason?: string; optionId: string | null; choice: string | null;
  probabilities: readonly { optionId: string; probability: number }[] | null;
  conditionChange: number | null; independentMeaning: number | null;
  usage: ProviderCallUsage | null;
}
export interface VNextJevDevRawArtifact {
  schemaVersion: 'vnext-jev-dev-raw-v1'; split: 'dev'; splitHash: string; devCasesHash: string;
  codeHead: string; repetitions: 3; caseCount: number; completed: boolean;
  calls: VNextJevDevRawCall[]; usage: ReturnType<VNextJevRemote['usage']> | null;
}

export async function collectVNextJevDevRaw(params: {
  cases: readonly VNextJevComparisonCase[]; splitHash: string; expectedDevHash: string; codeHead: string;
  remote: Pick<VNextJevRemote, 'evaluateJev' | 'usage'>;
  persist(artifact: VNextJevDevRawArtifact): Promise<void>;
}): Promise<VNextJevDevRawArtifact> {
  const hash = devCasesHash(params.cases);
  if (hash !== params.expectedDevHash || !/^[a-f0-9]{64}$/.test(params.splitHash)
    || new Set(params.cases.map(item => item.id)).size !== params.cases.length) throw new Error('Development corpus freeze mismatch.');
  // Validate every seed/menu/expected binding before exposing the first utterance to a provider.
  const prepared = await Promise.all(params.cases.map(prepareVNextJevDevCase));
  const artifact: VNextJevDevRawArtifact = { schemaVersion: 'vnext-jev-dev-raw-v1', split: 'dev',
    splitHash: params.splitHash, devCasesHash: hash, codeHead: params.codeHead, repetitions: 3,
    caseCount: prepared.length, completed: false, calls: [], usage: null };
  await params.persist(structuredClone(artifact));
  for (const item of prepared) {
    for (let repetition = 1; repetition <= 3; repetition++) {
      const before = params.remote.usage().jev.calls;
      let result;
      let transportFailed = false;
      try { result = await params.remote.evaluateJev(item.request); }
      catch { result = { status: 'unavailable' as const, reason: 'preview_transport' }; transportFailed = true; }
      const totals = params.remote.usage();
      if (totals.jev.calls !== before + 1) throw new Error('Development call accounting mismatch.');
      artifact.calls.push({ caseId: item.caseId, repetition, menuShape: item.menuShape, menu: item.menu,
        expectedChoice: item.expectedChoice, expectedWireOptionId: item.expectedWireOptionId, requestSha256: item.requestSha256,
        status: result.status, ...(result.status === 'unavailable' ? { reason: result.reason } : {}),
        optionId: result.status === 'evaluated' ? result.optionId : null,
        choice: result.status === 'evaluated' ? item.choices[result.optionId] : null,
        probabilities: result.status === 'evaluated' ? result.probabilities : null,
        conditionChange: result.status === 'evaluated' ? result.conditionChange : null,
        independentMeaning: result.status === 'evaluated' ? result.independentMeaning : null,
        usage: totals.jev.lastCall });
      artifact.usage = totals;
      await params.persist(structuredClone(artifact));
      if (transportFailed) throw new Error('Development preview transport failed; partial artifact retained.');
    }
  }
  artifact.completed = true;
  await params.persist(structuredClone(artifact));
  return artifact;
}
