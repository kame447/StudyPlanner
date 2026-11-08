import { describe, expect, it } from 'vitest';
import { PLANNING_QUESTION_CODES, PLANNING_TURN_REJECTION_REASONS } from '../../shared/productObservabilityContract';
import type { ObservabilityPlanningAggregate } from '../../shared/productObservabilityReadModel';
import type { VNextQuestionCode } from '../features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { PLANNING_QUESTION_LABELS, PLANNING_REJECTION_LABELS, planningBreakdown } from './planningQuestionBreakdown';

const base: ObservabilityPlanningAggregate = { outcomeCounts: {}, previewCountSum: 0, previewCountUnknownCount: 0,
  unscheduledCountSum: 0, unscheduledCountUnknownCount: 0 };

describe('planning question and rejection breakdown', () => {
  it('lists exactly the VNext question codes (a new code must be added to the telemetry list too)', () => {
    const vnext = { semantic_uncertainty: 1, learning_strategy_proposal: 1, quantity_role_unresolved: 1, quantity_basis_invalid: 1, duplicate_quantity: 1,
      completed_exceeds_total: 1, remaining_inconsistent: 1, same_or_distinct_work: 1, missing_effort_estimate: 1, effort_inconsistent: 1,
      invalid_commitment_interval: 1, missing_schedulable_work: 1 } satisfies Record<VNextQuestionCode, 1>;
    expect([...PLANNING_QUESTION_CODES].sort()).toEqual(Object.keys(vnext).sort());
    expect(Object.keys(PLANNING_QUESTION_LABELS).sort()).toEqual([...PLANNING_QUESTION_CODES].sort());
    expect(Object.keys(PLANNING_REJECTION_LABELS).sort()).toEqual([...PLANNING_TURN_REJECTION_REASONS].sort());
  });

  it('reports a period without the counts as unmeasured, never as zero', () => {
    expect(planningBreakdown(base)).toEqual({ questions: null, rejections: null, measuredDays: null });
    expect(planningBreakdown(undefined)).toEqual({ questions: null, rejections: null, measuredDays: null });
  });

  it('labels and orders the counts, hides zeros, and keeps a measured empty period distinct from unmeasured', () => {
    const measured = planningBreakdown({ ...base, questionCodeCounts: { missing_effort_estimate: 5, duplicate_quantity: 1, same_or_distinct_work: 5 },
      rejectionReasonCounts: { rejected_after_repair: 2 }, questionCountDays: 3 });
    expect(measured.questions).toEqual([
      { key: 'missing_effort_estimate', label: '所要時間の確認', count: 5 },
      { key: 'same_or_distinct_work', label: '同じ作業か別か', count: 5 },
      { key: 'duplicate_quantity', label: '量の重複', count: 1 },
    ]);
    expect(measured.rejections).toEqual([{ key: 'rejected_after_repair', label: '修復の後も受理されない', count: 2 }]);
    expect(measured.measuredDays).toBe(3);
    expect(planningBreakdown({ ...base, questionCodeCounts: {}, rejectionReasonCounts: {}, questionCountDays: 1 }))
      .toEqual({ questions: [], rejections: [], measuredDays: 1 });
  });

  it('never shows a key outside the closed lists', () => {
    const text = JSON.stringify(planningBreakdown({ ...base, questionCodeCounts: { duplicate_quantity: 1, '予定を作って': 9 } as never, questionCountDays: 1 }));
    expect(text).not.toContain('予定を作って');
  });
});
