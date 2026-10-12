import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import type { SemanticWorkloadUnitCode } from '../semantic/weeklyPlanningSemanticDocument';
import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';
import { projectWeeklyPlanningPreviewConstraintSatisfaction as project } from './weeklyPlanningPreviewConstraintSatisfaction';

const meta = { createdRevision: 1, source: { conversationId: 'session-truth', turnId: 'turn', semanticLocalId: 'fact', sourceText: 'typed fixture', origin: 'user' as const } };
function graph(unit: SemanticWorkloadUnitCode = 'minute', amount = 60, cap = 30, rate: number | null = null): WeeklyPlanningFactGraphV5 {
  const result: WeeklyPlanningFactGraphV5 = { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
    tasks: [{ id: 'task', category: 'study', title: '数学', ...meta }],
    components: [{ id: 'component', taskId: 'task', parentComponentId: null, role: 'material', label: '教材', ...meta }],
    workloads: [{ id: 'work', taskId: 'task', componentId: 'component', quantityRole: 'target', amount, unitCode: unit, unitLabel: unit,
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, ...meta }],
    effortEstimates: [
      ...(rate === null ? [] : [{ id: 'rate', taskId: 'task', targetFactId: 'work', kind: 'duration_per_unit' as const, minutes: rate, unitCode: unit, precision: 'exact' as const, ...meta }]),
      { id: 'cap', taskId: 'task', targetFactId: 'task', kind: 'session_duration', minutes: cap, unitCode: 'session', precision: 'exact', ...meta },
    ],
  };
  result.factLifecycles = [...result.tasks, ...result.components, ...result.workloads, ...result.effortEstimates].map(fact => ({
    factId: fact.id, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null,
  }));
  return result;
}
function run(state = graph()) {
  const compiled = compileGenericSchedulerInput({ graph: state, context: {
    ownerId: 'owner', currentDate: '2026-08-24', planningStartDate: '2026-08-24', planningEndDate: '2026-08-30', timeZone: 'UTC',
  } });
  expect(compiled.status).toBe('ready');
  const schedulerInput = compiled.input!;
  const preview = scheduleWeeklyPlanningStableV5Preview({ input: schedulerInput, graph: createWeeklyPlanningPlacementGraphViewV5(state) });
  expect(preview.status).toBe('ready');
  return { graph: state, schedulerInput, candidates: preview.candidates };
}
function provenance(candidate: ReturnType<typeof run>['candidates'][number]) {
  return (candidate as typeof candidate & { stableV5Metadata: WeeklyPlanningStableV5PreviewProvenance }).stableV5Metadata;
}

describe('actual session-duration satisfaction from original Issue488', () => {
  it.each(['minute', 'hour', 'session'] as const)('keeps the existing %s representation and conserved total', unit => {
    const state = run(graph(unit, unit === 'minute' ? 120 : 2, 60));
    expect(state.candidates.map(candidate => candidate.durationMinutes)).toEqual([60, 60]);
    expect(state.schedulerInput.movableWorkItems.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(unit === 'minute' ? 120 : 2);
    expect(project(state)).toEqual([{ sourceFactId: 'cap', taskId: 'task', taskLabel: '数学', kind: 'session_duration', status: 'satisfied' }]);
  });
  it.each(['page', 'problem', 'word', 'lesson', 'chapter', 'section', 'exam_year', 'custom'] as const)('caps whole %s counts without changing requested ranges', unit => {
    const input = graph(unit, 20, 30, 3);
    input.workloads[0].rangeStart = '21'; input.workloads[0].rangeEnd = '40';
    const state = run(input);
    expect(state.candidates.map(candidate => candidate.durationMinutes)).toEqual([30, 30]);
    expect(state.schedulerInput.movableWorkItems.map(item => item.quantity.actualRange)).toEqual([{ start: '21', end: '30' }, { start: '31', end: '40' }]);
    expect(state.candidates.every(candidate => provenance(candidate).sourceFactRefs.includes('cap'))).toBe(true);
    expect(project(state)[0].status).toBe('satisfied');
  });
  it.each([
    { unit: 'page' as const, amount: 1, rate: 35, cap: 20 },
    { unit: 'mock_exam' as const, amount: 1, rate: 90, cap: 30 },
    { unit: 'custom' as const, amount: 1.5, rate: 30, cap: 10 },
    { unit: 'word' as const, amount: 513, rate: 0.51, cap: 1 },
  ])('keeps real effort and exposes an unmet cap for $unit/$amount', ({ unit, amount, rate, cap }) => {
    const state = run(graph(unit, amount, cap, rate));
    expect(state.schedulerInput.movableWorkItems.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(amount);
    expect(state.candidates.some(candidate => candidate.durationMinutes > cap)).toBe(true);
    expect(project(state)[0].status).toBe('not_satisfied');
  });
  it.each([
    { unit: 'minute' as const, amount: 1, cap: 0.5, rate: null, status: 'not_satisfied' },
    { unit: 'minute' as const, amount: 60, cap: 30.5, rate: null, status: 'not_satisfied' },
    { unit: 'problem' as const, amount: 1, cap: 0.5, rate: 0.25, status: 'not_satisfied' },
    { unit: 'problem' as const, amount: 20, cap: 30.5, rate: 3, status: 'satisfied' },
  ])('preserves original minute rounding but compares the actual preview to unrounded $unit cap$cap', ({ unit, amount, cap, rate, status }) => {
    const state = run(graph(unit, amount, cap, rate));
    expect(state.candidates.every(candidate => Number.isInteger(candidate.durationMinutes))).toBe(true);
    expect(state.schedulerInput.movableWorkItems.reduce((sum, item) => sum + item.quantity.amount, 0)).toBeCloseTo(amount);
    expect(project(state)[0].status).toBe(status);
  });
  it('uses workload over component over task scope without accusing overridden conditions', () => {
    const input = graph();
    input.effortEstimates.push({ ...input.effortEstimates[0], id: 'component-cap', targetFactId: 'component', minutes: 20 },
      { ...input.effortEstimates[0], id: 'work-cap', targetFactId: 'work', minutes: 15 });
    const state = run(input);
    expect(project(state).map(entry => entry.sourceFactId)).toEqual(['work-cap']);
    expect(state.candidates.every(candidate => provenance(candidate).sourceFactRefs.includes('work-cap'))).toBe(true);
    expect(project(state)[0].status).toBe('satisfied');
  });
  it('does not choose conflicting same-scope caps', () => {
    const input = graph(); input.effortEstimates.push({ ...input.effortEstimates[0], id: 'conflict', minutes: 20 });
    expect(compileGenericSchedulerInput({ graph: input, context: { ownerId: 'owner', currentDate: '2026-08-24', planningStartDate: '2026-08-24', planningEndDate: '2026-08-30', timeZone: 'UTC' } })).toMatchObject({ status: 'needs_resolution', input: null });
  });
  it('requires actual candidate identity, revision and selected source provenance', () => {
    const state = run(); const before = structuredClone(state); expect(project(state)[0].status).toBe('satisfied'); expect(state).toEqual(before);
    for (const change of ['task', 'revision', 'candidate-source', 'item-source', 'work-key'] as const) {
      const altered = structuredClone(state);
      if (change === 'item-source') altered.schedulerInput.movableWorkItems.forEach(item => { item.sourceFactRefs = []; });
      else altered.candidates.forEach(candidate => {
        if (change === 'task') provenance(candidate).taskId = 'foreign';
        if (change === 'revision') provenance(candidate).graphRevision += 1;
        if (change === 'candidate-source') provenance(candidate).sourceFactRefs = [];
        if (change === 'work-key') candidate.workItemKey = 'foreign';
      });
      expect(project(altered)[0].status, change).toBe('not_evaluated');
    }
  });
  it('reports computable missing, duplicate, over-cap and clock-mismatch placements as unmet', () => {
    const state = run();
    const missing = structuredClone(state); missing.candidates.pop();
    const duplicate = structuredClone(state); duplicate.candidates.push(structuredClone(duplicate.candidates[0]));
    const clock = structuredClone(state); clock.candidates[0].endTime = clock.candidates[0].startTime;
    const over = structuredClone(state); over.candidates[0].durationMinutes += 1;
    for (const altered of [missing, duplicate, clock, over]) expect(project(altered)[0].status).toBe('not_satisfied');
    expect(project({ ...state, candidates: [] })[0].status).toBe('not_evaluated');
  });
});
