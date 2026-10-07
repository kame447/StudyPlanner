// Strict regressions derived from the independent MAJOR-1 probe at 47e26b15.
import { describe, expect, it } from 'vitest';
import type { SemanticWorkloadUnitCode } from './weeklyPlanningSemanticDocument';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';
import { projectWeeklyPlanningPreviewConstraintSatisfaction } from '../application/weeklyPlanningPreviewConstraintSatisfaction';

const meta = { createdRevision: 1, source: {
  conversationId: 'probe', turnId: 'turn', semanticLocalId: 'local', sourceText: 'typed evidence', origin: 'user' as const,
} };

function run(unitCode: SemanticWorkloadUnitCode, amount: number, perUnit: number | null, session: number, rangeStart?: number, fixed = false) {
  const graph: WeeklyPlanningFactGraphV5 = {
    ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
    tasks: [{ id: 'book', title: 'アルゴリズムイントロダクション', category: 'study', ...meta }],
    workloads: [{ id: 'book-work', taskId: 'book', componentId: null, quantityRole: 'target',
      amount, unitCode, unitLabel: unitCode === 'page' ? 'ページ' : unitCode === 'problem' ? '問' : unitCode === 'minute' ? '分' : unitCode,
      rangeStart: rangeStart === undefined ? null : String(rangeStart),
      rangeEnd: rangeStart === undefined ? null : String(rangeStart + amount - 1),
      perOccurrence: false, periodExpression: null, ...meta }],
    temporalConstraints: fixed ? [{ id: 'fixed', taskId: 'book', targetFactId: 'book', kind: 'fixed_interval', constraintLevel: 'hard',
      dateExpression: '2026-10-14', namedTimePeriod: null, startTime: '18:00', endTime: '21:00', precision: 'exact', ...meta }] : [],
    effortEstimates: [
      ...(perUnit === null ? [] : [{ id: 'pace', taskId: 'book', targetFactId: 'book-work', kind: 'duration_per_unit' as const,
        minutes: perUnit, unitCode, precision: 'approximate' as const, ...meta }]),
      { id: 'session', taskId: 'book', targetFactId: 'book', kind: 'session_duration' as const,
        minutes: session, unitCode: 'session' as const, precision: 'approximate' as const, ...meta },
    ],
  };
  const compiled = compileGenericSchedulerInput({ graph, context: {
    ownerId: 'owner', currentDate: '2026-10-07', planningStartDate: '2026-10-12', planningEndDate: '2026-10-18', timeZone: 'Asia/Tokyo',
  } });
  const input = compiled.input!;
  const result = scheduleWeeklyPlanningStableV5Preview({ input, graph: createWeeklyPlanningPlacementGraphViewV5(graph) });
  const satisfaction = projectWeeklyPlanningPreviewConstraintSatisfaction({ graph, schedulerInput: input, candidates: result.candidates });
  return { graph, compiled, input, result, satisfaction };
}


describe('explicit content-unit session caps precede allocation margins', () => {
  it.each(['page', 'problem'] as const)('splits 40 %s at three minutes into two capped sessions with exact ranges', unit => {
    const { input, result, satisfaction } = run(unit, 40, 3, 60);
    expect(result.status).toBe('ready');
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([60, 60]);
    expect(new Set(result.candidates.map(candidate => candidate.date)).size).toBe(2);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([20, 20]);
    expect(input.movableWorkItems.map(item => item.quantity.ordinalRange)).toEqual([{ start: 1, end: 20 }, { start: 21, end: 40 }]);
    expect(input.movableWorkItems.every(item => item.sourceFactRefs.includes('session'))).toBe(true);
    expect(satisfaction).toMatchObject([{ kind: 'session_duration', status: 'satisfied' }]);
  });

  it.each(['page', 'problem'] as const)('clamps the margin for a single 60-minute %s session', unit => {
    const { input, result, satisfaction } = run(unit, 20, 3, 60);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([60]);
    expect(input.movableWorkItems[0].quantity.amount).toBe(20);
    expect(input.movableWorkItems[0].baseEstimatedMinutes).toBe(60);
    expect(satisfaction[0].status).toBe('satisfied');
    expect(result.candidates[0].allocationBreakdown).toMatchObject({
      estimatedMinutes: 60, allocatedMinutes: 60, marginMinutes: 0,
    });
  });

  it('preserves explicit page ranges and true base estimates after capping the margin', () => {
    const { input, result } = run('page', 40, 3, 60, 21);
    expect(input.movableWorkItems.map(item => item.quantity.actualRange)).toEqual([
      { start: '21', end: '40' }, { start: '41', end: '60' },
    ]);
    expect(result.candidates.map(candidate => candidate.title)).toEqual([
      'アルゴリズムイントロダクション 20ページ（21〜40ページ）', 'アルゴリズムイントロダクション 20ページ（41〜60ページ）',
    ]);
    expect(result.candidates.map(candidate => candidate.allocationBreakdown)).toMatchObject([
      { estimatedMinutes: 60, allocatedMinutes: 60, marginMinutes: 0 },
      { estimatedMinutes: 60, allocatedMinutes: 60, marginMinutes: 0 },
    ]);
  });

  it('keeps partial margin inside the cap and does not inflate content effort', () => {
    const { result } = run('page', 21, 3, 60);
    expect(result.candidates.reduce((sum, candidate) => sum + candidate.allocationBreakdown!.estimatedMinutes, 0)).toBe(63);
    expect(result.candidates.reduce((sum, candidate) => sum + candidate.allocationBreakdown!.marginMinutes, 0)).toBe(12);
  });

  it('retains an indivisible unit’s real cost and discloses an infeasible cap', () => {
    const { input, result, satisfaction } = run('page', 1, 35, 20);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([40]);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([1]);
    expect(input.movableWorkItems[0].sourceFactRefs).toContain('session');
    expect(satisfaction[0].status).toBe('not_satisfied');
  });

  it('uses enough sessions for whole units rather than just dividing aggregate effort', () => {
    const { input, result, satisfaction } = run('page', 31, 3, 31);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([8, 8, 8, 7]);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([27, 27, 27, 24]);
    expect(input.movableWorkItems.map(item => item.baseEstimatedMinutes)).toEqual([24, 24, 24, 21]);
    expect(satisfaction[0].status).toBe('satisfied');
  });

  it('allocates each content cost before sharing the remaining capped margin', () => {
    const { input, result, satisfaction } = run('page', 3, 10, 22);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([2, 1]);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([22, 13]);
    expect(result.candidates.map(candidate => candidate.allocationBreakdown)).toMatchObject([
      { estimatedMinutes: 20, allocatedMinutes: 22, marginMinutes: 2 },
      { estimatedMinutes: 10, allocatedMinutes: 13, marginMinutes: 3 },
    ]);
    expect(satisfaction[0].status).toBe('satisfied');
  });

  it('never gives a larger content slice less time than its own estimate', () => {
    const { input, result } = run('problem', 5, 29, 60);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([2, 2, 1]);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([60, 60, 45]);
    expect(result.candidates.every(candidate => candidate.durationMinutes >= candidate.allocationBreakdown!.calibratedMinutes)).toBe(true);
  });

  it.each([[21, [39, 36]], [41, [51, 51, 48]]] as const)('balances %d pages without a margin-only tail', (amount, expected) => {
    const { input, result } = run('page', amount, 3, 60);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual(expected);
    expect(input.movableWorkItems.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(amount);
    expect(input.movableWorkItems.reduce((sum, item) => sum + (item.baseEstimatedMinutes ?? 0), 0)).toBeCloseTo(amount * 3);
    expect(result.candidates.every(candidate => candidate.durationMinutes >= 15 && candidate.durationMinutes <= 60)).toBe(true);
  });

  it('does not misclassify a computable violation as unevaluated', () => {
    const { graph, input, result } = run('page', 20, 3, 60);
    result.candidates[0].durationMinutes = 70;
    result.candidates[0].endTime = '10:10';
    expect(projectWeeklyPlanningPreviewConstraintSatisfaction({ graph, schedulerInput: input, candidates: result.candidates }))
      .toMatchObject([{ status: 'not_satisfied' }]);
  });

  it('keeps the intrinsic-duration control unchanged', () => {
    const { result, satisfaction } = run('minute', 120, null, 60);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([60, 60]);
    expect(satisfaction[0].status).toBe('satisfied');
  });
});


// Strict expectations for every row of the independent critic's ab3d2e6e probe2.
describe('all countable content units honor session caps', () => {
  it.each<{ unit: SemanticWorkloadUnitCode; amount: number; pace: number | null; cap: number; durations: number[]; quantities: number[]; satisfied: boolean }>([
    { unit: 'page', amount: 40, pace: 3, cap: 60, durations: [60, 60], quantities: [20, 20], satisfied: true },
    { unit: 'page', amount: 25, pace: 3, cap: 60, durations: [47, 43], quantities: [13, 12], satisfied: true },
    { unit: 'problem', amount: 7, pace: 10, cap: 30, durations: [30, 30, 30], quantities: [3, 2, 2], satisfied: true },
    { unit: 'word', amount: 300, pace: 0.2, cap: 30, durations: [30, 30], quantities: [150, 150], satisfied: true },
    { unit: 'lesson', amount: 4, pace: 40, cap: 60, durations: [45, 45, 45, 45], quantities: [1, 1, 1, 1], satisfied: true },
    { unit: 'chapter', amount: 3, pace: 50, cap: 60, durations: [55, 55, 55], quantities: [1, 1, 1], satisfied: true },
    { unit: 'section', amount: 3, pace: 40, cap: 60, durations: [45, 45, 45], quantities: [1, 1, 1], satisfied: true },
    { unit: 'exam_year', amount: 3, pace: 90, cap: 60, durations: [100, 100, 100], quantities: [1, 1, 1], satisfied: false },
    { unit: 'custom', amount: 6, pace: 20, cap: 60, durations: [60, 60], quantities: [3, 3], satisfied: true },
    { unit: 'minute', amount: 120, pace: null, cap: 60, durations: [60, 60], quantities: [60, 60], satisfied: true },
  ])('probe2: $unit × $amount at $pace minutes, cap $cap', ({ unit, amount, pace, cap, durations, quantities, satisfied }) => {
    const { input, result, satisfaction } = run(unit, amount, pace, cap);
    expect(result.status).toBe('ready');
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual(durations);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual(quantities);
    expect(input.movableWorkItems.every(item => item.sourceFactRefs.includes('session'))).toBe(true);
    expect(result.candidates.every(candidate => candidate.durationMinutes >= candidate.allocationBreakdown!.calibratedMinutes)).toBe(true);
    expect(satisfaction).toMatchObject([{ kind: 'session_duration', status: satisfied ? 'satisfied' : 'not_satisfied' }]);
  });

  it('probe2 fixed commitments retain their fixed date and time', () => {
    const { input } = run('page', 40, 3, 60, undefined, true);
    expect(input.movableWorkItems).toEqual([]);
    expect(input.fixedTaskReservations).toMatchObject([{
      start: { date: '2026-10-14', time: '18:00' }, end: { date: '2026-10-14', time: '21:00' },
    }]);
  });

  it('keeps mock exams atomic and evaluates an unmet session cap', () => {
    const { input, result, satisfaction } = run('mock_exam', 1, 120, 60);
    expect(input.movableWorkItems).toHaveLength(1);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([135]);
    expect(satisfaction[0].status).toBe('not_satisfied');
  });

  it.each([60, 20])('keeps fractional custom quantities intact and evaluates cap %d', cap => {
    const { input, result, satisfaction } = run('custom', 1.5, 20, cap);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([1.5]);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([35]);
    expect(satisfaction[0].status).toBe(cap >= 35 ? 'satisfied' : 'not_satisfied');
  });

  it('keeps bounded fallback work and evaluates its actual duration when integer slices exceed the chunk limit', () => {
    // Aggregate duration fits the compiler's limit, but 513 whole units each need a separate one-minute slice.
    const { input, result, satisfaction } = run('word', 513, 0.51, 1);
    expect(input.movableWorkItems).toHaveLength(1);
    expect(input.movableWorkItems[0].quantity.amount).toBe(513);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].durationMinutes).toBeGreaterThan(1);
    expect(satisfaction[0].status).toBe('not_satisfied');
  });

  it('preserves counted-session and intrinsic-hour semantics', () => {
    for (const unit of ['session', 'hour'] as const) {
      const { input, result, satisfaction } = run(unit, 2, null, 60);
      expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([1, 1]);
      expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([60, 60]);
      expect(satisfaction[0].status).toBe('satisfied');
    }
  });
});
