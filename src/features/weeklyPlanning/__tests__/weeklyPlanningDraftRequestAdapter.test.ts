import { describe, expect, it } from 'vitest';
import { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';
import { applyWeeklyPlanningUserTurn } from '../intake/weeklyPlanningIntakeReducer';
import { WP_RP_001_WEEKEND_EXAM_TURNS } from '../testFixtures/weeklyPlanningRoleplayCases';
import {
  applyWeekendExamReadyForDraftRequest,
  applyWeekendExamReadyForLifeConstraints,
  context,
} from './weeklyPlanningRoleplayTestHelpers';
describe('weekly planning draft request adapter', () => {
  it('WP-RP-001 Phase 2 creates a draft request from the final draft_ready intake state', () => {
    const state = applyWeekendExamReadyForDraftRequest();
    const request = createWeeklyDraftRequestFromIntakeState(state);

    expect(state.status).toBe('draft_ready');
    expect(request).toMatchObject({
      examPrepScope: {
        yearRange: {
          startYear: 2019,
          endYear: 2025,
          sourceText: '2019〜2025',
        },
      },
      progress: [
        expect.objectContaining({
          field: '数学・数理系',
          completedYears: [2025, 2024, 2023, 2022, 2021],
        }),
      ],
      unitRate: {
        unit: 'year_field_chunk',
        minutesPerUnit: 120,
        source: 'user',
      },
      priorityPolicy: {
        kind: 'field_first',
        order: ['数学・数理系', 'ソフトウェア系'],
      },
      fixedEvents: [],
      shouldCreateDraft: true,
      shouldSavePlan: false,
    });
    expect(request?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(request?.fixedEvents).toEqual([]);
  });

  it('WP-RP-001 Phase 2 does not create a draft request before the intake is draft_ready', () => {
    const state = applyWeekendExamReadyForLifeConstraints();

    expect(state.status).toBe('needs_life_constraints');
    expect(createWeeklyDraftRequestFromIntakeState(state)).toBeNull();
  });

  it('WP-RP-001 Phase 2 does not create a draft request when only life constraints are collected', () => {
    const state = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForLifeConstraints(),
      WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
      context,
    );

    expect(state.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(state.missing).toContain('fixed_events');
    expect(state.status).not.toBe('draft_ready');
    expect(createWeeklyDraftRequestFromIntakeState(state)).toBeNull();
  });

  it('WP-RP-001 Phase 2 keeps fixed events separate from life constraints in the draft request', () => {
    const afterLifeConstraints = applyWeeklyPlanningUserTurn(
      applyWeekendExamReadyForLifeConstraints(),
      WP_RP_001_WEEKEND_EXAM_TURNS.lifeConstraints,
      context,
    );
    const withFixedEvent = applyWeeklyPlanningUserTurn(
      afterLifeConstraints,
      '15時から病院がある',
      context,
    );
    const request = createWeeklyDraftRequestFromIntakeState(withFixedEvent);

    expect(withFixedEvent.status).toBe('draft_ready');
    expect(request?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
      ]),
    );
    expect(request?.constraints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fixed_event' })]),
    );
    expect(request?.fixedEvents).toEqual([
      expect.objectContaining({
        kind: 'fixed_event',
        start: '15:00',
        hardness: 'hard',
      }),
    ]);
    expect(request?.shouldSavePlan).toBe(false);
  });
});
