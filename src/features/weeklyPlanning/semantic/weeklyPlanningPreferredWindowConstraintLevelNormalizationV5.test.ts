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
});
