import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import { context, applyWeekendRangeAndExamScope } from './weeklyPlanningRoleplayTestHelpers';

describe('weekly planning legacy fallback regression', () => {
  it('legacy fallback branch A assesses first weekly input with multiple time amounts', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '来週、英語を3時間、数学を2時間',
      context,
    );

    expect(state.intent).toBe('weekly_study_planning');
    expect(state.status).toBe('needs_life_constraints');
    expect(state.tasks).toEqual([
      {
        title: '英語',
        subject: '英語',
        unit: 'minutes',
        amount: 180,
        rawText: '英語を3時間',
        requiresTimeEstimate: false,
      },
      {
        title: '数学',
        subject: '数学',
        unit: 'minutes',
        amount: 120,
        rawText: '数学を2時間',
        requiresTimeEstimate: false,
      },
    ]);
    expect(state.missing).toEqual(['life_constraints']);
    expect(state.shouldSavePlan).toBe(false);
  });

  it('legacy fallback branch A does not run without a weekly keyword', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '英語を3時間、数学を2時間',
      context,
    );

    expect(state.intent).toBe('unknown');
    expect(state.tasks).toEqual([]);
    expect(state.missing).toEqual([]);
    expect(state.shouldSavePlan).toBe(false);
  });

  // Two skip conditions hold at once here: the text has no duration mentions
  // (looksLikeWeeklyPlanningRequest is false) and the exam scope command has
  // already moved the intent away from 'unknown'.
  it('legacy fallback branch A does not run when durations are missing and the exam scope command sets the intent', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '今週末で院試過去問の残りを進めたい',
      context,
    );

    expect(state.intent).toBe('exam_prep_planning');
    expect(state.tasks).toEqual([]);
    expect(state.examPrepScope).toMatchObject({
      examType: '院試',
      unitModel: 'year_field_chunk',
    });
    expect(state.missing).toEqual(['unit_duration_estimate']);
    expect(state.shouldSavePlan).toBe(false);
  });

  it('legacy fallback branch A is skipped when setup command has already set the planning range', () => {
    // previousState must stay undefined here: branch B requires a truthy
    // previousState, so passing createInitialPlanningIntakeState() would let
    // branch B (revision merge) run on this same turn and fill tasks. Note the
    // pipeline always passes a truthy state (previousState ?? initial state),
    // so this test isolates the branch A skip at the reducer level only.
    const state = applyWeeklyPlanningUserTurn(
      undefined,
      '今日の19時から土日の終わりまで予定立てたい。英語を3時間、数学を2時間',
      context,
    );

    expect(state.intent).toBe('weekly_study_planning');
    expect(state.range).toMatchObject({
      startDateTime: '2026-06-26T19:00:00',
      endDateTime: '2026-06-28T24:00:00',
      confidence: 'explicit',
    });
    expect(state.tasks).toEqual([]);
    expect(state.missing).toEqual([
      'tasks_or_goals',
      'fixed_events',
      'sleep_cycle',
      'meal_bath_constraints',
    ]);
    expect(state.shouldSavePlan).toBe(false);
  });

  it('legacy fallback branch B merges revision tasks into an existing weekly planning state', () => {
    const initial = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '来週、英語を3時間、数学を2時間',
      context,
    );
    const revised = applyWeeklyPlanningUserTurn(initial, 'あと物理を2時間', context);

    expect(revised.intent).toBe('weekly_study_planning');
    expect(revised.tasks).toEqual([
      {
        title: '英語',
        subject: '英語',
        unit: 'minutes',
        amount: 180,
        rawText: '英語を3時間',
        requiresTimeEstimate: false,
      },
      {
        title: '数学',
        subject: '数学',
        unit: 'minutes',
        amount: 120,
        rawText: '数学を2時間',
        requiresTimeEstimate: false,
      },
      // Pinned current behavior: mergeWeeklyPlanningRevision keeps the
      // conjunction prefix, so the extracted title is 'あと物理', not '物理'.
      {
        title: 'あと物理',
        subject: 'あと物理',
        unit: 'minutes',
        amount: 120,
        rawText: 'あと物理を2時間',
        requiresTimeEstimate: false,
      },
    ]);
    expect(revised.missing).toEqual(['life_constraints']);
    expect(revised.shouldSavePlan).toBe(false);
  });

  // In this flow branch B is skipped by its intent condition: the exam scope
  // turn sets intent to 'exam_prep_planning', which fails the
  // intent === 'weekly_study_planning' check before the !examPrepScope guard
  // inside branch B is ever reached. The inner guard itself has no direct
  // coverage yet (it would need a weekly_study_planning state that also has
  // an examPrepScope).
  it('legacy fallback branch B does not run for exam prep intent states', () => {
    const examState = applyWeekendRangeAndExamScope();
    const revised = applyWeeklyPlanningUserTurn(examState, 'あと物理を2時間', context);

    expect(revised.intent).toBe('exam_prep_planning');
    expect(revised.examPrepScope).toEqual(examState.examPrepScope);
    expect(revised.tasks).toEqual([]);
    expect(revised.missing).toEqual(examState.missing);
    expect(revised.shouldSavePlan).toBe(false);
  });

  it('legacy fallback branch B preserves tasks when weekly state already has examPrepScope', () => {
    const previousState = {
      ...createInitialPlanningIntakeState(),
      intent: 'weekly_study_planning' as const,
      tasks: [
        {
          title: '\u65e2\u5b58\u30bf\u30b9\u30af',
          subject: '\u65e2\u5b58\u30bf\u30b9\u30af',
          unit: 'minutes' as const,
          amount: 90,
          rawText: '\u65e2\u5b58\u30bf\u30b9\u30af\u309290\u5206',
          requiresTimeEstimate: false,
        },
      ],
      examPrepScope: {
        examType: '\u9662\u8a66',
        fields: ['\u6570\u5b66\u30fb\u6570\u7406\u7cfb'],
        totalYears: 7,
        unitModel: 'year_field_chunk' as const,
        rawText: ['\u9662\u8a66\u3067\u6570\u5b66\u30fb\u6570\u7406\u7cfb\u3092\u9032\u3081\u308b'],
      },
      sourceTurns: ['\u6765\u9031\u3001\u65e2\u5b58\u30bf\u30b9\u30af\u309290\u5206'],
    };

    const revised = applyWeeklyPlanningUserTurn(previousState, '\u3042\u3068\u7269\u7406\u30922\u6642\u9593', context);

    expect(revised.intent).toBe('weekly_study_planning');
    expect(revised.examPrepScope).toEqual(previousState.examPrepScope);
    expect(revised.tasks).toEqual(previousState.tasks);
    expect(revised.sourceTurns).toEqual([
      '\u6765\u9031\u3001\u65e2\u5b58\u30bf\u30b9\u30af\u309290\u5206',
      '\u3042\u3068\u7269\u7406\u30922\u6642\u9593',
    ]);
    expect(revised.shouldSavePlan).toBe(false);
  });

});
