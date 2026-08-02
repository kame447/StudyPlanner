import { describe, expect, it } from 'vitest';
import {
  groundedDateExpressionsFromPlanningInformation,
} from './weeklyPlanningDialogueDateGrounding';

describe('Stable V5 dialogue date grounding', () => {
  it('derives Japanese display labels from canonical relative planning facts', () => {
    expect(groundedDateExpressionsFromPlanningInformation({
      planningWindows: [
        { kind: 'relative_day', value: 'tomorrow', start: null, end: null },
        { kind: 'relative_week', value: 'next_week', start: null, end: null },
      ],
    })).toEqual(['明日', '来週']);
  });

  it('derives month-day labels from valid absolute dates across supported date fields', () => {
    expect(groundedDateExpressionsFromPlanningInformation({
      planningWindows: [
        { kind: 'absolute', value: '2026-08-04', start: '2026-08-04', end: '2026-08-05' },
      ],
      temporalConstraints: [{ dateExpression: '2026-08-06' }],
      taskDateRules: [{ dateExpression: '2026-08-07' }],
      availabilityDeclarations: [{ dateExpression: '2026-08-08' }],
    })).toEqual([
      '8月4日',
      '8月5日',
      '8月6日',
      '8月7日',
      '8月8日',
    ]);
  });

  it('does not authorize unknown aliases or invalid calendar dates', () => {
    expect(groundedDateExpressionsFromPlanningInformation({
      planningWindows: [
        { kind: 'relative_day', value: 'next_day', start: null, end: null },
        { kind: 'absolute', value: '2026-02-30', start: null, end: null },
      ],
      temporalConstraints: [{ dateExpression: 'custom:試験前' }],
    })).toEqual([]);
  });
});
