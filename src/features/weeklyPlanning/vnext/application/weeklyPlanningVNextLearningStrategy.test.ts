import { describe, expect, it } from 'vitest';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import type { WeeklyPlanningVNextInterpretedAnswer } from '../weeklyPlanningVNextInterpretationContract';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput } from '../projection/weeklyPlanningVNextSchedulerGraph';
import { resolveWeeklyPlanningVNextTurnDelta } from './weeklyPlanningVNextAnswerBinding';
import { parseWeeklyPlanningVNextSessionCheckpoint, serializeWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { compileWeeklyPlanningMemoryCalibrationSchedulerInputV5 } from '../weeklyPlanningVNextV5Boundary';
import { vnextUnitIdentity } from '../weeklyPlanningVNextWorkIdentity';
import { submitWeeklyPlanningVNextExperimentalTurn, readWeeklyPlanningVNextExperimentalSession,
  type WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';

const context = { ownerId: 'owner', currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' };
const horizon = { startDate: context.planningStartDate, endDate: context.planningEndDate };
const clock = { ...context, weekStartsOn: 'monday' as const, defaultPlanningHorizon: horizon };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const work: VNextAddFact = { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null,
  quantityRole: 'target', amount: 100, unitCode: 'custom', unitLabel: '項目', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null };
function apply(state: WeeklyPlanningVNextState, delta: VNextTurnDelta, observedMemoryPace?: Readonly<Record<string, number>>) {
  const result = applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision,
    acceptedDate: context.currentDate, planningHorizon: horizon, defaultPlanningHorizon: horizon, weekStartsOn: 'monday',
    turnId: `turn-${state.graph.revision}`, turnKey: `turn-${state.graph.revision}`, conversationId: 'c', sourceText: 'synthetic typed meaning', observedMemoryPace });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
function seed(activityKind: 'memorization_retrieval' | 'problem_solving' | 'unknown' = 'memorization_retrieval', withRate = false) {
  return apply(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: [
    { kind: 'task', localId: 't', category: 'study', title: '暗記学習' },
    { kind: 'study_context', localId: 'study', taskRef: { localId: 't' }, purpose: 'self_study', contextLabel: '暗記学習', activityKind }, work,
    ...(withRate ? [{ kind: 'effort_estimate' as const, localId: 'rate', taskRef: { localId: 't' }, targetRef: { localId: 'w' },
      effortKind: 'duration_per_unit' as const, minutes: 2, unitCode: 'custom' as const, unitLabel: '項目', precision: 'exact' as const }] : []),
  ] });
}
function answer(state: WeeklyPlanningVNextState, value: WeeklyPlanningVNextInterpretedAnswer, pace?: Readonly<Record<string, number>>) {
  const projection = projectWeeklyPlanningVNext(state, pace);
  const bound = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
    presented: { questionKey: projection.questions[0].key, graphRevision: projection.graphRevision }, projection, graph: state.graph,
    interpreted: { delta: empty(), answer: value } });
  if (bound.status !== 'delta') throw new Error(JSON.stringify(bound));
  return apply(state, bound.delta, pace);
}
function decide(state: WeeklyPlanningVNextState, decision: 'accept' | 'reject', pace?: Readonly<Record<string, number>>) {
  return answer(state, { kind: 'proposal_decision', proposalId: projectWeeklyPlanningVNext(state, pace).questions[0].proposal!.id, decision }, pace);
}
function compile(state: WeeklyPlanningVNextState, multiplier?: number, pace?: Readonly<Record<string, number>>) {
  const result = compileWeeklyPlanningVNextSchedulerInput({ state, projection: projectWeeklyPlanningVNext(state, pace), context,
    estimateCalibrationMultiplier: multiplier });
  if (result.status !== 'compiled') throw new Error('not compiled');
  return result.compilation;
}

describe('VNext learning strategy adapters use V5 policy', () => {
  it('proposes spaced memory practice from stated activity, never from a unit label', () => {
    const state = seed();
    expect(state.learningStrategyProposalRecords).toEqual([expect.objectContaining({ kind: 'spaced_memory_practice', status: 'pending',
      scope: 'week', suggestedSessionMinutes: { min: 15, max: 30 }, workloadFactId: state.graph.workloads[0].id })]);
    expect(state.graph.effortEstimates).toEqual([]);
    expect(projectWeeklyPlanningVNext(state).questions[0].code).toBe('learning_strategy_proposal');
    expect(seed('problem_solving').learningStrategyProposalRecords).toEqual([]);
    expect(seed('unknown').learningStrategyProposalRecords).toEqual([]);
  });

  it('accepts only the fresh presented proposal, and rejection never becomes scheduling policy', () => {
    const state = seed();
    const projection = projectWeeklyPlanningVNext(state);
    const interpreted = { delta: empty(), answer: { kind: 'proposal_decision' as const,
      proposalId: state.learningStrategyProposalRecords[0].id, decision: 'accept' as const } };
    expect(resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: false, presented: { questionKey: projection.questions[0].key,
      graphRevision: projection.graphRevision }, projection, graph: state.graph, interpreted }).status).toBe('represent');
    expect(resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true, presented: { questionKey: projection.questions[0].key,
      graphRevision: projection.graphRevision }, projection, graph: state.graph,
    interpreted: { ...interpreted, answer: { ...interpreted.answer, proposalId: 'not-the-presented-proposal' } } }).status).toBe('represent');
    const rejected = decide(state, 'reject');
    expect(rejected.learningStrategyProposalRecords[0].status).toBe('rejected');
    expect(projectWeeklyPlanningVNext(rejected).questions[0]).toMatchObject({ code: 'missing_effort_estimate' });
    expect(rejected.graph.effortEstimates).toEqual([]);
    expect(projectWeeklyPlanningVNext(rejected).owners.flatMap(owner => owner.work)).toEqual([]);
  });

  it('asks session duration after spacing acceptance, then proposes exactly one pace calibration', () => {
    const accepted = decide(seed(), 'accept');
    expect(projectWeeklyPlanningVNext(accepted).questions[0]).toMatchObject({ code: 'missing_effort_estimate', effortMeasurement: 'session_duration' });
    expect(accepted.learningStrategyProposalRecords).toHaveLength(1);
    const withSession = answer(accepted, { kind: 'session_minutes', minutes: 20 });
    expect(withSession.graph.effortEstimates).toEqual([expect.objectContaining({ kind: 'session_duration', minutes: 20,
      targetFactId: withSession.graph.workloads[0].id })]);
    expect(projectWeeklyPlanningVNext(withSession).questions[0].proposal).toMatchObject({ kind: 'calibrate_memory_pace',
      selectedSessionMinutes: 20, suggestedSessionMinutes: { min: 20, max: 20 } });
    expect(withSession.learningStrategyProposalRecords).toHaveLength(2);
    const rejected = decide(withSession, 'reject');
    expect(projectWeeklyPlanningVNext(rejected).readiness).toBe('needs_resolution');
    expect(projectWeeklyPlanningVNext(rejected).owners[0].calibration).toBeUndefined();
  });

  it('compiles one accepted trial without rewriting full scope or inventing a total estimate', () => {
    const before = answer(decide(seed(), 'accept'), { kind: 'session_minutes', minutes: 20 });
    const state = decide(before, 'accept');
    const snapshot = structuredClone(state);
    const result = compile(state);
    expect(result.status).toBe('ready');
    expect(result.input!.movableWorkItems).toHaveLength(1);
    expect(result.input!.movableWorkItems[0]).toMatchObject({ quantity: { amount: 1, unitCode: 'session', unitLabel: '回' }, estimatedMinutes: 20,
      weeklyPlanningObservationSource: { kind: 'memory_pace_calibration', targetAmount: 100, plannedSessionMinutes: 20 } });
    expect(state).toEqual(snapshot);
    expect(state.graph.workloads).toHaveLength(1);
    expect(state.graph.workloads[0]).toMatchObject({ quantityRole: 'target', amount: 100, unitCode: 'custom', unitLabel: '項目' });
    expect(state.graph.effortEstimates.some(fact => fact.kind === 'total_duration')).toBe(false);
  });

  it('keeps accepted spacing and calibration ids/decisions on a replacement workload', () => {
    let state = decide(answer(decide(seed(), 'accept'), { kind: 'session_minutes', minutes: 20 }), 'accept');
    const ids = state.learningStrategyProposalRecords.map(record => record.id);
    state = apply(state, { ...empty(), patch: [{ kind: 'workload', localId: 'correction', targetFactId: state.graph.workloads[0].id,
      amountDelta: null, changes: { amount: 80, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null,
        perOccurrence: null, periodExpression: null } }] });
    expect(state.learningStrategyProposalRecords.map(record => record.id)).toEqual(ids);
    expect(state.learningStrategyProposalRecords.every(record => record.status === 'accepted'
      && record.workloadFactId === state.graph.workloads[1].id)).toBe(true);
    expect(compile(state).input!.movableWorkItems[0]).toMatchObject({ weeklyPlanningObservationSource: { targetAmount: 80 } });
  });

  it('uses accepted session projection for known pace and never invents a calibration', () => {
    const state = answer(decide(seed('memorization_retrieval', true), 'accept'), { kind: 'session_minutes', minutes: 20 });
    expect(state.learningStrategyProposalRecords).toHaveLength(1);
    const items = compile(state).input!.movableWorkItems;
    expect(items.length).toBeGreaterThan(1);
    expect(items.every(item => item.estimatedMinutes === 20)).toBe(true);
    expect(items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(100);
  });

  it('uses observed pace and asks session length, skipping cold-start calibration like the V5 returning-learner conversation', () => {
    let state = seed();
    const pace = { [vnextUnitIdentity(state.graph.workloads[0])]: 0.5 };
    state = decide(state, 'accept', pace);
    expect(projectWeeklyPlanningVNext(state, pace).questions[0].effortMeasurement).toBe('session_duration');
    state = answer(state, { kind: 'session_minutes', minutes: 20 }, pace);
    expect(state.learningStrategyProposalRecords).toHaveLength(1);
    expect(projectWeeklyPlanningVNext(state, pace).questions).toEqual([]);
    expect(compile(state, undefined, pace).input!.movableWorkItems.every(item => item.estimatedMinutes === 20)).toBe(true);
    expect(state.graph.effortEstimates.map(fact => fact.kind)).toEqual(['session_duration']);
  });

  it('selects V5\'s single relevant trial while another memorization owner is placed normally', () => {
    let state = answer(decide(seed('memorization_retrieval', true), 'accept'), { kind: 'session_minutes', minutes: 20 });
    state = apply(state, { ...empty(), add: [{ kind: 'task', localId: 'second', category: 'study', title: 'Second memory work' },
      { kind: 'study_context', localId: 'second-study', taskRef: { localId: 'second' }, purpose: 'self_study', activityKind: 'memorization_retrieval', contextLabel: null },
      { ...work, localId: 'second-work', taskRef: { localId: 'second' } }] });
    state = decide(state, 'accept');
    state = answer(state, { kind: 'session_minutes', minutes: 15 });
    state = decide(state, 'accept');
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.owners.filter(owner => owner.calibration)).toHaveLength(1);
    const compiled = compile(state);
    const items = compiled.input!.movableWorkItems;
    expect(items.filter(item => item.taskId === state.graph.tasks[0].id).length).toBeGreaterThan(0);
    expect(items.filter(item => item.taskId === state.graph.tasks[1].id)).toMatchObject([
      { quantity: { amount: 1, unitCode: 'session' }, estimatedMinutes: 15 }]);
    expect(compiled.status).toBe('ready');
    expect(state.graph.workloads.map(fact => fact.amount)).toEqual([100, 100]);
    const v5 = compileWeeklyPlanningMemoryCalibrationSchedulerInputV5({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), workloadFactId: state.graph.workloads[1].id,
      sessionMinutes: 15, context, externalSources: [] })!;
    const semantics = (result: typeof compiled) => result.input!.movableWorkItems.map(item => ({
      taskId: item.taskId, quantity: item.quantity, estimatedMinutes: item.estimatedMinutes }));
    expect(semantics(compiled)).toEqual(semantics(v5));
  });

  it('passes a turn-scoped calibration multiplier to the same compiler and does not inherit it', () => {
    const state = seed('problem_solving', true);
    const v5 = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), context, estimateCalibrationMultiplier: 1.2 });
    const amounts = (result: ReturnType<typeof compile>) => result.input!.movableWorkItems.map(item => item.estimatedMinutes);
    expect(amounts(compile(state, 1.2))).toEqual(amounts(v5));
    expect(compile(state).input!.movableWorkItems.every(item => item.calibrationMultiplier === 1)).toBe(true);
  });

  it('decodes proposal/session answers with the request-local reference vocabulary', async () => {
    const state = seed();
    const projection = projectWeeklyPlanningVNext(state);
    const result = await createWeeklyPlanningVNextProviderInterpreter()({ state, projection, presentedQuestion: projection.questions[0],
      presentedText: 'synthetic proposal text', clock, userText: 'synthetic acceptance', client: { async createChatCompletion(request) {
        const context = JSON.parse(request.messages[1].content);
        return JSON.stringify({ delta: empty(), answer: { kind: 'proposal_decision', proposalId: context.presentedQuestion.proposal.id, decision: 'accept' } });
      } } });
    expect(result).toMatchObject({ status: 'interpreted', answer: { kind: 'proposal_decision', proposalId: state.learningStrategyProposalRecords[0].id } });
  });

  it('round-trips proposal decisions; older checkpoints start empty and malformed records fail closed', () => {
    const state = decide(seed(), 'accept');
    const raw = serializeWeeklyPlanningVNextSessionCheckpoint({ ownerId: 'owner', weekStartDate: context.currentDate, conversationId: 'c',
      savedAt: '2026-11-02T09:00:00Z', vnext: { state, presentedQuestion: null, preview: null, messages: [] } })!;
    const parse = (raw: string) => parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: 'owner', weekStartDate: context.currentDate });
    expect(parse(raw)!.vnext.state.learningStrategyProposalRecords).toEqual(state.learningStrategyProposalRecords);
    const older = JSON.parse(raw);
    delete older.vnext.state.learningStrategyProposalRecords;
    expect(parse(JSON.stringify(older))!.vnext.state.learningStrategyProposalRecords).toEqual([]);
    older.vnext.state.learningStrategyProposalRecords = [{}];
    expect(parse(JSON.stringify(older))).toBeNull();
  });

  it('connects native answers through the actual session, V5 renderer input and persisted calibration preview', async () => {
    let checkpoint: string | null = null;
    let call = 0;
    const intents: unknown[] = [];
    const ports: WeeklyPlanningVNextExperimentalPorts = {
      client: { async createChatCompletion(request) {
        const data = JSON.parse(request.messages[1].content);
        const answers = [null, { kind: 'proposal_decision', proposalId: data.presentedQuestion?.proposal?.id, decision: 'accept' },
          { kind: 'session_minutes', minutes: 20 }, { kind: 'proposal_decision', proposalId: data.presentedQuestion?.proposal?.id, decision: 'accept' }];
        const delta = call === 0 ? { ...empty(), add: [
          { kind: 'task', localId: 't', category: 'study', title: '暗記学習' },
          { kind: 'study_context', localId: 's', taskRef: { localId: 't' }, purpose: 'self_study', activityKind: 'memorization_retrieval', contextLabel: null }, work] } : empty();
        return JSON.stringify({ delta, answer: answers[call++] });
      } },
      interpret: createWeeklyPlanningVNextProviderInterpreter(),
      checkpoint: { read: () => checkpoint, write: raw => { checkpoint = raw; } }, legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: () => {} },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('Not approved'); } },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      createRenderer: () => ({ async render(input) { intents.push(input.questionIntent); return { status: 'rendered', text: 'synthetic shown reply', rawResponse: '' }; } }),
      now: () => '2026-11-02T09:00:00Z',
    };
    const scope = { ownerId: 'owner', conversationId: 'session-c', weekStartDate: context.currentDate, clock, notBeforeTime: '09:00' };
    let shownRevision: number | null = null;
    const results = [];
    for (let i = 0; i < 4; i++) {
      const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: `t${i}`, userText: 'synthetic typed step', shownRevision });
      expect(result.outcome).toBe('applied');
      shownRevision = result.graphRevision;
      results.push(result);
    }
    expect(results[0].question?.proposal?.kind).toBe('spaced_memory_practice');
    expect(results[1].question?.effortMeasurement).toBe('session_duration');
    expect(results[2].question?.proposal?.kind).toBe('calibrate_memory_pace');
    expect(results[3].preview!.blocks).toHaveLength(1);
    expect(intents[0]).toMatchObject({ kind: 'learning_strategy_proposal', proposalKind: 'spaced_memory_practice' });
    expect(intents[1]).toMatchObject({ kind: 'effort_measurement', measurement: 'session_duration' });
    const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
    if (read.status !== 'ready') throw new Error('checkpoint did not round-trip');
    expect(read.checkpoint.state.learningStrategyProposalRecords.every(record => record.status === 'accepted')).toBe(true);
    expect(read.checkpoint.state.graph.workloads.map(fact => fact.amount)).toEqual([100]);
    expect(read.checkpoint.preview!.blocks[0]).toHaveProperty('behaviorMetadata.weeklyPlanningObservationSource');
    expect(call).toBe(4);
  });
});
