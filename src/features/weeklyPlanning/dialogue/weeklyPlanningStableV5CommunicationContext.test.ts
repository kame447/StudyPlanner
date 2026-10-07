import { describe, expect, it } from 'vitest';
import {
  communicationContextForStableV5Dialogue,
  questionPurposesForStableV5Dialogue,
} from './weeklyPlanningStableV5CommunicationContext';
import {
  WEEKLY_PLANNING_STABLE_V5_QUESTION_PURPOSES,
  type WeeklyPlanningStableV5DialogueQuestionIntent,
} from './weeklyPlanningStableV5DialogueContracts';
import type { WeeklyPlanningTurnCommunicationFacts } from '../application/weeklyPlanningInteractionOutcome';

const facts = (overrides: Partial<WeeklyPlanningTurnCommunicationFacts> = {}): WeeklyPlanningTurnCommunicationFacts => ({
  statusReason: null,
  upcomingQuestionCodes: [],
  planningDetailsNotApplied: false,
  previewDisclosure: null,
  ...overrides,
});

const effort = (measurement: 'total_duration' | 'duration_per_unit' | 'session_duration') => ({
  kind: 'effort_measurement', measurement, quantityRole: 'target', targetFactId: 'wl', amount: 20, unitCode: 'problem', unitLabel: '問',
}) as WeeklyPlanningStableV5DialogueQuestionIntent;

describe('communication goal (deterministic WHAT of a reply)', () => {
  it('follows the typed interaction outcome, never the user text', () => {
    const goal = (kind: string | undefined, actionKind: 'question' | 'status' | 'preview_ready') =>
      communicationContextForStableV5Dialogue({
        outcome: kind === undefined ? undefined : (kind === 'recover'
          ? { kind: 'recover', failure: 'semantic', representedQuestion: actionKind === 'question' }
          : { kind, consultationDeferred: false }) as never,
        facts: facts(),
        actionKind,
        questionCode: actionKind === 'question' ? 'missing_effort_estimate' : null,
        questionIntent: null,
      }).goal;
    expect(goal('explain_pending_question', 'question')).toBe('explain_question');
    expect(goal('aside', 'status')).toBe('acknowledge_aside');
    expect(goal('resume_pending_question', 'question')).toBe('resume_question');
    expect(goal('recover', 'question')).toBe('clarify_turn');
    expect(goal('recover', 'status')).toBe('clarify_turn');
    expect(goal('apply', 'question')).toBe('ask_question');
    expect(goal('apply', 'status')).toBe('report_status');
    expect(goal('apply', 'preview_ready')).toBe('present_preview');
    expect(goal(undefined, 'question')).toBe('ask_question');
  });

  it('asks the question only when the reply presents one, and scopes status/disclosure to their goals', () => {
    const disclosure = { omittedWorkLabels: ['英語'] };
    const status = communicationContextForStableV5Dialogue({
      outcome: { kind: 'apply', consultationDeferred: true },
      facts: facts({ statusReason: 'ready_to_create_preview', previewDisclosure: disclosure, planningDetailsNotApplied: true }),
      actionKind: 'status',
      questionCode: null,
      questionIntent: null,
    });
    expect(status).toMatchObject({
      goal: 'report_status',
      askQuestion: false,
      questionPurposes: [],
      statusReason: 'ready_to_create_preview',
      previewDisclosure: null,
      planningDetailsNotApplied: true,
      consultationDeferred: true,
    });
    const preview = communicationContextForStableV5Dialogue({
      outcome: { kind: 'apply', consultationDeferred: false },
      facts: facts({ statusReason: 'ready_to_create_preview', previewDisclosure: disclosure }),
      actionKind: 'preview_ready',
      questionCode: null,
      questionIntent: null,
    });
    expect(preview).toMatchObject({ goal: 'present_preview', statusReason: null, previewDisclosure: disclosure });
  });

  it('lists later open needs by purpose, without the current purpose, deduplicated and bounded', () => {
    const context = communicationContextForStableV5Dialogue({
      outcome: { kind: 'explain_pending_question', consultationDeferred: false },
      facts: facts({
        upcomingQuestionCodes: [
          'missing_effort_estimate', 'missing_effort_estimate', 'semantic_uncertainty',
          'invalid_planning_horizon', 'missing_time_bounds', 'self_relation',
        ],
      }),
      actionKind: 'question',
      questionCode: 'semantic_uncertainty',
      questionIntent: {
        kind: 'resolution_question', resolutionKind: 'semantic_clarification', targetFactId: 'u', requestedInformation: ['clarify_ambiguous_meaning'],
        allowedChoices: [], knownAmount: null, knownUnitLabel: null, ambiguityField: 'work_breakdown', ambiguityReason: 'r',
      },
    });
    expect(context.questionPurposes).toEqual(['identify_which_work_and_how_much']);
    expect(context.laterNeeds).toEqual([
      'estimate_time_to_fit_available_time', 'resolve_unclear_detail', 'set_planning_period',
    ]);
  });
});

describe('question purpose codes', () => {
  it('refines the purpose from the typed intent', () => {
    expect(questionPurposesForStableV5Dialogue({ questionCode: 'missing_effort_estimate', questionIntent: effort('duration_per_unit') }))
      .toEqual(['estimate_time_to_fit_available_time']);
    expect(questionPurposesForStableV5Dialogue({ questionCode: 'missing_effort_estimate', questionIntent: effort('session_duration') }))
      .toEqual(['set_session_length']);
    for (const [mode, purpose] of [
      ['existing_target_progress', 'skip_already_finished_work'],
      ['registered_material_target_scope', 'choose_scope_for_this_plan'],
      ['missing_task_identity', 'identify_work_to_schedule'],
      ['all_requested_work_complete', 'find_more_work_or_constraints'],
    ] as const) {
      expect(questionPurposesForStableV5Dialogue({
        questionCode: 'missing_schedulable_work',
        questionIntent: {
          kind: 'schedulable_work_detail', mode, targetFactId: null, progressBasis: null,
          knownUnitCode: null, knownUnitLabel: null, requestedInformation: ['current_progress'],
        },
      })).toEqual([purpose]);
    }
  });

  it('falls back to the code, and to a generic purpose for an unknown code', () => {
    expect(questionPurposesForStableV5Dialogue({ questionCode: 'quantity_role_unresolved', questionIntent: null }))
      .toEqual(['tell_plan_amount_from_remaining_total']);
    expect(questionPurposesForStableV5Dialogue({ questionCode: 'insufficient_capacity', questionIntent: null }))
      .toEqual(['make_the_plan_fit_available_time']);
    expect(questionPurposesForStableV5Dialogue({ questionCode: 'a_future_question_code', questionIntent: null }))
      .toEqual(['complete_planning_information']);
    expect(questionPurposesForStableV5Dialogue({ questionCode: null, questionIntent: null })).toEqual([]);
  });

  it('every produced purpose is a declared machine code', () => {
    const codes = [
      'missing_effort_estimate', 'ambiguous_effort_estimate', 'missing_schedulable_work', 'semantic_uncertainty',
      'invalid_planning_horizon', 'ambiguous_planning_window', 'quantity_role_unresolved', 'missing_availability_date_scope',
      'missing_time_bounds', 'invalid_time_interval', 'named_time_period_unresolved', 'missing_commitment_date_scope',
      'invalid_commitment_interval', 'conflicting_task_date_rule', 'constraint_source_unavailable',
      'active_constraint_source_missing', 'orphan_relation_task', 'self_relation', 'learning_strategy_proposal',
      'insufficient_capacity', 'unknown_code',
    ];
    for (const code of codes) {
      for (const purpose of questionPurposesForStableV5Dialogue({ questionCode: code, questionIntent: null })) {
        expect(WEEKLY_PLANNING_STABLE_V5_QUESTION_PURPOSES).toContain(purpose);
      }
    }
  });
});
