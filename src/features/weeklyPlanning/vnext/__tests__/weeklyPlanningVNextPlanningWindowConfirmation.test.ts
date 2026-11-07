import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { decodeVNextProviderOutput } from '../semantic/weeklyPlanningVNextProviderSchema';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput, createWeeklyPlanningVNextSchedulerContext } from '../projection/weeklyPlanningVNextSchedulerGraph';
import { scheduleWeeklyPlanningStableV5Preview } from '../weeklyPlanningVNextV5Boundary';
import type { VNextAddFact, VNextPlanningWindowYearBasis, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { submitWeeklyPlanningVNextExperimentalTurn, readWeeklyPlanningVNextExperimentalSession,
  type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from '../application/weeklyPlanningVNextExperimentalSession';
import { approveWeeklyPlanningVNextExperimentalPreview } from '../application/weeklyPlanningVNextExperimentalApproval';
import { validateWeeklyPlanningFactGraphValueV5 } from '../../semantic/weeklyPlanningFactGraphValidatorV5';

const CURRENT = '2026-10-29';
const START = '2026-10-30';
const END = '2027-09-07';
const delta = (add: VNextAddFact[]) => ({ add, patch: [], remove: [], relate: [], defer: [] });
const basis = (start: string, end: string, origin: 'explicit' | 'context' | 'inferred' = 'explicit'): VNextPlanningWindowYearBasis => ({
  start: { origin, source: 'user_text', reference: start }, end: { origin, source: 'user_text', reference: end },
});
const facts = (start = START, end = END): VNextAddFact[] => [
  { kind: 'planning_window', localId: 'period', windowKind: 'absolute', value: `${start}/${end}`, start, end, yearBasis: basis(start, end) },
  { kind: 'task', localId: 'math', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'daily-work', taskRef: { localId: 'math' }, componentRef: null,
    quantityRole: 'target', amount: 45, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
    perOccurrence: true, periodExpression: null },
  { kind: 'recurrence', localId: 'daily', taskRef: { localId: 'math' }, targetRef: { localId: 'math' },
    recurrenceKind: 'daily', count: null, days: [] },
];

function accepted(start = START, end = END, yearBasis: VNextPlanningWindowYearBasis | null = basis(start, end),
  sourceText = `${start}から${end}まで毎日45分の数学`): WeeklyPlanningVNextState {
  const add = facts(start, end).map(fact => fact.kind === 'planning_window' ? { ...fact, yearBasis } : fact);
  const applied = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta(add), {
    expectedRevision: 0, acceptedDate: CURRENT, weekStartsOn: 'monday',
    planningHorizon: { startDate: '2026-10-26', endDate: '2026-11-01' },
    defaultPlanningHorizon: { startDate: '2026-10-26', endDate: '2026-11-01' },
    conversationId: 'window-confirmation', turnId: 'period', turnKey: 'period', sourceText,
  });
  expect(applied.status).toBe('applied');
  if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
  return applied.state;
}

function context(state: WeeklyPlanningVNextState) {
  return createWeeklyPlanningVNextSchedulerContext({ state, ownerId: 'owner', selectedDate: '2026-10-26',
    requestContext: { currentDate: CURRENT, currentTime: '09:00', notBeforeDate: CURRENT, notBeforeTime: '09:00',
      timeZone: 'Asia/Tokyo', weekStartsOn: 'monday', startedAtIso: `${CURRENT}T00:00:00.000Z` } });
}

describe('planning-window year confirmation (#914)', () => {
  it.each([
    { name: 'missing', yearBasis: null },
    { name: 'inferred', yearBasis: basis(START, END, 'inferred') },
    { name: 'foreign evidence', yearBasis: basis('not in the utterance', 'also absent') },
  ])('requires confirmation for $name year evidence even without model uncertainty', ({ yearBasis }) => {
    const state = accepted(START, END, yearBasis);
    expect(state.graph.uncertainties).toEqual([]);
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection).toMatchObject({ readiness: 'needs_resolution', questions: [expect.objectContaining({ code: 'semantic_uncertainty' })] });
    expect(compileWeeklyPlanningVNextSchedulerInput({ state, projection, context: context(state) }).status).toBe('not_ready');
    expect(state.graph.workloads[0]).toMatchObject({ amount: 45, perOccurrence: true });
  });

  it('keeps an ordinary year boundary established by context without imposing a day limit', () => {
    const start = '2026-12-28'; const end = '2027-01-03';
    expect(projectWeeklyPlanningVNext(accepted(start, end, basis('12/28', '1/3', 'context'), '12/28から1/3まで数学を毎日45分')))
      .toMatchObject({ readiness: 'ready', questions: [] });
  });

  it.each([false, true])('only reuses a planning horizon with verified year evidence (verified=%s)', verified => {
    const state = accepted(START, END, verified ? basis(START, END) : null);
    const endpoint = { origin: 'context' as const, source: 'planning_horizon' as const, reference: `${START}/${END}` };
    const result = applyWeeklyPlanningVNextTurn(state, { ...delta([]), patch: [{ kind: 'planning_window', localId: 'context-proof',
      targetFactId: state.graph.planningWindows[0].id, changes: { windowKind: null, value: null, start: null, end: null,
        yearBasis: { start: endpoint, end: endpoint } } }] }, {
      expectedRevision: state.graph.revision, acceptedDate: CURRENT, weekStartsOn: 'monday',
      planningHorizon: { startDate: START, endDate: END }, defaultPlanningHorizon: { startDate: '2026-10-26', endDate: '2026-11-01' },
      conversationId: 'window-confirmation', turnId: 'context', turnKey: 'context', sourceText: '今の期間で続けて',
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(JSON.stringify(result));
    expect(projectWeeklyPlanningVNext(result.state).readiness).toBe(verified ? 'ready' : 'needs_resolution');
  });

  it.each([
    { start: START, end: '2026-11-07', count: 9 },
    { start: '2026-12-30', end: '2027-01-05', count: 7 },
    { start: START, end: END, count: 313 },
    { start: START, end: START, count: 1 },
  ])('keeps an unambiguous stated window $start through $end without an arbitrary day limit', ({ start, end, count }) => {
    const state = accepted(start, end);
    const projection = projectWeeklyPlanningVNext(state);
    const compiled = compileWeeklyPlanningVNextSchedulerInput({ state, projection, context: context(state) });
    expect(compiled.status).toBe('compiled');
    if (compiled.status !== 'compiled' || compiled.compilation.status !== 'ready' || !compiled.compilation.input) {
      throw new Error(JSON.stringify(compiled));
    }
    const scheduled = scheduleWeeklyPlanningStableV5Preview({ input: compiled.compilation.input,
      graph: compiled.placementGraph, plans: [], monthEvents: [], scheduleTemplates: [],
      notBefore: { date: CURRENT, time: '09:00' } });
    expect(scheduled.status).toBe('ready');
    if (scheduled.status === 'ready') expect(scheduled.candidates).toHaveLength(count);
  });

  it('can admit the semantic uncertainty about a planning window rather than silently committing its inferred year', () => {
    const reading = { planningIntent: 'create_plan', conversationActs: [], answer: null,
      delta: { ...delta(facts()), add: [...facts(), { kind: 'uncertainty', localId: 'year-question',
        targetRef: { localId: 'period' }, field: 'planning_window', reason: '年が省略され、翌年までの期間を意図するか不明' }] } };
    expect(decodeVNextProviderOutput(reading).status).toBe('decoded');
  });

  it('treats a recorded provider reading without the new evidence as unverified instead of trusting its absolute years', () => {
    const add = facts().map(fact => {
      if (fact.kind !== 'planning_window') return fact;
      const { yearBasis: _oldMissingField, ...oldWindow } = fact;
      return oldWindow;
    });
    const decoded = decodeVNextProviderOutput({ planningIntent: 'create_plan', conversationActs: [], answer: null,
      delta: { ...delta([]), add } });
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') throw new Error(JSON.stringify(decoded));
    const window = decoded.reading.delta.add.find(fact => fact.kind === 'planning_window');
    expect(window?.kind).toBe('planning_window');
    if (window?.kind !== 'planning_window') throw new Error('Expected the retained period');
    expect(window.yearBasis).toBeNull();
    expect(projectWeeklyPlanningVNext(accepted(START, END, window.yearBasis))).toMatchObject({
      readiness: 'needs_resolution', questions: [expect.objectContaining({ code: 'semantic_uncertainty' })],
    });
  });

  it('projects a saved planning-window uncertainty as a required question before scheduling, retaining the work', () => {
    const state = accepted();
    const window = state.graph.planningWindows[0];
    state.graph.uncertainties.push({ id: 'year-question', targetFactId: window.id,
      field: 'planning_window', reason: '翌年までの期間を意図するか確認', source: window.source, createdRevision: state.graph.revision });
    state.graph.factLifecycles.push({ factId: 'year-question', status: 'active',
      createdRevision: state.graph.revision, terminalRevision: null, supersededByFactId: null });
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.questions).toEqual([expect.objectContaining({ code: 'semantic_uncertainty', subjectLineageIds: ['year-question'] })]);
    expect(projection.readiness).toBe('needs_resolution');
    expect(compileWeeklyPlanningVNextSchedulerInput({ state, projection, context: context(state) }).status).toBe('not_ready');
    expect(state.graph.workloads[0]).toMatchObject({ amount: 45, perOccurrence: true });
  });

  it.each([true, false].flatMap(withUncertainty => [{ end: '2026-11-07', count: 9, withUncertainty }, { end: END, count: 313, withUncertainty }]))(
    'reloads, blocks deferred preview and approves $count plans once (model uncertainty=$withUncertainty)', async ({ end, count, withUncertainty }) => {
      const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: 'owner', weekStartDate: '2026-10-26',
        conversationId: 'period-question-session', notBeforeTime: '09:00', clock: { currentDate: CURRENT,
          planningStartDate: '2026-10-26', planningEndDate: '2026-11-01', weekStartsOn: 'monday', timeZone: 'Asia/Tokyo' } };
      const slots = new Map<string, string>();
      const slot = (key: string) => ({ read: () => slots.get(key) ?? null, write: (raw: string) => { slots.set(key, raw); } });
      const saved = new Set<string>();
      let saveCalls = 0;
      let turns = 0;
      const ports: WeeklyPlanningVNextExperimentalPorts = {
        client: { createChatCompletion: async () => { throw new Error('No model call in typed lifecycle test'); } },
        interpret: async input => {
          turns++;
          const changes = turns === 1 ? delta([...facts(), ...(withUncertainty ? [{ kind: 'uncertainty' as const, localId: 'year-question',
            targetRef: { localId: 'period' }, field: 'planning_window' as const, reason: '対象期間の年を確認' }] : [])]) : turns === 2 ? {
            ...delta([]), defer: [{ questionKey: input.presentedQuestion!.key, allocation: 'none' as const }],
          } : {
            ...delta([]), patch: [{ kind: 'planning_window' as const, localId: 'confirmed-period',
              targetFactId: input.state.graph.planningWindows[0].id,
              changes: { windowKind: 'absolute' as const, value: `${START}/${end}`, start: START, end, yearBasis: basis(START, end) } }],
            remove: input.state.graph.uncertainties.map(uncertainty => ({ targetFactId: uncertainty.id })),
          };
          if (turns === 2) expect(input.presentedQuestion?.code).toBe('semantic_uncertainty');
          return { status: 'interpreted', planningIntent: 'create_plan', conversationActs: [], answer: null,
            delta: changes, metrics: { calls: 1, repairs: 0, latencyMs: 0 } };
        },
        checkpoint: slot('checkpoint'), legacyV5Checkpoint: { read: () => null }, approvalLedger: slot('approval'),
        calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
        plans: { findExistingPlanId: async id => saved.has(id) ? `plan:${id}` : undefined,
          saveBlock: async block => { saveCalls++; saved.add(block.id); return { planId: `plan:${block.id}` }; } },
        createRenderer: () => ({ render: async input => ({ status: 'rendered', text: `typed:${input.questionCode ?? input.actionKind}`, rawResponse: '' }) }),
        now: () => `${CURRENT}T00:00:00.000Z`,
      };
      const first = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'first',
        userText: '明日から9/7まで数学を毎日45分', shownRevision: null });
      expect(first).toMatchObject({ readiness: 'needs_resolution', preview: null, question: { code: 'semantic_uncertainty' } });
      expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports })).toEqual({ status: 'rejected', reason: 'no-shown-preview' });
      const restored = readWeeklyPlanningVNextExperimentalSession(scope, ports);
      expect(restored.status).toBe('ready');
      if (restored.status !== 'ready') throw new Error('Expected the saved period question');
      expect(restored.checkpoint.presentedQuestion?.questionKey).toBe(first.question!.key);
      expect(restored.checkpoint.state.graph.workloads[0]).toMatchObject({ amount: 45, perOccurrence: true });
      expect(restored.checkpoint.state.graph.planningWindows[0].yearBasis?.end.verified).toBe(false);
      const deferred = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'deferred',
        userText: '年は後で確認するので、今の情報で予定を作って', shownRevision: first.graphRevision });
      expect(deferred).toMatchObject({ readiness: 'needs_resolution', preview: null });
      expect(saveCalls).toBe(0);
      expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports })).toEqual({ status: 'rejected', reason: 'no-shown-preview' });
      const confirmed = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'confirmed',
        userText: `${START}から${end}です`, shownRevision: deferred.graphRevision });
      expect(confirmed).toMatchObject({ readiness: 'ready', question: null, previewBlockedBy: [] });
      expect(confirmed.preview?.blocks).toHaveLength(count);
      expect(saveCalls).toBe(0);
      if (end === END) {
        const raw = slots.get('checkpoint')!;
        const old = JSON.parse(raw);
        for (const window of old.vnext.state.graph.planningWindows) delete window.yearBasis;
        slots.set('checkpoint', JSON.stringify(old));
        expect(readWeeklyPlanningVNextExperimentalSession(scope, ports).status).toBe('ready');
        expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports }))
          .toEqual({ status: 'rejected', reason: 'planning-window-unconfirmed' });
        expect(saveCalls).toBe(0);
        slots.set('checkpoint', raw);
      }
      expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports })).toMatchObject({ status: 'executed' });
      expect(saved.size).toBe(count);
      expect(saveCalls).toBe(count);
      await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
      expect(saveCalls).toBe(count);
      const final = readWeeklyPlanningVNextExperimentalSession(scope, ports);
      expect(final.status).toBe('ready');
      if (final.status === 'ready') {
        // The unchanged shared fact reader tolerates the optional per-window extension.
        expect(validateWeeklyPlanningFactGraphValueV5(final.checkpoint.state.graph).graph).not.toBeNull();
        expect(final.checkpoint.state.graph.factLifecycles.filter(fact => fact.status === 'active'
          && final.checkpoint.state.graph.planningWindows.some(window => window.id === fact.factId))).toHaveLength(1);
        expect(projectWeeklyPlanningVNext(final.checkpoint.state).questions).toEqual([]);
      }
    });
});
