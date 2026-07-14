import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { applyRelativeConstraintTurn } from './weeklyPlanningRelativeConstraintAdapter';

describe('weeklyPlanningRelativeConstraintAdapter', () => {
  it('adds a validated commute after one explicit work anchor', () => {
    const state = {
      ...createInitialPlanningIntakeState(),
      constraints: [{
        kind: 'fixed_event' as const,
        date: '2026-07-14',
        start: '18:00',
        end: '22:00',
        hardness: 'hard' as const,
        rawText: '火曜のバイト',
      }],
      sourceTurns: ['来週の予定', '火曜のバイト', 'バイトの後、帰宅10分'],
    };
    const result = applyRelativeConstraintTurn({ state, userText: 'バイトの後、帰宅10分して夕食' });
    expect(result.resolution.resolved).toHaveLength(1);
    expect(result.state.constraints[1]).toMatchObject({
      kind: 'commute',
      date: '2026-07-14',
      start: '22:00',
      end: '22:10',
    });
  });

  it('does not guess when multiple anchors match the same vague label', () => {
    const state = {
      ...createInitialPlanningIntakeState(),
      constraints: [
        { kind: 'fixed_event' as const, date: '2026-07-14', start: '10:00', end: '11:00', hardness: 'hard' as const, rawText: '予定A' },
        { kind: 'fixed_event' as const, date: '2026-07-14', start: '13:00', end: '14:00', hardness: 'hard' as const, rawText: '予定B' },
      ],
      sourceTurns: ['予定を登録', '予定の前後30分'],
    };
    const result = applyRelativeConstraintTurn({ state, userText: '予定の前後30分は空けて' });
    expect(result.state.constraints).toHaveLength(2);
    expect(result.resolution.resolved).toHaveLength(0);
  });
});
