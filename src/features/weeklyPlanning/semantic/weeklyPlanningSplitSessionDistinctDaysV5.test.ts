import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

const meta = { createdRevision: 1, source: {
  conversationId: 'split-days', turnId: 'turn', semanticLocalId: 'local', sourceText: 'typed evidence', origin: 'user' as const,
} };
const SATURDAY = '2026-10-17';
const SUNDAY = '2026-10-18';

function fixture(scope: 'recurrence' | 'preferred' | 'all' = 'recurrence', minutes = 90, total = 180) {
  const graph: WeeklyPlanningFactGraphV5 = {
    ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
    tasks: [{ id: 'research', title: '卒業研究ノート', category: 'study', ...meta }],
    workloads: [{ id: 'research-work', taskId: 'research', componentId: null, quantityRole: 'target',
      amount: total, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, ...meta }],
    effortEstimates: [{ id: 'session', taskId: 'research', targetFactId: 'research', kind: 'session_duration',
      minutes, unitCode: 'session', precision: 'approximate', ...meta }],
    recurrences: scope === 'recurrence' ? [{ id: 'weekends', taskId: 'research', targetFactId: 'research',
      kind: 'weekends', count: null, days: ['weekday:saturday', 'weekday:sunday'], ...meta }] : [],
    temporalConstraints: scope === 'preferred' ? [{ id: 'weekend-preference', taskId: 'research', targetFactId: 'research',
      kind: 'preferred_window', constraintLevel: 'soft', dateExpression: `${SATURDAY}/${SUNDAY}`, namedTimePeriod: null,
      startTime: '18:00', endTime: '22:00', precision: 'exact', ...meta }] : [],
  };
  const input = compileGenericSchedulerInput({ graph, context: {
    ownerId: 'owner', currentDate: '2026-10-07', planningStartDate: '2026-10-12', planningEndDate: SUNDAY, timeZone: 'Asia/Tokyo',
  } }).input!;
  const run = () => scheduleWeeklyPlanningStableV5Preview({ input, graph: createWeeklyPlanningPlacementGraphViewV5(graph) });
  return { graph, input, run };
}

describe('split sessions prefer distinct feasible dates of the same workload', () => {
  it.each(['recurrence', 'preferred'] as const)('places two weekend sessions on Saturday and Sunday (%s)', scope => {
    const { run } = fixture(scope);
    const result = run();
    expect(result.status).toBe('ready');
    expect(result.candidates.map(candidate => candidate.date)).toEqual([SATURDAY, SUNDAY]);
    expect(result.candidates.map(candidate => candidate.durationMinutes)).toEqual([90, 90]);
    if (scope === 'preferred') expect(result.candidates.every(candidate => candidate.startTime >= '18:00')).toBe(true);
  });

  it('falls back to Saturday when a hard deadline excludes Sunday', () => {
    const { input, run } = fixture();
    input.hardDateBounds = [{ taskId: 'research', targetFactId: 'research', startDate: null, endDate: SATURDAY, sourceFactIds: ['deadline'] }];
    const result = run();
    expect(result.status).toBe('ready');
    expect(result.candidates.map(candidate => candidate.date)).toEqual([SATURDAY, SATURDAY]);
    expect(result.candidates[1].startTime > result.candidates[0].endTime).toBe(true);
  });

  it.each(['busy', 'capacity'] as const)('reuses Saturday when Sunday has no feasible slot (%s)', blocked => {
    const { input, run } = fixture();
    if (blocked === 'busy') input.availabilityWindows.push({
      id: 'sunday-busy', kind: 'occupied', start: { date: SUNDAY, time: '00:00' }, end: { date: SUNDAY, time: '24:00' },
      timeZone: 'Asia/Tokyo', constraintLevel: 'hard', sourceKind: 'existing_plan', sourceRef: 'saved-plan', ownerId: 'owner', graphRevision: 1,
    });
    else input.dailyCapacityLimits = [{ date: SUNDAY, maxMinutes: 0, sourceFactIds: ['capacity'] }];
    const result = run();
    expect(result.status).toBe('ready');
    expect(result.candidates.map(candidate => candidate.date)).toEqual([SATURDAY, SATURDAY]);
  });

  it('keeps an explicit preferred Saturday ahead of a free but nonpreferred Sunday', () => {
    const { input, run } = fixture('preferred');
    input.preferredPlacements.forEach(placement => { placement.dates = [SATURDAY]; });
    const result = run();
    expect(result.status).toBe('ready');
    expect(result.candidates.map(candidate => candidate.date)).toEqual([SATURDAY, SATURDAY]);
    expect(result.candidates.every(candidate => candidate.startTime >= '18:00')).toBe(true);
  });

  it('uses both eligible days before reusing a day for a third session', () => {
    const result = fixture('recurrence', 60, 180).run();
    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(3);
    expect(new Set(result.candidates.map(candidate => candidate.date))).toEqual(new Set([SATURDAY, SUNDAY]));
  });

  it('keeps the ordinary seventh day as reserve when no explicit day scope requires it', () => {
    const result = fixture('all', 60, 420).run();
    expect(result.status).toBe('ready');
    expect(result.candidates).toHaveLength(7);
    expect(new Set(result.candidates.map(candidate => candidate.date)).size).toBe(6);
    expect(result.candidates.some(candidate => candidate.date === SUNDAY)).toBe(false);
  });

  it('does not treat separate workload identities on the same task as sessions of one workload', () => {
    const { input, run } = fixture();
    input.movableWorkItems[1].workloadFactId = 'independent-work';
    const result = run();
    expect(result.status).toBe('ready');
    expect(result.candidates.map(candidate => candidate.date)).toEqual([SATURDAY, SATURDAY]);
  });
});
