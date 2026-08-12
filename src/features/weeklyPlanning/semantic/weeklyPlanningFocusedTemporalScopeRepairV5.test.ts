import { describe, expect, it } from 'vitest';
import {
  applyFocusedTemporalScopeRepairV5,
  createFocusedTemporalScopeRepairMessagesV5,
  parseFocusedTemporalScopeRepairDecisionV5,
  readFocusedTemporalScopeRepairCandidateV5,
} from './weeklyPlanningFocusedTemporalScopeRepairV5';

function invalidResponse(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 't1',
      title: '数学の問題を進める',
      temporalConstraints: [{
        localId: 'tc1',
        targetLocalId: 't1',
        kind: 'excluded_date',
        constraintLevel: 'hard',
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
        precision: 'exact',
        sourceText: '火曜日の18時から20時は予定があるので避けてください',
      }],
    }],
    availabilityDeclarations: [],
    uncertainties: [],
  });
}

const errors = [
  'document.tasks[0].temporalConstraints[0]:date-rule-cannot-have-clock',
];

describe('Stable V5 focused temporal-scope repair', () => {
  it('extracts only the exact invalid temporal fact selected by validation', () => {
    const candidate = readFocusedTemporalScopeRepairCandidateV5({
      rawResponse: invalidResponse(),
      validationErrors: errors,
    });

    expect(candidate).toMatchObject({
      taskIndex: 0,
      constraintIndex: 0,
      taskTitle: '数学の問題を進める',
      taskLocalId: 't1',
      constraintLocalId: 'tc1',
      dateExpression: 'weekday:tuesday',
      startTime: '18:00',
      endTime: '20:00',
    });
  });

  it('sends only source evidence, current attachment and interpreted time', () => {
    const candidate = readFocusedTemporalScopeRepairCandidateV5({
      rawResponse: invalidResponse(),
      validationErrors: errors,
    });
    if (!candidate) throw new Error('candidate missing');
    const messages = createFocusedTemporalScopeRepairMessagesV5(candidate);
    const payload = JSON.parse(messages[1]?.content ?? '{}') as Record<string, unknown>;

    expect(payload).toEqual({
      sourceText: '火曜日の18時から20時は予定があるので避けてください',
      currentAttachedTask: '数学の問題を進める',
      interpretedTime: {
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
      },
    });
    expect(messages[1]?.content).not.toContain('英単語');
  });

  it('moves a confirmed plan-wide busy interval to availability without rewriting the task', () => {
    const candidate = readFocusedTemporalScopeRepairCandidateV5({
      rawResponse: invalidResponse(),
      validationErrors: errors,
    });
    if (!candidate) throw new Error('candidate missing');
    const repairedRaw = applyFocusedTemporalScopeRepairV5({
      rawResponse: invalidResponse(),
      candidate,
      decision: { decision: 'plan_unavailable' },
    });
    if (!repairedRaw) throw new Error('repair failed');
    const repaired = JSON.parse(repairedRaw) as any;

    expect(repaired.tasks[0].title).toBe('数学の問題を進める');
    expect(repaired.tasks[0].temporalConstraints).toEqual([]);
    expect(repaired.availabilityDeclarations).toEqual([{
      localId: 'tc1__availability',
      kind: 'unavailable',
      dateExpression: 'weekday:tuesday',
      namedTimePeriod: null,
      startTime: '18:00',
      endTime: '20:00',
      recurrenceKind: 'weekly',
      days: ['weekday:tuesday'],
      constraintLevel: 'hard',
      sourceText: '火曜日の18時から20時は予定があるので避けてください',
    }]);
  });

  it('turns non-confirmed scope into an uncertainty instead of guessing', () => {
    const candidate = readFocusedTemporalScopeRepairCandidateV5({
      rawResponse: invalidResponse(),
      validationErrors: errors,
    });
    if (!candidate) throw new Error('candidate missing');
    const repairedRaw = applyFocusedTemporalScopeRepairV5({
      rawResponse: invalidResponse(),
      candidate,
      decision: { decision: 'uncertain' },
    });
    if (!repairedRaw) throw new Error('repair failed');
    const repaired = JSON.parse(repairedRaw) as any;

    expect(repaired.tasks[0].temporalConstraints).toEqual([]);
    expect(repaired.availabilityDeclarations).toEqual([]);
    expect(repaired.uncertainties).toEqual([
      expect.objectContaining({
        targetLocalId: 't1',
        field: 'temporal_scope',
      }),
    ]);
  });

  it('accepts only the two focused decisions and no extra keys', () => {
    expect(parseFocusedTemporalScopeRepairDecisionV5('{"decision":"plan_unavailable"}'))
      .toEqual({ decision: 'plan_unavailable' });
    expect(parseFocusedTemporalScopeRepairDecisionV5('{"decision":"uncertain"}'))
      .toEqual({ decision: 'uncertain' });
    expect(parseFocusedTemporalScopeRepairDecisionV5('{"decision":"plan_unavailable","tasks":[]}'))
      .toBeNull();
  });
});
