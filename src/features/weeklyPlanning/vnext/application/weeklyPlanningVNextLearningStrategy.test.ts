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

  it('retains an earlier method proposal as history while fixed, and presents it again when the work becomes movable', () => {
    const initial = seed('memorization_retrieval', true);
    const records = structuredClone(initial.learningStrategyProposalRecords);
    const taskRef = { factId: initial.graph.tasks[0].id };
    const fixed = apply(initial, { ...empty(), add: [{ kind: 'temporal_constraint', localId: 'fixed',
      taskRef, targetRef: taskRef, constraintKind: 'fixed_interval', constraintLevel: 'hard',
      dateExpression: '2026-11-03', namedTimePeriod: null, startTime: '10:00', endTime: '10:30', precision: 'exact' }] });
    expect(fixed.learningStrategyProposalRecords).toEqual(records);
    expect(projectWeeklyPlanningVNext(fixed).questions).toEqual([]);
    const fixedCompilation = compileGenericSchedulerInput({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(fixed.graph), context });
    expect(fixedCompilation.status).toBe('ready');
    expect(fixedCompilation.input!.movableWorkItems).toEqual([]);

    const movable = apply(fixed, { ...empty(), remove: [{ targetFactId: fixed.graph.temporalConstraints[0].id }] });
    expect(movable.learningStrategyProposalRecords).toEqual(records);
    expect(projectWeeklyPlanningVNext(movable).questions[0]).toMatchObject({ code: 'learning_strategy_proposal',
      proposal: { id: records[0].id, status: 'pending' } });
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

  it.each([true, false])('keeps distinct work under the trial owner, including its unresolved estimate (rate=%s)', withRate => {
    let state = decide(answer(decide(seed(), 'accept'), { kind: 'session_minutes', minutes: 20 }), 'accept');
    const trialId = state.graph.workloads[0].id;
    const taskRef = { factId: state.graph.tasks[0].id };
    state = apply(state, { ...empty(), add: [
      { ...work, localId: 'distinct-work', taskRef, amount: 200, unitCode: 'word', unitLabel: '語' },
      ...(withRate ? [{ kind: 'effort_estimate' as const, localId: 'distinct-rate', taskRef,
        targetRef: { localId: 'distinct-work' }, effortKind: 'duration_per_unit' as const,
        minutes: 1, unitCode: 'word' as const, unitLabel: '語', precision: 'exact' as const }] : []),
    ], relate: [{ kind: 'distinct', a: { factId: trialId }, b: { localId: 'distinct-work' } }] });
    const projection = projectWeeklyPlanningVNext(state);
    const v5 = compileWeeklyPlanningMemoryCalibrationSchedulerInputV5({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), workloadFactId: trialId,
      sessionMinutes: 20, context, externalSources: [] })!;
    const result = compileWeeklyPlanningVNextSchedulerInput({ state, projection, context });
    expect(projection.owners).toHaveLength(1);
    expect(projection.owners[0].calibration).toEqual({ workloadFactId: trialId, sessionMinutes: 20 });
    expect(state.graph.workloads.map(fact => fact.amount)).toEqual([100, 200]);
    if (withRate) {
      expect(v5.status).toBe('ready');
      expect(result.status).toBe('compiled');
      if (result.status !== 'compiled') throw new Error(result.status);
      const semantics = (compiled: typeof v5) => compiled.input!.movableWorkItems.map(item => ({
        workloadFactId: item.workloadFactId, quantity: item.quantity,
        baseEstimatedMinutes: item.baseEstimatedMinutes, estimatedMinutes: item.estimatedMinutes,
      })).sort((a, b) => a.workloadFactId.localeCompare(b.workloadFactId));
      expect(semantics(result.compilation)).toEqual(semantics(v5));
      expect(result.compilation.input!.movableWorkItems).toHaveLength(2);
      expect(projection.owners[0].work.map(item => item.amount)).toEqual([200]);
    } else {
      expect(v5.status).toBe('needs_resolution');
      expect(v5.issues).toContainEqual(expect.objectContaining({ code: 'missing_effort_estimate', blocking: true }));
      expect(projection.questions[0]).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 200 } });
      expect(result.status).toBe('not_ready');
    }
  });

  it('keeps the original same-basis distinct calibration work end to end like V5 (Astra CALIBRATION_DISTINCT)', () => {
    const initial = apply(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: [
      { kind: 'task', localId: 't', category: 'study', title: 'Memory' },
      { kind: 'study_context', localId: 's', taskRef: { localId: 't' }, purpose: 'self_study', contextLabel: null, activityKind: 'memorization_retrieval' },
      { ...work, unitCode: 'word', unitLabel: '語' },
    ] });
    let state = decide(answer(decide(initial, 'accept'), { kind: 'session_minutes', minutes: 20 }), 'accept');
    const trialId = state.graph.workloads[0].id;
    const taskRef = { factId: state.graph.tasks[0].id };
    state = apply(state, { ...empty(), add: [{ ...work, localId: 'same-basis', amount: 200, unitCode: 'word', unitLabel: '語', taskRef },
      { kind: 'effort_estimate', localId: 'rate', taskRef, targetRef: { localId: 'same-basis' },
        effortKind: 'duration_per_unit', minutes: 1, unitCode: 'word', unitLabel: '語', precision: 'exact' }],
      relate: [{ kind: 'distinct', a: { factId: state.graph.workloads[0].id }, b: { localId: 'same-basis' } }] });
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.questions).toEqual([]);
    const compiled = compile(state);
    const v5 = compileWeeklyPlanningMemoryCalibrationSchedulerInputV5({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph),
      workloadFactId: trialId, sessionMinutes: 20, context, externalSources: [] })!;
    const semantics = (result: typeof compiled) => result.input!.movableWorkItems.map(item => ({ workloadFactId: item.workloadFactId,
      quantity: item.quantity, estimatedMinutes: item.estimatedMinutes,
      observation: 'weeklyPlanningObservationSource' in item ? item.weeklyPlanningObservationSource : undefined }))
      .sort((a, b) => a.workloadFactId.localeCompare(b.workloadFactId));
    expect(semantics(compiled)).toEqual(semantics(v5));
    expect(semantics(compiled).map(item => item.estimatedMinutes)).toEqual([20, 225]);
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
        return JSON.stringify({ planningIntent: 'unknown', conversationActs: [], delta: empty(), answer: { kind: 'proposal_decision', proposalId: context.presentedQuestion.proposal.id, decision: 'accept' } });
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
        return JSON.stringify({ planningIntent: call === 0 ? 'create_plan' : 'unknown', conversationActs: [], delta, answer: answers[call++] });
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
      const result = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: `t${i}`,
        userText: i === 0 ? '暗記学習を100項目、今週の計画にしてください。' : 'synthetic typed step', shownRevision });
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

  it.each(['workload', 'task', 'component', 'unstated'] as const)(
    'does not re-ask an already stated session duration after accepting spacing (scope=%s)', async target => {
      let checkpoint: string | null = null;
      let call = 0;
      let saves = 0;
      let approvals = 0;
      const ports: WeeklyPlanningVNextExperimentalPorts = {
        client: { async createChatCompletion(request) {
          const input = JSON.parse(request.messages[1].content);
          const step = call++;
          if (step === 2) return JSON.stringify({ planningIntent: 'discuss', delta: empty(), answer: null,
            conversationActs: [{ kind: 'request_event_registration', targetRef: { factId: input.activeFacts.tasks[0].id } }] });
          const initial = step === 0;
          return JSON.stringify({ planningIntent: initial ? 'create_plan' : 'unknown', conversationActs: [],
            delta: initial ? { ...empty(), add: [
              { kind: 'task', localId: 't', category: 'study', title: '暗記学習' },
              { kind: 'study_context', localId: 's', taskRef: { localId: 't' }, purpose: 'self_study',
                activityKind: 'memorization_retrieval', contextLabel: null },
              ...(target === 'component' ? [{ kind: 'component', localId: 'component', taskRef: { localId: 't' },
                parentComponentRef: null, role: 'chapter', label: '暗記章' }] : []),
              { ...work, ...(target === 'component' ? { componentRef: { localId: 'component' } } : {}) },
              { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 't' }, targetRef: { localId: 'w' },
                effortKind: 'duration_per_unit', minutes: 2, unitCode: 'custom', unitLabel: '項目', precision: 'exact' },
              ...(target === 'unstated' ? [] : [{ kind: 'effort_estimate', localId: 'session', taskRef: { localId: 't' },
                targetRef: { localId: target === 'task' ? 't' : target === 'component' ? 'component' : 'w' }, effortKind: 'session_duration',
                minutes: 20, unitCode: null, unitLabel: null, precision: 'exact' }]),
            ] } : empty(), answer: initial ? null : { kind: 'proposal_decision',
              proposalId: input.presentedQuestion?.proposal?.id, decision: 'accept' } });
        } },
        interpret: createWeeklyPlanningVNextProviderInterpreter(),
        checkpoint: { read: () => checkpoint, write: raw => { checkpoint = raw; } },
        legacyV5Checkpoint: { read: () => null },
        approvalLedger: { read: () => null, write: () => { approvals++; } },
        plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { saves++; throw new Error('Not approved'); } },
        calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
        createRenderer: () => ({ async render() { return { status: 'rendered', text: 'synthetic shown reply', rawResponse: '' }; } }),
        now: () => '2026-11-02T09:00:00Z',
      };
      const scope = { ownerId: 'owner', conversationId: `prior-session-${target}`,
        weekStartDate: context.currentDate, clock, notBeforeTime: '09:00' };
      const first = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports,
        turnId: 'initial', userText: '暗記学習を100項目、1項目2分、1回20分で今週の計画にしてください。', shownRevision: null });
      expect(first.outcome).toBe('applied');
      expect(first.question?.proposal?.kind).toBe('spaced_memory_practice');
      const accepted = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports,
        turnId: 'accept', userText: 'synthetic explicit proposal acceptance', shownRevision: first.graphRevision });
      expect(accepted.outcome).toBe('applied');
      expect(call).toBe(2);
      expect({ saves, approvals }).toEqual({ saves: 0, approvals: 0 });
      const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
      if (read.status !== 'ready') throw new Error('checkpoint did not round-trip');
      const state = read.checkpoint.state;
      expect(state.learningStrategyProposalRecords).toMatchObject([{ kind: 'spaced_memory_practice', status: 'accepted' }]);
      expect(state.graph.workloads.map(fact => fact.amount)).toEqual([100]);
      if (target === 'unstated') {
        expect(accepted.question).toMatchObject({ code: 'missing_effort_estimate', effortMeasurement: 'session_duration' });
        expect(accepted.preview).toBeNull();
        return;
      }
      expect(state.graph.effortEstimates.filter(fact => fact.kind === 'session_duration')).toMatchObject([
        { minutes: 20, targetFactId: target === 'task' ? state.graph.tasks[0].id
          : target === 'component' ? state.graph.components[0].id : state.graph.workloads[0].id },
      ]);
      // The same accepted facts are already sufficient for the shared placement responsibility.
      const comparison = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), context });
      expect(comparison.status).toBe('ready');
      expect(accepted.question).toBeNull();
      expect(accepted.preview!.blocks.length).toBeGreaterThan(0);
      expect(accepted.draftCandidates!.every(candidate => candidate.durationMinutes === 20)).toBe(true);
      expect(accepted.preview!.blocks.map(({ date, startTime, endTime }) => ({ date, startTime, endTime }))).toEqual(
        accepted.draftCandidates!.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })));
      const items = compile(state).input!.movableWorkItems;
      expect(items.every(item => item.estimatedMinutes === 20)).toBe(true);
      expect(items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(100);
      if (target === 'task') {
        // A later fixed registration still needs actual clocks; the known sitting length cannot supply them.
        const registration = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports,
          turnId: 'fixed-registration', userText: 'synthetic explicit fixed registration without clocks', shownRevision: accepted.graphRevision });
        expect(registration.outcome).toBe('applied');
        expect(registration.question).toMatchObject({ code: 'invalid_commitment_interval', taskId: state.graph.tasks[0].id });
        expect(registration.preview).toBeNull();
        const reloaded = readWeeklyPlanningVNextExperimentalSession(scope, ports);
        if (reloaded.status !== 'ready') throw new Error('checkpoint did not round-trip');
        expect(reloaded.checkpoint.state.pendingEventRegistrationTargetIds).toEqual([state.graph.tasks[0].id]);
        expect(reloaded.checkpoint.state.graph.effortEstimates.filter(fact => fact.kind === 'session_duration')).toEqual(
          state.graph.effortEstimates.filter(fact => fact.kind === 'session_duration'));
        expect({ saves, approvals, call }).toEqual({ saves: 0, approvals: 0, call: 3 });
      }
    });

  it.each(['other-task', 'conflict'] as const)('keeps a necessary session question when scope is unresolved (%s)', scope => {
    let state = seed('memorization_retrieval', true);
    const taskId = state.graph.tasks[0].id;
    state = apply(state, { ...empty(), add: [
      ...(scope === 'other-task' ? [{ kind: 'task' as const, localId: 'other', category: 'study' as const, title: '別学習' }] : []),
      { kind: 'effort_estimate', localId: 'session', taskRef: scope === 'other-task' ? { localId: 'other' } : { factId: taskId },
        targetRef: scope === 'other-task' ? { localId: 'other' } : { factId: taskId },
        effortKind: 'session_duration', minutes: 20, unitCode: null, unitLabel: null, precision: 'exact' },
      ...(scope === 'conflict' ? [{ kind: 'effort_estimate' as const, localId: 'conflict', taskRef: { factId: taskId },
        targetRef: { factId: taskId }, effortKind: 'session_duration' as const, minutes: 30,
        unitCode: null, unitLabel: null, precision: 'exact' as const }] : []),
    ] });
    state = decide(state, 'accept');
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.questions[0]).toMatchObject({ code: 'missing_effort_estimate', effortMeasurement: 'session_duration' });
    expect(compileWeeklyPlanningVNextSchedulerInput({ state, projection, context }).status).toBe('not_ready');
  });

  it('does not offer provisional placement for an unanswered session-duration question', async () => {
    const state = decide(seed(), 'accept');
    const question = projectWeeklyPlanningVNext(state).questions[0];
    expect(question).toMatchObject({ code: 'missing_effort_estimate', effortMeasurement: 'session_duration' });
    expect(question.key.startsWith('memory_session_duration:')).toBe(true);
    let raw = serializeWeeklyPlanningVNextSessionCheckpoint({ ownerId: 'owner', weekStartDate: context.currentDate,
      conversationId: 'c', vnext: { state, presentedQuestion: {
        questionKey: question.key, graphRevision: state.graph.revision, shownText: '1回の時間を教えてください。',
      }, preview: null, messages: [] }, savedAt: '2026-11-02T09:00:00Z' })!;
    const ports: WeeklyPlanningVNextExperimentalPorts = {
      client: { async createChatCompletion() { throw new Error('unexpected provider call'); } },
      interpret: async () => ({ status: 'interpreted', planningIntent: 'unknown', delta: empty(), answer: null,
        metrics: { calls: 1, repairs: 0, latencyMs: 1 } }),
      checkpoint: { read: () => raw, write: value => { raw = value; } },
      legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: () => { throw new Error('unexpected approval'); } },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('unexpected save'); } },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      createRenderer: () => ({ async render(input) { return { status: 'rendered', rawResponse: '',
        text: JSON.stringify({ goal: input.communication?.goal, requiredLabels: input.requiredLabels }) }; } }),
      now: () => '2026-11-02T09:00:00Z',
    };
    const scope = { ownerId: 'owner', conversationId: 'c', weekStartDate: context.currentDate, clock, notBeforeTime: '09:00' };
    let third: Awaited<ReturnType<typeof submitWeeklyPlanningVNextExperimentalTurn>> | null = null;
    for (let i = 1; i <= 3; i++) {
      third = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: `unanswered-${i}`,
        userText: 'まだ答えていません', shownRevision: JSON.parse(raw).vnext.presentedQuestion.graphRevision });
      expect(third.outcome).toBe('noop');
      expect(third.question?.key).toBe(question.key);
    }
    expect(JSON.parse(raw).vnext.unansweredQuestionStreak.count).toBe(3);
    const presentation = JSON.parse(third!.reply);
    expect(presentation.requiredLabels).not.toContain('所要時間はまだ分からないので、仮置きで予定を組んで見せて');
    expect(presentation.goal).toBe('ask_question');

    const providerPorts: WeeklyPlanningVNextExperimentalPorts = { ...ports,
      interpret: createWeeklyPlanningVNextProviderInterpreter(),
      client: { async createChatCompletion(request) {
        const input = JSON.parse(request.messages[1].content);
        expect(input.userText).toBe('後で決める');
        return JSON.stringify({ planningIntent: 'unknown', conversationActs: [], answer: null,
          delta: { ...empty(), defer: [{ questionKey: input.openQuestions[0].key, allocation: 'none' }] } });
      } },
    };
    const deferred = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: providerPorts, turnId: 'defer-session',
      userText: '後で決める', shownRevision: JSON.parse(raw).vnext.presentedQuestion.graphRevision });
    expect(deferred.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
    expect(deferred.outcome).toBe('applied');
    expect(JSON.parse(raw).vnext.state.deferrals).toContainEqual(expect.objectContaining({ questionKey: question.key,
      allocation: 'none' }));
  });
});
