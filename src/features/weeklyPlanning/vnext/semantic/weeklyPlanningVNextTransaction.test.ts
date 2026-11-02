import { describe, expect, it } from 'vitest';
import type { VNextAddFact, VNextPatch, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { vnextLineageIdByFactId } from '../weeklyPlanningVNextWorkIdentity';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';
import { resolveWeeklyPlanningDateExpressionsV5 } from '../../semantic/weeklyPlanningResolvedDateExpressionsV5';
import { compileWeeklyPlanningVNextSchedulerInput, createWeeklyPlanningVNextSchedulerContext } from '../projection/weeklyPlanningVNextSchedulerGraph';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';

const delta = (parts: Partial<VNextTurnDelta> = {}): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [], ...parts });
const task: VNextAddFact = { kind: 'task', localId: 't', category: 'study', title: 'Math' };
const workload = (localId: string, amount: number, role: 'scope_total' | 'completed' | 'remaining' | 'target' = 'remaining'): Extract<VNextAddFact, { kind: 'workload' }> => ({
  kind: 'workload', localId, taskRef: { localId: 't' }, componentRef: null,
  quantityRole: role, amount, unitCode: 'custom', unitLabel: '枚',
  rangeStart: '1', rangeEnd: '20', perOccurrence: true, periodExpression: 'this_week',
});
const effort = (target: string, minutes: number): VNextAddFact => ({ kind: 'effort_estimate', localId: 'e',
  taskRef: { localId: 't' }, targetRef: { localId: target }, effortKind: 'total_duration',
  minutes, unitCode: null, unitLabel: null, precision: 'exact' });
const workloadChanges = (amount: number | null) => ({ amount, unitCode: null, unitLabel: null,
  quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null });
function turn(state: WeeklyPlanningVNextState, changes: VNextTurnDelta, key = `turn-${state.graph.revision}`) {
  return applyWeeklyPlanningVNextTurn(state, changes, { expectedRevision: state.graph.revision,
    weekStartsOn: 'monday' as const, planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, acceptedDate: '2026-11-02', turnKey: key, conversationId: 'c', turnId: key, sourceText: 'user evidence' });
}
function applied(state: WeeklyPlanningVNextState, changes: VNextTurnDelta): WeeklyPlanningVNextState {
  const result = turn(state, changes);
  expect(result.status, JSON.stringify(result)).toBe('applied');
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
function setup(withEffort = true): WeeklyPlanningVNextState {
  return applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, workload('r', 7), ...(withEffort ? [effort('r', 45)] : [])] }));
}
function amountPatch(state: WeeklyPlanningVNextState, amount: number): Extract<VNextPatch, { kind: 'workload' }> {
  return { kind: 'workload', localId: 'fix-r', targetFactId: state.graph.workloads[0].id,
    changes: workloadChanges(amount), amountDelta: null };
}
const activeWorkloads = (state: WeeklyPlanningVNextState) => state.graph.workloads.filter(fact =>
  state.graph.factLifecycles.some(entry => entry.factId === fact.id && entry.status === 'active'));
const activeEfforts = (state: WeeklyPlanningVNextState) => state.graph.effortEstimates.filter(fact =>
  state.graph.factLifecycles.some(entry => entry.factId === fact.id && entry.status === 'active'));

const portedFacts: { fact: VNextAddFact; collection: 'studyContexts' | 'planningWindows' | 'recurrences' | 'taskDateRules' | 'availabilityDeclarations' | 'relations';
  patch: VNextPatch; added: Record<string, unknown>; changed: Record<string, unknown>; invalidField: string; invalidValue: unknown }[] = [
  { fact: { kind: 'study_context', localId: 'ported', taskRef: { localId: 't' }, purpose: 'exam', contextLabel: 'Vocabulary', activityKind: 'memorization_retrieval' },
    collection: 'studyContexts', patch: { kind: 'study_context', localId: 'edit', targetFactId: '', changes: { purpose: null, contextLabel: null, activityKind: 'problem_solving' } },
    added: { purpose: 'exam', contextLabel: 'Vocabulary', activityKind: 'memorization_retrieval' },
    changed: { purpose: 'exam', contextLabel: 'Vocabulary', activityKind: 'problem_solving' }, invalidField: 'activityKind', invalidValue: 'invented' },
  { fact: { kind: 'planning_window', localId: 'ported', windowKind: 'relative_week', value: 'next_week', start: null, end: null },
    collection: 'planningWindows', patch: { kind: 'planning_window', localId: 'edit', targetFactId: '',
      changes: { windowKind: null, value: 'tomorrow', start: null, end: null } },
    added: { kind: 'absolute', value: '2026-11-09/2026-11-15', start: '2026-11-09', end: '2026-11-15' },
    changed: { kind: 'absolute', value: '2026-11-03', start: '2026-11-03', end: '2026-11-03' }, invalidField: 'value', invalidValue: 'not-a-date' },
  { fact: { kind: 'recurrence', localId: 'ported', taskRef: { localId: 't' }, targetRef: { localId: 't' }, recurrenceKind: 'daily', count: null, days: [] },
    collection: 'recurrences', patch: { kind: 'recurrence', localId: 'edit', targetFactId: '', changes: { recurrenceKind: 'weekly', count: null, days: ['weekday:monday'] } },
    added: { kind: 'daily', count: null, days: [] }, changed: { kind: 'weekly', days: ['weekday:monday'] }, invalidField: 'count', invalidValue: 0 },
  { fact: { kind: 'task_date_rule', localId: 'ported', taskRef: { localId: 't' }, targetRef: { localId: 't' }, ruleKind: 'excluded_date', dateExpression: 'tomorrow', constraintLevel: 'hard' },
    collection: 'taskDateRules', patch: { kind: 'task_date_rule', localId: 'edit', targetFactId: '', changes: { ruleKind: 'allowed_date', dateExpression: 'next_week', constraintLevel: null } },
    added: { kind: 'excluded_date', dateExpression: '2026-11-03' }, changed: { kind: 'allowed_date', dateExpression: '2026-11-09/2026-11-15' },
    invalidField: 'constraintLevel', invalidValue: 'soft' },
  { fact: { kind: 'availability_declaration', localId: 'ported', availabilityKind: 'unavailable', dateExpression: 'tomorrow', namedTimePeriod: null,
      startTime: '09:00', endTime: '10:00', recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard' },
    collection: 'availabilityDeclarations', patch: { kind: 'availability_declaration', localId: 'edit', targetFactId: '', changes: { availabilityKind: 'available', dateExpression: 'next_week',
      namedTimePeriod: null, startTime: null, endTime: null, recurrenceKind: null, days: null, capacityMinutes: null, constraintLevel: null } },
    added: { kind: 'unavailable', dateExpression: '2026-11-03', resolutionStatus: 'unresolved' },
    changed: { kind: 'available', dateExpression: '2026-11-09/2026-11-15', startTime: '09:00', endTime: '10:00', resolutionStatus: 'unresolved' },
    invalidField: 'endTime', invalidValue: '99:00' },
  { fact: { kind: 'relation', localId: 'ported', relationKind: 'before', fromTaskRef: { localId: 't' }, toTaskRef: { localId: 'other' } },
    collection: 'relations', patch: { kind: 'relation', localId: 'edit', targetFactId: '', changes: { relationKind: 'after' } },
    added: { kind: 'before' }, changed: { kind: 'after' }, invalidField: 'relationKind', invalidValue: 'invented' },
];

describe('experimental VNext typed transaction', () => {
  it('retains unknown activity despite a memorization title/label and word unit, and guards task dependencies', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [
      { ...task, title: '英単語暗記' }, { ...workload('words', 20), unitCode: 'word', unitLabel: '語' },
      { kind: 'study_context', localId: 'study', taskRef: { localId: 't' }, purpose: 'exam', contextLabel: '暗記', activityKind: 'unknown' },
    ] }));
    expect(state.graph.studyContexts[0].activityKind).toBe('unknown');
    const blocked = turn(state, delta({ remove: [{ targetFactId: state.graph.tasks[0].id }] }));
    expect(blocked).toMatchObject({ status: 'rejected', errors: expect.arrayContaining([expect.objectContaining({ code: 'active_dependents' })]) });
    expect(blocked.state).toBe(state);
  });

  it('uses V5 validation for a study purpose and task-only ownership', () => {
    const context = { kind: 'study_context' as const, localId: 'study', taskRef: { localId: 't' },
      purpose: 'self_study' as const, contextLabel: null, activityKind: 'reading' as const };
    for (const [fact, field] of [
      [{ ...context, purpose: 'invented' } as unknown as VNextAddFact, 'purpose'],
      [{ ...context, taskRef: { localId: 'work' } }, 'taskRef'],
    ] as const) {
      const state = createEmptyWeeklyPlanningVNextState();
      const result = turn(state, delta({ add: [task, workload('work', 20), fact] }));
      expect(result).toMatchObject({ status: 'rejected', errors: expect.arrayContaining([expect.objectContaining({ path: `add[2].${field}`, localId: 'study' })]) });
      expect(result.state).toBe(state);
    }
  });

  it.each(['remove-add', 'patch'] as const)('anchors a deadline in the final replacement window with %s (S02)', replacement => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { kind: 'planning_window', localId: 'old-window', windowKind: 'absolute', value: '2026-11-09/2026-11-15', start: '2026-11-09', end: '2026-11-15' },
    ] }));
    const snapshot = structuredClone(state);
    const deadline: VNextAddFact = { kind: 'temporal_constraint', localId: 'deadline', taskRef: { factId: state.graph.tasks[0].id }, targetRef: { factId: state.graph.tasks[0].id },
      constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact' };
    const result = applyWeeklyPlanningVNextTurn(state, delta({
      add: [deadline, ...(replacement === 'remove-add' ? [{ kind: 'planning_window' as const, localId: 'new-window', windowKind: 'absolute' as const,
        value: '2026-11-16/2026-11-22', start: '2026-11-16', end: '2026-11-22' }] : [])],
      patch: replacement === 'patch' ? [{ kind: 'planning_window', localId: 'new-window', targetFactId: state.graph.planningWindows[0].id,
        changes: { windowKind: null, value: null, start: '2026-11-16', end: '2026-11-22' } }] : [],
      remove: replacement === 'remove-add' ? [{ targetFactId: state.graph.planningWindows[0].id }] : [],
    }), { expectedRevision: state.graph.revision, acceptedDate: '2026-11-02', weekStartsOn: 'monday',
      planningHorizon: { startDate: '2026-11-09', endDate: '2026-11-15' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, turnKey: 'replace', conversationId: 'c', turnId: 'replace', sourceText: 'replacement window and Friday deadline' });
    expect(state).toEqual(snapshot);
    if (result.status !== 'applied') throw new Error(JSON.stringify(result));
    const active = new Set(result.state.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(result.state.graph.planningWindows.filter(window => active.has(window.id))).toMatchObject([{ start: '2026-11-16', end: '2026-11-22' }]);
    expect(result.state.graph.temporalConstraints[0]).toMatchObject({ dateExpression: '2026-11-20', endTime: '13:00' });
    expect(result.state.graph.revision).toBe(state.graph.revision + 1);
  });

  it.each([
    ['2026-11-02', '2026-11-08', '2026-11-06'],
    ['2026-11-23', '2026-11-29', '2026-11-27'],
  ])('uses the selected default %s–%s after removing the only window', (startDate, endDate, friday) => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { kind: 'planning_window', localId: 'old-window', windowKind: 'absolute', value: '2026-11-09/2026-11-15', start: '2026-11-09', end: '2026-11-15' },
    ] }));
    const snapshot = structuredClone(state);
    const result = applyWeeklyPlanningVNextTurn(state, delta({ add: [
      { kind: 'temporal_constraint', localId: 'deadline', taskRef: { factId: state.graph.tasks[0].id }, targetRef: { factId: state.graph.tasks[0].id },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact' },
    ], remove: [{ targetFactId: state.graph.planningWindows[0].id }] }), {
      expectedRevision: state.graph.revision, acceptedDate: '2026-11-02', weekStartsOn: 'monday',
      planningHorizon: { startDate: '2026-11-09', endDate: '2026-11-15' }, defaultPlanningHorizon: { startDate, endDate },
      turnKey: 'remove-window', conversationId: 'c', turnId: 'remove-window', sourceText: 'withdraw the window and state a Friday deadline',
    });
    expect(state).toEqual(snapshot);
    if (result.status !== 'applied') throw new Error(JSON.stringify(result));
    expect(result.state.graph.factLifecycles.find(entry => entry.factId === state.graph.planningWindows[0].id)?.status).toBe('removed');
    expect(result.state.graph.temporalConstraints[0].dateExpression).toBe(friday);
  });

  it.each([
    ['monday', '2026-11-09', '2026-11-15'],
    ['sunday', '2026-11-08', '2026-11-14'],
  ] as const)('freezes next_week with %s-start at acceptance (VP01)', (weekStartsOn, start, end) => {
    const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [
      { kind: 'planning_window', localId: 'week', windowKind: 'relative_week', value: 'next_week', start: null, end: null },
      task, { kind: 'temporal_constraint', localId: 'bound', taskRef: { localId: 't' }, targetRef: { localId: 't' },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'next_week', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact' },
    ] }), { expectedRevision: 0, acceptedDate: '2026-11-02', weekStartsOn,
      planningHorizon: { startDate: '2026-11-01', endDate: '2026-11-07' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, turnKey: 'week', conversationId: 'c', turnId: 'week', sourceText: 'next week' });
    if (result.status !== 'applied') throw new Error(JSON.stringify(result));
    expect(result.state.graph.planningWindows[0]).toMatchObject({ kind: 'absolute', start, end });
    expect(result.state.graph.temporalConstraints[0].dateExpression).toBe(`${start}/${end}`);
  });

  it('keeps a one-occurrence Friday deadline fixed when a later turn only changes work (VP02)', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { ...workload('work', 60), unitCode: 'minute', unitLabel: '分', quantityRole: 'target', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
      { kind: 'planning_window', localId: 'window', windowKind: 'absolute', value: '2026-11-02/2026-11-15', start: '2026-11-02', end: '2026-11-15' },
      { kind: 'temporal_constraint', localId: 'due', taskRef: { localId: 't' }, targetRef: { localId: 't' }, constraintKind: 'deadline', constraintLevel: 'hard',
        dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact' },
    ] }));
    expect(state.graph.temporalConstraints[0].dateExpression).toBe('2026-11-06');
    const bound = (value: WeeklyPlanningVNextState, currentDate: string) => {
      const context = createWeeklyPlanningVNextSchedulerContext({ state: value, ownerId: 'test', selectedDate: '2026-11-02',
        requestContext: { currentDate, currentTime: '09:00', notBeforeDate: currentDate, notBeforeTime: '09:00',
          weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', startedAtIso: `${currentDate}T00:00:00Z` } });
      const compiled = compileWeeklyPlanningVNextSchedulerInput({ state: value, projection: projectWeeklyPlanningVNext(value), context });
      if (compiled.status !== 'compiled' || !compiled.compilation.input) throw new Error(JSON.stringify(compiled));
      return compiled.compilation.input.hardDateBounds[0];
    };
    expect(bound(state, '2026-11-02')).toMatchObject({ endDate: '2026-11-06' });
    expect(bound(state, '2026-11-07')).toMatchObject({ endDate: '2026-11-06' });
    const later = applyWeeklyPlanningVNextTurn(state, delta({ patch: [{ ...amountPatch(state, 90), targetFactId: state.graph.workloads[0].id }] }), {
      acceptedDate: '2026-11-07', weekStartsOn: 'monday', planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-15' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
      expectedRevision: state.graph.revision, turnKey: 'later-correction', conversationId: 'c', turnId: 'later-correction', sourceText: '90 minutes',
    });
    if (later.status !== 'applied') throw new Error(JSON.stringify(later));
    expect(later.state.graph.temporalConstraints[0].dateExpression).toBe('2026-11-06');
    expect(bound(later.state, '2026-11-07')).toMatchObject({ endDate: '2026-11-06' });
  });

  it('freezes one-off availability weekdays but preserves repeated weekday filters', () => {
    const base = { kind: 'availability_declaration' as const, availabilityKind: 'unavailable' as const, dateExpression: 'weekday:friday',
      namedTimePeriod: null, startTime: '09:00', endTime: '10:00', days: [], capacityMinutes: null, constraintLevel: 'hard' as const };
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [
      { ...base, localId: 'once', recurrenceKind: null }, { ...base, localId: 'repeat', recurrenceKind: 'weekly' },
    ] }));
    expect(state.graph.availabilityDeclarations.map(fact => fact.dateExpression)).toEqual(['2026-11-06', 'weekday:friday']);
  });

  it('anchors other dates after a same-turn window add or effective patch, independent of input order', () => {
    const due: VNextAddFact = { kind: 'temporal_constraint', localId: 'due', taskRef: { localId: 't' }, targetRef: { localId: 't' },
      constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact' };
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due,
      { kind: 'planning_window', localId: 'window', windowKind: 'relative_week', value: 'next_week', start: null, end: null },
    ] }));
    expect(state.graph.temporalConstraints[0].dateExpression).toBe('2026-11-13');
    const result = turn(state, delta({ patch: [
      { kind: 'temporal_constraint', localId: 'date-change', targetFactId: state.graph.temporalConstraints[0].id,
        changes: { constraintKind: null, constraintLevel: null, dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: null, precision: null } },
      { kind: 'planning_window', localId: 'window-change', targetFactId: state.graph.planningWindows[0].id,
        changes: { windowKind: null, value: '2026-11-16/2026-11-22', start: null, end: null } },
    ] }));
    if (result.status !== 'applied') throw new Error(JSON.stringify(result));
    expect(result.state.graph.temporalConstraints[1].dateExpression).toBe('2026-11-20');
  });

  it('rejects an occurrence weekday absent from the horizon at its add or patch field', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { kind: 'temporal_constraint', localId: 'due', taskRef: { localId: 't' }, targetRef: { localId: 't' }, constraintKind: 'deadline', constraintLevel: 'hard',
        dateExpression: 'today', namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact' },
    ] }));
    const context = { expectedRevision: state.graph.revision, acceptedDate: '2026-11-02', weekStartsOn: 'monday' as const,
      planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-04' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, turnKey: 'no-friday', conversationId: 'c', turnId: 'no-friday', sourceText: 'Friday' };
    const add = applyWeeklyPlanningVNextTurn(state, delta({ add: [{ kind: 'availability_declaration', localId: 'once', availabilityKind: 'unavailable', dateExpression: 'weekday:friday',
      namedTimePeriod: null, startTime: '09:00', endTime: '10:00', recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard' }] }), context);
    expect(add).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ path: 'add[0].dateExpression', localId: 'once' })] });
    expect(add.state).toBe(state);
    const patch = applyWeeklyPlanningVNextTurn(state, delta({ patch: [{ kind: 'temporal_constraint', localId: 'fix', targetFactId: state.graph.temporalConstraints[0].id,
      changes: { constraintKind: null, constraintLevel: null, dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: null, precision: null } }] }), context);
    expect(patch).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ path: 'patch[0].changes.dateExpression', localId: 'fix' })] });
    expect(patch.state).toBe(state);
  });

  it.each(['weekday:monday', 'tomorrow', '2026-02-30'])('rejects %s as the accepting clock date', acceptedDate => {
    const state = createEmptyWeeklyPlanningVNextState();
    const result = applyWeeklyPlanningVNextTurn(state, delta({ add: [task] }), { weekStartsOn: 'monday' as const, planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, acceptedDate,
      expectedRevision: 0, turnKey: 'clock', conversationId: 'c', turnId: 'clock', sourceText: 'user evidence' });
    expect(result).toMatchObject({ status: 'rejected', errors: [{ code: 'invalid_value', path: 'context' }] });
    expect(result.state).toBe(state);
  });

  it.each(portedFacts)('ports $collection add/patch/remove through the same transaction and lifecycle', fixture => {
    const initial = createEmptyWeeklyPlanningVNextState();
    const added = applied(initial, delta({ add: [task, { kind: 'task', localId: 'other', category: 'non_study', title: 'Other' }, fixture.fact] }));
    const fact = added.graph[fixture.collection][0];
    expect(fact).toMatchObject(fixture.added);
    expect(fact.source).toMatchObject({ origin: 'user', sourceText: 'user evidence' });
    expect(initial.graph.revision).toBe(0);
    const changed = applied(added, delta({ patch: [{ ...fixture.patch, targetFactId: fact.id }] }));
    const replacement = changed.graph[fixture.collection][1];
    expect(replacement).toMatchObject(fixture.changed);
    expect(changed.graph.factLifecycles.find(entry => entry.factId === fact.id)).toMatchObject({ status: 'superseded', supersededByFactId: replacement.id });
    const removed = applied(changed, delta({ remove: [{ targetFactId: replacement.id }] }));
    expect(removed.graph.factLifecycles.find(entry => entry.factId === replacement.id)?.status).toBe('removed');
    expect(removed.graph.tasks).toHaveLength(2);
  });

  it.each(portedFacts)('returns field-addressed V5 validation errors for $collection additions and patches', fixture => {
    const initial = createEmptyWeeklyPlanningVNextState();
    const invalid = { ...fixture.fact, [fixture.invalidField]: fixture.invalidValue } as VNextAddFact;
    const result = turn(initial, delta({ add: [task, { kind: 'task', localId: 'other', category: 'study', title: 'Other' }, invalid] }));
    expect(result).toMatchObject({ status: 'rejected', state: initial });
    if (result.status !== 'rejected') throw new Error('expected rejection');
    expect(result.errors.some(error => error.path.startsWith(`add[2].${fixture.invalidField}`) && error.localId === 'ported')).toBe(true);
    const added = applied(initial, delta({ add: [task, { kind: 'task', localId: 'other', category: 'study', title: 'Other' }, fixture.fact] }));
    const badPatch = { ...fixture.patch, targetFactId: added.graph[fixture.collection][0].id,
      changes: { ...fixture.patch.changes, [fixture.invalidField]: fixture.invalidValue } } as VNextPatch;
    const patched = turn(added, delta({ patch: [badPatch] }));
    expect(patched.status).toBe('rejected');
    if (patched.status !== 'rejected') throw new Error('expected rejection');
    expect(patched.state).toBe(added);
    expect(patched.errors.some(error => error.path.startsWith(`patch[0].changes.${fixture.invalidField}`) && error.localId === 'edit')).toBe(true);
  });

  it('preserves V5 task/component recurrence ownership and rejects workload/date-rule component targets', () => {
    const component: VNextAddFact = { kind: 'component', localId: 'component', taskRef: { localId: 't' }, parentComponentRef: null, role: 'material', label: 'Book' };
    for (const [target, accepted] of [['t', true], ['component', true], ['work', false]] as const) {
      const recurrence: VNextAddFact = { kind: 'recurrence', localId: 'repeat', taskRef: { localId: 't' }, targetRef: { localId: target }, recurrenceKind: 'daily', count: null, days: [] };
      const result = turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, component, workload('work', 20), recurrence] }));
      expect(result.status).toBe(accepted ? 'applied' : 'rejected');
      if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({ path: 'add[3].targetRef' }));
    }
    const rule: VNextAddFact = { kind: 'task_date_rule', localId: 'rule', taskRef: { localId: 't' }, targetRef: { localId: 'component' }, ruleKind: 'excluded_date', dateExpression: 'tomorrow', constraintLevel: 'hard' };
    expect(turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, component, rule] }))).toMatchObject({ status: 'rejected', errors: expect.arrayContaining([expect.objectContaining({ path: 'add[2].targetRef' })]) });
  });

  it('keeps weekday filters in a multi-week horizon while a today-relative date remains frozen on a later turn', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { kind: 'planning_window', localId: 'horizon', windowKind: 'absolute', value: '2026-11-09/2026-11-22', start: '2026-11-09', end: '2026-11-22' },
      { kind: 'task_date_rule', localId: 'mondays', taskRef: { localId: 't' }, targetRef: { localId: 't' }, ruleKind: 'excluded_date', dateExpression: 'weekday:monday', constraintLevel: 'hard' },
      { kind: 'temporal_constraint', localId: 'deadline', taskRef: { localId: 't' }, targetRef: { localId: 't' }, constraintKind: 'deadline', constraintLevel: 'hard',
        dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact' },
      { kind: 'availability_declaration', localId: 'tomorrow', availabilityKind: 'unavailable', dateExpression: 'tomorrow', namedTimePeriod: null,
        startTime: '09:00', endTime: '10:00', recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard' },
    ] }));
    const later = applyWeeklyPlanningVNextTurn(state, delta({ add: [{ kind: 'task', localId: 'later', category: 'study', title: 'Later' }] }), {
      expectedRevision: state.graph.revision, weekStartsOn: 'monday' as const, planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, acceptedDate: '2026-11-10', turnKey: 'later', conversationId: 'c', turnId: 'later', sourceText: 'later statement',
    });
    if (later.status !== 'applied') throw new Error('setup');
    expect(later.state.graph.availabilityDeclarations[0].dateExpression).toBe('2026-11-03');
    const resolved = resolveWeeklyPlanningDateExpressionsV5({ graph: later.state.graph, currentDate: '2026-11-10',
      planningWindow: { startDate: '2026-11-09', endDate: '2026-11-22' } });
    expect(resolved.facts.find(fact => fact.factId === state.graph.taskDateRules[0].id)).toMatchObject({ dates: ['2026-11-09', '2026-11-16'] });
    expect(resolved.facts.find(fact => fact.factId === state.graph.temporalConstraints[0].id)).toMatchObject({ range: { start: '2026-11-13', end: '2026-11-13' } });
  });
  it('value-only R7→R8 keeps custom unit, range, recurrence period and original state', () => {
    const original = setup();
    const snapshot = structuredClone(original);
    const next = applied(original, delta({ patch: [amountPatch(original, 8)] }));
    expect(original).toEqual(snapshot);
    expect(activeWorkloads(next)[0]).toMatchObject({ amount: 8, unitCode: 'custom', unitLabel: '枚',
      rangeStart: '1', rangeEnd: '20', perOccurrence: true, periodExpression: 'this_week' });
    const roots = vnextLineageIdByFactId(next.graph);
    expect(roots.get(activeWorkloads(next)[0].id)).toBe(original.graph.workloads[0].id);
    expect(activeEfforts(next)[0].workBinding?.boundAmount).toBe(7);
  });

  it('C12 and explicit R8 remain independent stated facts, without persisting derived remaining', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      workload('total', 20, 'scope_total'), workload('c', 10, 'completed'), workload('r', 8)] }));
    const completed = state.graph.workloads.find(fact => fact.quantityRole === 'completed')!;
    const next = applied(state, delta({ patch: [{ ...amountPatch(state, 12), targetFactId: completed.id }] }));
    expect(activeWorkloads(next).map(fact => [fact.quantityRole, fact.amount])).toEqual([
      ['scope_total', 20], ['remaining', 8], ['completed', 12],
    ]);
  });

  it.each([false, true])('binds same-turn R8+E60 to final quantity regardless of patch order (%s)', reverse => {
    const state = setup();
    const patches: VNextPatch[] = [amountPatch(state, 8), { kind: 'effort_estimate', localId: 'fix-e',
      targetFactId: state.graph.effortEstimates[0].id,
      changes: { minutes: 60, effortKind: null, unitCode: null, unitLabel: null, precision: null } }];
    const next = applied(state, delta({ patch: reverse ? patches.reverse() : patches }));
    expect(activeWorkloads(next)[0].amount).toBe(8);
    expect(activeEfforts(next)[0]).toMatchObject({ minutes: 60,
      workBinding: { workLineageId: state.graph.workloads[0].id, boundAmount: 8 } });
  });

  it('binds a new estimate to final derived remaining after C12 correction', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      workload('total', 20, 'scope_total'), workload('c', 10, 'completed')] }));
    const next = applied(state, delta({ add: [{ ...effort('total', 60), taskRef: { factId: state.graph.tasks[0].id },
      targetRef: { factId: state.graph.workloads[0].id } } as VNextAddFact],
    patch: [{ ...amountPatch(state, 12), targetFactId: state.graph.workloads[1].id }] }));
    expect(activeEfforts(next)[0].workBinding?.boundAmount).toBe(8);
    expect(activeWorkloads(next)).toHaveLength(2);
  });

  it('adds amountDelta mathematically and rejects absolute amount combined with increment', () => {
    const state = setup(false);
    const patch = { ...amountPatch(state, 8), changes: workloadChanges(null), amountDelta: 3 };
    const next = applied(state, delta({ patch: [patch] }));
    expect(activeWorkloads(next)[0].amount).toBe(10);
    expect(turn(state, delta({ patch: [{ ...patch, changes: workloadChanges(8) }] })).status).toBe('rejected');
  });

  it('preserves independent clauses in a correction turn', () => {
    const state = setup(false);
    const next = applied(state, delta({ patch: [amountPatch(state, 8)],
      add: [{ ...task, localId: 'independent', title: 'English' }] }));
    expect(next.graph.tasks.map(fact => fact.title)).toEqual(['Math', 'English']);
    expect(activeWorkloads(next)[0].amount).toBe(8);
  });

  it('permits explicit custom-unit change without rewriting period or range', () => {
    const state = setup(false);
    const next = applied(state, delta({ patch: [{ ...amountPatch(state, 8), changes: {
      ...workloadChanges(null), unitLabel: 'セット',
    } }] }));
    expect(activeWorkloads(next)[0]).toMatchObject({ amount: 7, unitLabel: 'セット', periodExpression: 'this_week', rangeEnd: '20' });
  });

  it('rejects an ownership field and returns an addressable error without committing any clause', () => {
    const state = setup(false);
    const malformed = { ...amountPatch(state, 8), changes: { ...workloadChanges(8), taskId: 'foreign' } } as unknown as VNextPatch;
    const result = turn(state, delta({ patch: [malformed], add: [{ ...task, localId: 'other' }] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({ path: 'patch[0].changes.taskId' }));
  });

  it('rejects stale revision, terminal target and unknown target', () => {
    const state = setup(false);
    const changes = delta({ patch: [amountPatch(state, 8)] });
    const stale = applyWeeklyPlanningVNextTurn(state, changes, { expectedRevision: 0, weekStartsOn: 'monday' as const, planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, acceptedDate: '2026-11-02', turnKey: 'stale', conversationId: 'c', turnId: 't', sourceText: 'evidence' });
    expect(stale.status).toBe('rejected');
    const next = applied(state, changes);
    expect(turn(next, changes).status).toBe('rejected');
    expect(turn(state, delta({ patch: [{ ...amountPatch(state, 8), targetFactId: 'missing' }] })).state).toBe(state);
  });

  it('replaying an applied key is duplicate even with its old expected revision', () => {
    const state = setup(false);
    const changes = delta({ patch: [amountPatch(state, 8)] });
    const result = turn(state, changes, 'replay');
    expect(result.status).toBe('applied');
    const replay = applyWeeklyPlanningVNextTurn(result.state, changes, { expectedRevision: state.graph.revision,
      weekStartsOn: 'monday' as const, planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, acceptedDate: '2026-11-02', turnKey: 'replay', conversationId: 'c', turnId: 'replay', sourceText: 'evidence' });
    expect(replay.status).toBe('duplicate');
    expect(replay.state).toBe(result.state);
  });

  it('no-op patch preserves revision and facts, and records the turn so a replay is a duplicate (Astra D06)', () => {
    const state = setup();
    const result = turn(state, delta({ patch: [amountPatch(state, 7)] }), 'restate');
    expect(result.status).toBe('noop');
    expect(result.state.graph).toEqual({ ...state.graph, appliedTurnKeys: [...state.graph.appliedTurnKeys, 'restate'] });
    expect(turn(result.state, delta({ patch: [amountPatch(state, 9)] }), 'restate').status).toBe('duplicate');
  });

  it('no-op total estimate is unchanged, but restated minutes bind to a same-turn new quantity', () => {
    const state = setup();
    const patch: VNextPatch = { kind: 'effort_estimate', localId: 'restated', targetFactId: state.graph.effortEstimates[0].id,
      changes: { minutes: 45, effortKind: null, unitCode: null, unitLabel: null, precision: null } };
    const noop = turn(state, delta({ patch: [patch] }));
    expect(noop.status).toBe('noop');
    // Unchanged facts and revision; only the processed turn is recorded.
    expect({ ...noop.state.graph, appliedTurnKeys: state.graph.appliedTurnKeys }).toEqual(state.graph);
    const next = applied(state, delta({ patch: [patch, amountPatch(state, 8)] }));
    expect(activeEfforts(next)[0]).toMatchObject({ minutes: 45, workBinding: { boundAmount: 8 } });
  });

  it('rejects missing effort or temporal values with the exact semantic field and local ID', () => {
    const state = setup();
    const bad = { kind: 'effort_estimate', localId: 'bad-e', targetFactId: state.graph.effortEstimates[0].id,
      changes: { minutes: 60, effortKind: 'invented', unitCode: null, unitLabel: null, precision: null } } as unknown as VNextPatch;
    const result = turn(state, delta({ patch: [bad] }));
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({
      path: 'patch[0].changes.effortKind', localId: 'bad-e',
    }));
  });

  it('patches task category/title and component label while preserving dependent identity references', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { kind: 'component', localId: 'book', taskRef: { localId: 't' }, parentComponentRef: null, role: 'material', label: 'Book' },
      { ...workload('r', 8), componentRef: { localId: 'book' } } as VNextAddFact] }));
    const taskId = state.graph.tasks[0].id, componentId = state.graph.components[0].id;
    const next = applied(state, delta({ patch: [
      { kind: 'task', localId: 'task-correction', targetFactId: taskId, changes: { category: 'non_study', title: 'Errand' } },
      { kind: 'component', localId: 'component-correction', targetFactId: componentId, changes: { role: null, label: 'New book' } },
    ] }));
    expect(activeWorkloads(next)[0]).toMatchObject({ taskId, componentId });
    expect(next.graph.tasks[next.graph.tasks.length - 1]).toMatchObject({ category: 'non_study', title: 'Errand' });
    expect(next.graph.components[next.graph.components.length - 1]).toMatchObject({ label: 'New book' });
    expect(vnextLineageIdByFactId(next.graph).get(next.graph.tasks[next.graph.tasks.length - 1].id)).toBe(taskId);
  });

  it('places a deadline time as its end: 13:00 as endTime is kept, as startTime it is rejected naming both clock fields (#881 B)', () => {
    const deadline = (startTime: string | null, endTime: string | null) => ({ kind: 'temporal_constraint' as const, localId: 'due',
      taskRef: { localId: 't' }, targetRef: { localId: 't' }, constraintKind: 'deadline' as const, constraintLevel: 'hard' as const,
      dateExpression: '2026-08-27', namedTimePeriod: null, startTime, endTime, precision: 'exact' as const });
    const kept = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, deadline(null, '13:00')] }));
    expect(kept.graph.temporalConstraints[0]).toMatchObject({ kind: 'deadline', startTime: null, endTime: '13:00' });
    const misplaced = turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, deadline('13:00', null)] }));
    // Both clock fields are addressed: moving 13:00 changes both, so a repair cannot drop the stated time.
    expect(misplaced).toMatchObject({ status: 'rejected', errors: [
      expect.objectContaining({ path: 'add[1].startTime', localId: 'due' }),
      expect.objectContaining({ path: 'add[1].endTime', localId: 'due' }),
    ] });
    // A patch that moves an end time into the start of a stated deadline is rejected the same way.
    const moved = turn(kept, delta({ patch: [{ kind: 'temporal_constraint', localId: 'move', targetFactId: kept.graph.temporalConstraints[0].id,
      changes: { constraintKind: null, constraintLevel: null, dateExpression: null, namedTimePeriod: null, startTime: '13:00', endTime: null, precision: null } }] }));
    expect(moved).toMatchObject({ status: 'rejected', errors: [
      expect.objectContaining({ path: 'patch[0].changes.startTime', localId: 'move' }),
      expect.objectContaining({ path: 'patch[0].changes.endTime', localId: 'move' }),
    ] });
  });

  it('rejects a temporal constraint that bounds nothing, naming every field so a reread can restore what was stated', () => {
    // Repro 4b2dc9c1 run 3: the reread of "今週は…" kept a preferred_window with no date, period or clock.
    const window = (dateExpression: string | null, namedTimePeriod: 'evening' | null) => ({ kind: 'temporal_constraint' as const, localId: 'w',
      taskRef: { localId: 't' }, targetRef: { localId: 't' }, constraintKind: 'preferred_window' as const, constraintLevel: 'soft' as const,
      dateExpression, namedTimePeriod, startTime: null, endTime: null, precision: 'unspecified' as const });
    expect(turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, window(null, null)] }))).toMatchObject({ status: 'rejected', errors: [
      expect.objectContaining({ path: 'add[1].dateExpression', localId: 'w' }),
      expect.objectContaining({ path: 'add[1].namedTimePeriod', localId: 'w' }),
      expect.objectContaining({ path: 'add[1].startTime', localId: 'w' }),
      expect.objectContaining({ path: 'add[1].endTime', localId: 'w' }),
    ] });
    expect(applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, window('this_week', null)] })).graph.temporalConstraints).toHaveLength(1);
    expect(applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, window(null, 'evening')] })).graph.temporalConstraints).toHaveLength(1);
  });

  it('fixes a relative date to the accepting turn, so it does not move on a later day (#918)', () => {
    const due = (dateExpression: string) => ({ kind: 'temporal_constraint' as const, localId: 'due', taskRef: { localId: 't' },
      targetRef: { localId: 't' }, constraintKind: 'deadline' as const, constraintLevel: 'hard' as const, dateExpression,
      namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact' as const });
    const context = (acceptedDate: string) => ({ weekStartsOn: 'monday' as const, planningHorizon: { startDate: '2026-08-24', endDate: '2026-09-06' }, defaultPlanningHorizon: { startDate: '2026-08-24', endDate: '2026-08-30' }, acceptedDate, turnKey: acceptedDate, expectedRevision: 0,
      conversationId: 'c', turnId: 't', sourceText: '締切は明日の13時' });
    const accepted = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due('tomorrow')] }), context('2026-08-26'));
    expect(accepted.status === 'applied' && accepted.state.graph.temporalConstraints[0].dateExpression).toBe('2026-08-27');
    const week = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due('this_week')] }), context('2026-08-26'));
    expect(week.status === 'applied' && week.state.graph.temporalConstraints[0].dateExpression).toBe('2026-08-24/2026-08-30');
    // Absolute dates are kept as stated; an unresolvable expression is rejected at that field, not guessed.
    const absolute = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due('2026-09-07')] }), context('2026-08-26'));
    expect(absolute.status === 'applied' && absolute.state.graph.temporalConstraints[0].dateExpression).toBe('2026-09-07');
    // Words are the model's to resolve: a non-canonical expression, in any language, goes back for repair (Astra D05).
    for (const word of ['someday', '月曜日', 'custom:月曜日']) {
      expect(applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due(word)] }), context('2026-08-26')))
        .toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ path: 'add[1].dateExpression', localId: 'due' })] });
    }
    const monday = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, due('weekday:monday')] }), context('2026-08-26'));
    // The selected one-occurrence Monday is frozen at acceptance (#918 / VP02).
    expect(monday.status === 'applied' && monday.state.graph.temporalConstraints[0].dateExpression).toBe('2026-08-31');
  });

  it('requires a rate stated about one workload to be in that work\'s unit (run 41004723952 native-multiturn-rate)', () => {
    const work = { ...workload('w', 7), unitCode: 'page' as const, unitLabel: '枚' };
    const rate = (unitCode: 'page' | 'custom') => ({ kind: 'effort_estimate' as const, localId: 'rate', taskRef: { localId: 't' },
      targetRef: { localId: 'w' }, effortKind: 'duration_per_unit' as const, minutes: 5, unitCode, unitLabel: '枚', precision: 'exact' as const });
    expect(turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, work, rate('page')] })).status).toBe('applied');
    expect(turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, work, rate('custom')] }))).toMatchObject({ status: 'rejected', errors: [
      expect.objectContaining({ path: 'add[2].unitCode', localId: 'rate' }), expect.objectContaining({ path: 'add[2].unitLabel', localId: 'rate' })] });
    // An owner-wide rate (about the task) is not tied to one work's unit.
    expect(turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, work, { ...rate('custom'), targetRef: { localId: 't' } }] })).status).toBe('applied');
  });

  it('corrects quantity and deadline independently in the same turn', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, workload('r', 7),
      { kind: 'temporal_constraint', localId: 'deadline', taskRef: { localId: 't' }, targetRef: { localId: 't' },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-11-01', namedTimePeriod: null,
        startTime: null, endTime: null, precision: 'exact' }] }));
    const next = applied(state, delta({ patch: [amountPatch(state, 8), { kind: 'temporal_constraint', localId: 'deadline-fix',
      targetFactId: state.graph.temporalConstraints[0].id, changes: { constraintKind: null, constraintLevel: null,
        dateExpression: '2026-11-02', namedTimePeriod: null, startTime: null, endTime: null, precision: null } }] }));
    expect(activeWorkloads(next)[0].amount).toBe(8);
    expect(next.graph.temporalConstraints[next.graph.temporalConstraints.length - 1].dateExpression).toBe('2026-11-02');
  });

  it('ends estimates that measure only the removed work in the same visible diff, and keeps owner-wide ones', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, workload('r', 7),
      { ...effort('r', 3), localId: 'rate-on-work', effortKind: 'duration_per_unit', unitCode: 'custom', unitLabel: '枚' } as VNextAddFact,
      { ...effort('r', 4), localId: 'rate-on-task', targetRef: { localId: 't' }, effortKind: 'duration_per_unit', unitCode: 'custom', unitLabel: '枚' } as VNextAddFact] }));
    const [onWork, onTask] = state.graph.effortEstimates;
    const result = turn(state, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }] }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.diff.removed.map(entry => entry.id)).toEqual([state.graph.workloads[0].id, onWork.id]);
    const active = new Set(result.state.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    expect(active.has(onTask.id)).toBe(true);
  });

  it('keeps the dependency guard addressable when a carried uncertainty targets a cascaded total', () => {
    const state = setup();
    state.graph.uncertainties.push({ id: 'uncertainty', targetFactId: state.graph.effortEstimates[0].id,
      field: 'precision', reason: 'unspecified', source: state.graph.tasks[0].source, createdRevision: 1 });
    state.graph.factLifecycles.push({ factId: 'uncertainty', status: 'active', createdRevision: 1,
      terminalRevision: null, supersededByFactId: null });
    const result = turn(state, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'active_dependents', path: 'remove[0].targetFactId', factId: state.graph.effortEstimates[0].id,
    }));
  });

  it.each([false, true])('explicitly removing a bound total with its workload has one diff per fact (%s)', reverse => {
    const state = setup();
    const remove = [{ targetFactId: state.graph.workloads[0].id }, { targetFactId: state.graph.effortEstimates[0].id }];
    const result = turn(state, delta({ remove: reverse ? remove.reverse() : remove }));
    expect(result.status).toBe('applied');
    if (result.status === 'applied') expect(new Set(result.diff.removed.map(fact => fact.id)).size).toBe(result.diff.removed.length);
  });

  it('rejects cross-task refs with input paths instead of graph implementation paths', () => {
    const result = turn(createEmptyWeeklyPlanningVNextState(), delta({ add: [task,
      { ...task, localId: 'other' },
      { kind: 'component', localId: 'component', taskRef: { localId: 'other' }, parentComponentRef: null, role: 'material', label: 'Other task book' },
      { ...workload('r', 8), componentRef: { localId: 'component' } } as VNextAddFact] }));
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({
      path: 'add[3].componentRef:task-mismatch', localId: 'r',
    }));
  });

  it.each([NaN, Infinity, -1])('rejects invalid amount %s atomically after merging changes', amount => {
    const state = setup();
    const result = turn(state, delta({ patch: [amountPatch(state, amount)] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({
      path: 'patch[0].changes.amount', localId: 'fix-r',
    }));
  });

  it('removes only bound workload totals, preserving task totals and separate workloads', () => {
    const state = setup();
    const taskId = state.graph.tasks[0].id;
    const withIndependent = applied(state, delta({ add: [
      { ...workload('other', 9), taskRef: { factId: taskId } } as VNextAddFact,
      { ...effort('unused', 90), localId: 'taskTotal', taskRef: { factId: taskId }, targetRef: { factId: taskId } } as VNextAddFact,
    ] }));
    const next = applied(withIndependent, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }] }));
    expect(activeWorkloads(next)).toHaveLength(1);
    expect(activeEfforts(next).map(fact => fact.minutes)).toEqual([90]);
  });

  it('delete and readd creates a new lineage and cannot inherit an old total', () => {
    const state = setup();
    const next = applied(state, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }],
      add: [{ ...workload('readded', 7), taskRef: { factId: state.graph.tasks[0].id } } as VNextAddFact] }));
    const root = vnextLineageIdByFactId(next.graph).get(activeWorkloads(next)[0].id);
    expect(root).toBe(activeWorkloads(next)[0].id);
    expect(root).not.toBe(state.graph.workloads[0].id);
    expect(activeEfforts(next)).toEqual([]);
  });

  it('rejects the entire compound turn when its newly stated effort target was removed', () => {
    const state = setup(false);
    const result = turn(state, delta({ remove: [{ targetFactId: state.graph.workloads[0].id }],
      add: [{ ...effort('unused', 60), taskRef: { factId: state.graph.tasks[0].id },
        targetRef: { factId: state.graph.workloads[0].id } } as VNextAddFact] }));
    expect(result.status).toBe('rejected');
    expect(result.state).toBe(state);
  });

  it('stores same/distinct sorted lineage pairs and keeps them through value corrections', () => {
    const state = applied(createEmptyWeeklyPlanningVNextState(), delta({ add: [task, workload('a', 8),
      { ...workload('b', 45, 'target'), unitCode: 'minute', unitLabel: '分' } as VNextAddFact],
    relate: [{ kind: 'distinct', a: { localId: 'b' }, b: { localId: 'a' } }] }));
    const next = applied(state, delta({ patch: [amountPatch(state, 9)] }));
    expect(next.workRelations).toEqual(state.workRelations);
    expect(next.workRelations[0].lineageIds).toEqual(state.graph.workloads.map(fact => fact.id).sort());
  });
});
