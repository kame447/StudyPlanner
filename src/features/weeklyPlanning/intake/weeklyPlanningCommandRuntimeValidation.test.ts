import { describe, expect, it } from 'vitest';
import {
  canonicalizeOptionalCommandNulls,
  isValidWeeklyPlanningCommand,
} from './weeklyPlanningCommandRuntimeValidation';

describe('weekly planning command runtime validation', () => {
  it('rejects duplicate exam fields at the command boundary', () => {
    expect(isValidWeeklyPlanningCommand({
      type: 'set_exam_scope',
      scope: {
        fields: ['数学', '数学'],
        yearRange: { startYear: 2025, endYear: 2020, sourceText: '2025〜2020' },
        rawText: ['数学'],
      },
      sourceText: '数学',
      confidence: 'high',
    })).toBe(false);
  });

  it('accepts a pending planning range with only an end boundary', () => {
    expect(isValidWeeklyPlanningCommand({
      type: 'set_pending_planning_range',
      pending: {
        scope: {
          kind: 'named_future_period',
          label: '日曜日まで',
          windowEndDate: '2026-07-19',
        },
        planningEndDateTime: '2026-07-19T24:00:00',
        sourceText: '日曜日までの予定を立てて',
      },
      sourceText: '日曜日までの予定を立てて',
      confidence: 'high',
    })).toBe(true);
  });

  it.each([
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first' },
      sourceText: '数学優先',
      confidence: 'high',
    },
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first', order: [null] },
      sourceText: '数学優先',
      confidence: 'high',
    },
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first', order: ['数学'] },
      sourceText: null,
      confidence: 'high',
    },
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first', order: ['数学'] },
      sourceText: '数学優先',
      confidence: null,
    },
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first', order: ['数学'] },
      sourceText: '数学優先',
    },
  ])('rejects malformed required command fields %#', (command) => {
    expect(isValidWeeklyPlanningCommand(command)).toBe(false);
  });

  it('canonicalizes blank optional AI fields without interpreting their meaning', () => {
    const canonicalized = canonicalizeOptionalCommandNulls({
      type: 'set_study_goal',
      goal: {
        title: '研究の進捗を作る',
        subject: '研究',
        unit: 'unknown',
        amount: 1,
        deadlineDeclared: false,
        deadlineDate: '',
        deadlineTime: '',
        executionProfile: {
          activityKind: 'project',
          distributionPolicy: 'single_block',
          cognitiveLoad: 'unknown',
        },
      },
      sourceText: '研究の進捗を作る',
      sourceSegment: '',
      confidence: 'high',
    }) as Record<string, unknown>;
    const goal = canonicalized.goal as Record<string, unknown>;

    expect(canonicalized.sourceSegment).toBeUndefined();
    expect(goal.deadlineDeclared).toBeUndefined();
    expect(goal.deadlineDate).toBeUndefined();
    expect(goal.deadlineTime).toBeUndefined();
    expect(isValidWeeklyPlanningCommand(canonicalized)).toBe(true);
  });

});
