import { describe, expect, it } from 'vitest';
import {
  questionIntentForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';

describe('Stable V5 resolution question intents', () => {
  it('keeps quantity-role choices on target-versus-remaining semantics', () => {
    expect(questionIntentForStableV5Dialogue({
      questionCode: 'quantity_role_unresolved',
      questionTarget: {
        collection: 'workloads',
        fact: {
          id: 'workload-1',
          amount: 20,
          unitLabel: 'ページ',
        },
      },
    })).toEqual(expect.objectContaining({
      kind: 'resolution_question',
      resolutionKind: 'quantity_role',
      requestedInformation: ['quantity_role'],
      allowedChoices: ['plan_target_amount', 'remaining_total_amount'],
      knownAmount: 20,
      knownUnitLabel: 'ページ',
    }));
  });

  it.each([
    ['semantic_uncertainty', 'semantic_clarification', 'clarify_ambiguous_meaning'],
    ['invalid_planning_horizon', 'planning_horizon', 'planning_period'],
    ['ambiguous_planning_window', 'planning_window_choice', 'single_planning_window'],
    ['ambiguous_effort_estimate', 'effort_estimate_choice', 'choose_effort_estimate'],
    ['missing_availability_date_scope', 'availability_date_scope', 'availability_date_scope'],
    ['missing_time_bounds', 'time_bounds', 'start_and_end_time'],
    ['invalid_time_interval', 'time_bounds', 'start_and_end_time'],
    ['named_time_period_unresolved', 'named_time_period_bounds', 'named_time_period_start_and_end'],
    ['missing_commitment_date_scope', 'commitment_date_scope', 'commitment_date'],
    ['invalid_commitment_interval', 'commitment_time_bounds', 'commitment_start_and_end_time'],
    ['conflicting_task_date_rule', 'task_date_rule_conflict', 'allowed_or_excluded_date_rule'],
    ['constraint_source_unavailable', 'constraint_source_choice', 'constraint_source'],
    ['active_constraint_source_missing', 'constraint_source_choice', 'constraint_source'],
    ['orphan_relation_task', 'task_relation', 'valid_task_order_or_relation'],
    ['self_relation', 'task_relation', 'valid_task_order_or_relation'],
  ] as const)('maps %s to an explicit typed purpose', (questionCode, resolutionKind, requested) => {
    const intent = questionIntentForStableV5Dialogue({
      questionCode,
      questionTarget: null,
    });
    expect(intent).toEqual(expect.objectContaining({
      kind: 'resolution_question',
      resolutionKind,
      requestedInformation: [requested],
    }));
  });

  it('does not turn relation repair into a task-addition decision', () => {
    const intent = questionIntentForStableV5Dialogue({
      questionCode: 'orphan_relation_task',
      questionTarget: null,
    });
    expect(intent).toEqual(expect.objectContaining({
      resolutionKind: 'task_relation',
      requestedInformation: ['valid_task_order_or_relation'],
      allowedChoices: [],
    }));
  });
});
