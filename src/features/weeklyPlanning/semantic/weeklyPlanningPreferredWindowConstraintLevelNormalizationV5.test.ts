import { describe, expect, it } from 'vitest';
import { normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5 } from './weeklyPlanningPreferredWindowConstraintLevelNormalizationV5';

function response(kind: string, constraintLevel: string): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      temporalConstraints: [{
        localId: 'constraint-1',
        targetLocalId: 'task-1',
        kind,
        constraintLevel,
        dateExpression: '2026-09-10/2026-09-12',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'exact',
        sourceText: '模試対策を優先してください',
      }],
    }],
  });
}

describe('Stable V5 preferred-window constraint-level normalization', () => {
  it('canonicalizes only the typed preferred_window + hard contradiction to soft', () => {
    const result = normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(
      response('preferred_window', 'hard'),
    );
    const parsed = JSON.parse(result.rawResponse) as {
      tasks: Array<{ temporalConstraints: Array<{ constraintLevel: string }> }>;
    };
    expect(parsed.tasks[0]?.temporalConstraints[0]?.constraintLevel).toBe('soft');
    expect(result.repairs).toEqual([
      'preferred-window-constraint-level-canonicalized:0:0:soft',
    ]);
  });

  it('does not weaken hard non-preference constraints', () => {
    const rawResponse = response('deadline', 'hard');
    expect(normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('preserves both explicit hard clocks as canonical bounds and is idempotent', () => {
    const value = JSON.parse(response('preferred_window', 'hard'));
    Object.assign(value.tasks[0].temporalConstraints[0], { startTime: '13:00', endTime: '17:00' });
    const result = normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(JSON.stringify(value));
    const original = value.tasks[0].temporalConstraints[0];
    expect(JSON.parse(result.rawResponse).tasks[0].temporalConstraints).toEqual([
      { ...original, kind: 'earliest_start', endTime: null },
      { ...original, localId: 'constraint-1__latest_end', kind: 'latest_end', startTime: null },
    ]);
    expect(result.repairs).toEqual(['preferred-window-hard-clock-bounds-canonicalized:0:0']);
    expect(normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(result.rawResponse)).toEqual({
      rawResponse: result.rawResponse, repairs: [],
    });
  });

  it.each([
    ['13:00', null, 'earliest_start'], [null, '17:00', 'latest_end'],
  ])('preserves a one-sided hard clock %s–%s as %s', (startTime, endTime, kind) => {
    const value = JSON.parse(response('preferred_window', 'hard'));
    Object.assign(value.tasks[0].temporalConstraints[0], { startTime, endTime });
    const result = normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(JSON.stringify(value));
    expect(JSON.parse(result.rawResponse).tasks[0].temporalConstraints).toEqual([
      { ...value.tasks[0].temporalConstraints[0], kind },
    ]);
  });

  it('keeps synthesized local IDs unique across the whole provider document', () => {
    const value = JSON.parse(response('preferred_window', 'hard'));
    Object.assign(value.tasks[0].temporalConstraints[0], { startTime: '13:00', endTime: '17:00' });
    value.tasks.push({ localId: 'constraint-1__latest_end', workloads: [{ localId: 'constraint-1__latest_end_1' }] });
    const result = normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(JSON.stringify(value));
    expect(JSON.parse(result.rawResponse).tasks[0].temporalConstraints[1].localId).toBe('constraint-1__latest_end_2');
  });

  it('keeps a hard window hard when explicit clocks accompany a named period', () => {
    const value = JSON.parse(response('preferred_window', 'hard'));
    Object.assign(value.tasks[0].temporalConstraints[0], { namedTimePeriod: 'afternoon', startTime: '13:00', endTime: '17:00' });
    const result = normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(JSON.stringify(value));
    expect(JSON.parse(result.rawResponse).tasks[0].temporalConstraints.map((c: Record<string, unknown>) =>
      [c.kind, c.constraintLevel, c.namedTimePeriod, c.startTime, c.endTime])).toEqual([
      ['earliest_start', 'hard', null, '13:00', null],
      ['latest_end', 'hard', null, null, '17:00'],
    ]);
    expect(result.repairs).toEqual(['preferred-window-hard-clock-bounds-canonicalized:0:0']);
  });

  it('retains the existing soft canonicalization for named-period-only windows', () => {
    const value = JSON.parse(response('preferred_window', 'hard'));
    value.tasks[0].temporalConstraints[0].namedTimePeriod = 'afternoon';
    const result = normalizeWeeklyPlanningPreferredWindowConstraintLevelsV5(JSON.stringify(value));
    expect(JSON.parse(result.rawResponse).tasks[0].temporalConstraints).toEqual([
      { ...value.tasks[0].temporalConstraints[0], constraintLevel: 'soft' },
    ]);
    expect(result.repairs).toEqual(['preferred-window-constraint-level-canonicalized:0:0:soft']);
  });
});
