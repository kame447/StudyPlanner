import { describe, expect, it, vi } from 'vitest';
import { createWeeklyPlanningVNextFocusedInterpreter } from './weeklyPlanningVNextFocusedInterpreter';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { decodeVNextProviderOutput } from '../semantic/weeklyPlanningVNextProviderSchema';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import type { WeeklyPlanningVNextInterpretationInput, WeeklyPlanningVNextInterpretation } from '../weeklyPlanningVNextInterpretationContract';
import { FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5 } from '../weeklyPlanningVNextV5Boundary';
import { createCandidateChoiceClient } from '../../../../services/ai/candidateChoiceClient';
import { createCandidateManifest, buildCandidateHierarchy, projectCandidateProviderContext } from '../../application/candidateSelection';
import { CANDIDATE_CHOICE_CATALOG_VERSION } from '../../../../../shared/candidateChoiceDecision';
import { vnextOptionChoiceBasis } from './weeklyPlanningVNextOptionChoice';
import { presentWeeklyPlanningVNextQuestion } from './weeklyPlanningVNextQuestionText';

const horizon = { startDate: '2026-11-02', endDate: '2026-11-08' };
const clock = { currentDate: horizon.startDate, planningStartDate: horizon.startDate, planningEndDate: horizon.endDate,
  weekStartsOn: 'monday' as const, timeZone: 'Asia/Tokyo', defaultPlanningHorizon: horizon };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const work = (localId: string, quantityRole: 'remaining' | 'declared' | 'scope_total' | 'completed', amount: number): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: 't' }, componentRef: null, quantityRole, amount, unitCode: 'page', unitLabel: 'ページ',
  rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
function apply(state: WeeklyPlanningVNextState, delta: VNextTurnDelta) {
  const result = applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision,
    acceptedDate: clock.currentDate, weekStartsOn: 'monday', planningHorizon: horizon, defaultPlanningHorizon: horizon,
    conversationId: 'c', turnId: `t${state.graph.revision}`, turnKey: `t${state.graph.revision}`, sourceText: 'typed synthetic' });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
const seed = (facts: VNextAddFact[] = [work('w', 'remaining', 8)]) => apply(createEmptyWeeklyPlanningVNextState(), {
  ...empty(), add: [{ kind: 'task', localId: 't', category: 'study', title: '数学' }, ...facts] });
function input(state = seed(), userText = '40分くらい') : WeeklyPlanningVNextInterpretationInput {
  const projection = projectWeeklyPlanningVNext(state);
  return { state, projection, presentedQuestion: projection.questions[0], presentedText: '数学の残り8ページの所要時間は？',
    userText, clock, client: {} as never };
}
const fullResult: WeeklyPlanningVNextInterpretation = { status: 'interpreted', planningIntent: 'unknown' as const, delta: empty(), answer: null,
  metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
const decision = (kind: 'effort_answer' | 'quantity_role_answer' | 'fallback', per = false) => ({ decision: kind,
  effortTarget: kind === 'effort_answer' ? 'question_target' : null,
  effortMeasurement: kind === 'effort_answer' ? per ? 'duration_per_unit' : 'total_duration' : null,
  minutes: kind === 'effort_answer' ? per ? 5 : 40 : null, precision: kind === 'effort_answer' ? 'approximate' : null,
  quantityRole: kind === 'quantity_role_answer' ? 'remaining' : null });

describe('VNext uses existing focused contextual purpose and native fallback', () => {
  it.each([false, true])('binds an exact pending total/per-unit answer (per unit=%s) through V5 prompt/schema/parser', async per => {
    const params = input();
    const fullReading = vi.fn(async () => fullResult);
    params.client = { createChatCompletion: vi.fn(async request => {
      expect(request.responseFormat).toBe(FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5);
      expect(request.decisionContext).toMatchObject({ purpose: 'focused_contextual_answer_v2',
        state: { currentUserText: params.userText, pendingQuestion: { target: { workload: { quantityRole: 'remaining', amount: 8 } } } } });
      expect(JSON.stringify(request.decisionContext)).not.toContain('vnext:[');
      expect(request.purpose).toBe('weekly_planning_semantic_normalizer');
      return JSON.stringify(decision('effort_answer', per));
    }) };
    const result = await createWeeklyPlanningVNextFocusedInterpreter({ fullReading })(params);
    expect(fullReading).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'interpreted', answer: null, metrics: { calls: 1 } });
    if (result.status !== 'interpreted') throw new Error('not interpreted');
    const state = apply(params.state, result.delta);
    expect(state.graph.effortEstimates[0]).toMatchObject({ kind: per ? 'duration_per_unit' : 'total_duration', precision: 'approximate' });
    expect(projectWeeklyPlanningVNext(state).owners[0].work[0].minutes).toBe(40);
    expect(state.graph.workloads).toHaveLength(1);
  });

  it('presents derived remaining work, never the stored whole, as the focused target', async () => {
    const params = input(seed([work('total', 'scope_total', 20), work('done', 'completed', 12)]));
    params.client = { async createChatCompletion(request) {
      expect(request.decisionContext).toMatchObject({ state: { pendingQuestion: { target: { workload: { quantityRole: 'remaining', amount: 8 } } } } });
      return JSON.stringify(decision('effort_answer'));
    } };
    const result = await createWeeklyPlanningVNextFocusedInterpreter({ fullReading: async () => { throw new Error('unexpected fallback'); } })(params);
    if (result.status !== 'interpreted') throw new Error('not interpreted');
    expect(apply(params.state, result.delta).graph.workloads.map(item => item.quantityRole)).toEqual(['scope_total', 'completed']);
  });

  it('applies only the exact pending quantity role as one ordinary patch', async () => {
    const params = input(seed([work('declared', 'declared', 8)]), '残りです');
    params.client = { createChatCompletion: async () => JSON.stringify(decision('quantity_role_answer')) };
    const result = await createWeeklyPlanningVNextFocusedInterpreter({ fullReading: async () => { throw new Error('unexpected fallback'); } })(params);
    if (result.status !== 'interpreted') throw new Error('not interpreted');
    expect(result.delta.patch).toHaveLength(1);
    expect(apply(params.state, result.delta).graph.workloads[1]).toMatchObject({ quantityRole: 'remaining', amount: 8 });
  });

  it.each(['abstain', 'shape', 'transport', 'stale', 'extra meaning', 'unavailable estimate target'] as const)(
    'falls back to native Luna with the complete unchanged input for %s', async failure => {
      const params = input(undefined, '40分。あと英語も30分やりたいです');
      const fullReading = vi.fn(async () => fullResult);
      params.client = { async createChatCompletion() {
        if (failure === 'transport') throw new Error('synthetic transport failure');
        if (failure === 'stale') params.state.graph.revision++;
        if (failure === 'shape') return '{}';
        if (failure === 'unavailable estimate target') return JSON.stringify({ ...decision('effort_answer'), effortTarget: 'estimate_target' });
        return JSON.stringify(decision(failure === 'abstain' || failure === 'extra meaning' ? 'fallback' : 'effort_answer'));
      } };
      const result = await createWeeklyPlanningVNextFocusedInterpreter({ fullReading })(params);
      expect(fullReading).toHaveBeenCalledExactlyOnceWith(params);
      expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2 } });
    });

  it('keeps session/proposal questions and a missing presentation on the full-reading path', async () => {
    for (const change of [{ presentedText: null }, { presentedQuestion: { ...input().presentedQuestion!, effortMeasurement: 'session_duration' as const } }]) {
      const params = { ...input(), ...change };
      const createChatCompletion = vi.fn(); params.client = { createChatCompletion };
      const fullReading = vi.fn(async () => fullResult);
      await createWeeklyPlanningVNextFocusedInterpreter({ fullReading })(params);
      expect(createChatCompletion).not.toHaveBeenCalled();
      expect(fullReading).toHaveBeenCalledExactlyOnceWith(params);
    }
  });

  it('retains the complete component chain in the V5 bound target', async () => {
    const state = seed([{ kind: 'component', localId: 'book', taskRef: { localId: 't' }, parentComponentRef: null, role: 'material', label: '問題集' },
      { kind: 'component', localId: 'chapter', taskRef: { localId: 't' }, parentComponentRef: { localId: 'book' }, role: 'chapter', label: '第2章' },
      { ...work('w', 'remaining', 8), componentRef: { localId: 'chapter' } } as VNextAddFact]);
    const params = input(state);
    params.client = { async createChatCompletion(request) {
      expect(request.decisionContext).toMatchObject({ state: { pendingQuestion: { target: { componentChain: [
        { role: 'material', label: '問題集' }, { role: 'chapter', label: '第2章' }] } } } });
      return JSON.stringify(decision('effort_answer'));
    } };
    expect((await createWeeklyPlanningVNextFocusedInterpreter({ fullReading: async () => { throw new Error('unexpected fallback'); } })(params)).status).toBe('interpreted');
  });
});

describe('V5 temporal repair has no equivalent VNext intermediate', () => {
  it('accepts date-only rules, rejects clock-bearing rules, and accepts ordinary unavailability', async () => {
    const rule = { kind: 'task_date_rule', localId: 'date', taskRef: { factId: 'F1' }, targetRef: { factId: 'F1' },
      ruleKind: 'excluded_date', dateExpression: 'weekday:tuesday', constraintLevel: 'hard' };
    const wire = (fact: unknown) => ({ planningIntent: 'discuss', conversationActs: [], delta: { ...empty(), add: [fact] }, answer: null });
    expect(decodeVNextProviderOutput(wire(rule)).status).toBe('decoded');
    expect(decodeVNextProviderOutput(wire({ ...rule, startTime: '18:00', endTime: '20:00' })).status).toBe('rejected');
    expect(decodeVNextProviderOutput(wire({ kind: 'temporal_constraint', localId: 'date', taskRef: { factId: 'F1' }, targetRef: { factId: 'F1' },
      constraintKind: 'excluded_date', constraintLevel: 'hard', dateExpression: 'weekday:tuesday', namedTimePeriod: null,
      startTime: '18:00', endTime: '20:00', precision: 'exact' })).status).toBe('rejected');
    const availability = { kind: 'availability_declaration', localId: 'busy', availabilityKind: 'unavailable',
      dateExpression: 'weekday:tuesday', namedTimePeriod: null, startTime: '18:00', endTime: '20:00', recurrenceKind: null,
      days: [], capacityMinutes: null, constraintLevel: 'hard' };
    const result = await createWeeklyPlanningVNextProviderInterpreter()({ ...input(), presentedQuestion: null, presentedText: null,
      userText: '火曜日の18時から20時は予定があるので避けてください', client: { async createChatCompletion() { return JSON.stringify(wire(availability)); } } });
    expect(result).toMatchObject({ status: 'interpreted', delta: { add: [availability] } });
  });
});

describe('VNext candidates use the existing authenticated candidate_choice purpose', () => {
  it('sends the actual VNext menu in the existing Worker envelope, with a synthetic transport and unchanged frozen semantic caps', async () => {
    const params = input(seed([work('total', 'scope_total', 20), work('done', 'completed', 12), work('left', 'remaining', 7)]));
    const question = params.presentedQuestion!;
    const basis = await vnextOptionChoiceBasis({ ownerId: 'owner', conversationId: 'c', graphRevision: params.state.graph.revision,
      question, presentation: presentWeeklyPlanningVNextQuestion(params.state, question) });
    const manifest = await createCandidateManifest(basis);
    const request = { wholeUtterance: '計算した残りを使います', requestId: manifest.binding.requestId, selectionEpoch: manifest.binding.selectionEpoch,
      candidateSetHash: manifest.candidateSetHash, context: projectCandidateProviderContext(manifest), menu: buildCandidateHierarchy(manifest, 2).menu };
    let body: unknown;
    const result = await createCandidateChoiceClient({ proxyUrl: 'https://synthetic.invalid', getToken: async () => 'dummy-token',
      semanticPolicy: { calibrationEvidenceId: 'frozen-vnext-policy', maximumConditionChange: 0.36, maximumIndependentMeaning: 0.69 },
      transport: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer dummy-token' });
        return Response.json({ status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
          requestId: request.requestId, selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
          nodeId: request.menu.nodeId, optionId: request.menu.options[0].id, conditionChange: 0, independentMeaning: 0,
          probabilities: request.menu.options.map((option, index) => ({ optionId: option.id, probability: index === 0 ? 1 : 0 })) });
      } }).choose(request, () => {});
    expect(body).toEqual({ purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: request.wholeUtterance }],
      decisionContext: { purpose: 'candidate_choice', request } });
    expect(JSON.stringify(body)).not.toContain('dummy-token');
    expect(result).toMatchObject({ semanticSufficiency: 'only_candidate_meaning', optionId: request.menu.options[0].id });
  });
});
