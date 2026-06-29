import { describe, expect, it } from 'vitest';
import { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';
import { createRemainingWorkItemsFromDraftRequest } from '../intake/weeklyPlanningRemainingWorkItems';
import { WP_RP_001_WEEKEND_EXAM_EXPECTED } from '../testFixtures/weeklyPlanningGoldExpectations';
import { applyWeekendExamReadyForDraftRequest } from './weeklyPlanningRoleplayTestHelpers';
describe('weekly planning remaining work items', () => {
  it('WP-RP-001 Phase 2.5 creates remaining work items from the draft request', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      applyWeekendExamReadyForDraftRequest(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const result = createRemainingWorkItemsFromDraftRequest(request);
    const mathItems = result.items.filter((item) => item.field === '数学・数理系');
    const softwareItems = result.items.filter((item) => item.field === 'ソフトウェア系');

    expect(mathItems.map((item) => item.year)).toEqual([2020, 2019]);
    expect(softwareItems.map((item) => item.year)).toEqual([
      2025,
      2024,
      2023,
      2022,
      2021,
      2020,
      2019,
    ]);
    expect(mathItems.every((item) => item.estimatedMinutes === 120)).toBe(true);
    expect(softwareItems.every((item) => item.estimatedMinutes === 120)).toBe(true);
    expect(mathItems.every((item) => item.unit === 'year_field_chunk')).toBe(true);
    expect(softwareItems.every((item) => item.source === 'exam_prep_request')).toBe(true);
    expect(result.items.findIndex((item) => item.field === '数学・数理系')).toBeLessThan(
      result.items.findIndex((item) => item.field === 'ソフトウェア系'),
    );
  });
  it('ML-eval remaining work item correctness preserves scheduler input invariants', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      applyWeekendExamReadyForDraftRequest(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const result = createRemainingWorkItemsFromDraftRequest(request);
    const completedYears = new Set(
      request.progress.flatMap((progress) =>
        progress.field === '数学・数理系' ? progress.completedYears : [],
      ),
    );
    const mathItems = result.items.filter((item) => item.field === '数学・数理系');
    const softwareItems = result.items.filter((item) => item.field === 'ソフトウェア系');
    const allYears = result.items.map((item) => item.year);
    const firstSoftwareIndex = result.items.findIndex((item) => item.field === 'ソフトウェア系');
    let lastMathIndex = -1;

    result.items.forEach((item, index) => {
      if (item.field === '数学・数理系') {
        lastMathIndex = index;
      }
    });

    expect(mathItems.some((item) => completedYears.has(item.year))).toBe(false);
    expect(softwareItems.map((item) => item.year)).toEqual(
      WP_RP_001_WEEKEND_EXAM_EXPECTED.remainingYearsByField['ソフトウェア系'],
    );
    expect(result.items.every((item) => item.estimatedMinutes === 120)).toBe(true);
    expect(Math.min(...allYears)).toBeGreaterThanOrEqual(2019);
    expect(Math.max(...allYears)).toBeLessThanOrEqual(2025);
    expect(lastMathIndex).toBeLessThan(firstSoftwareIndex);
    expect(result.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meal' }),
        expect.objectContaining({ kind: 'bath' }),
        expect.objectContaining({ kind: 'buffer' }),
        expect.objectContaining({ kind: 'fixed_event' }),
      ]),
    );
  });

  it('ML-eval stateless pipeline is deterministic for identical roleplay input sequences', () => {
    const runPipeline = () => {
      const finalState = applyWeekendExamReadyForDraftRequest();
      const request = createWeeklyDraftRequestFromIntakeState(finalState);
      const remainingWorkItems = request
        ? createRemainingWorkItemsFromDraftRequest(request)
        : null;

      return { finalState, request, remainingWorkItems };
    };

    expect(runPipeline()).toEqual(runPipeline());
  });
  it('WP-RP-001 Phase 2.5 does not apply fieldless completedYears to every field', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      applyWeekendExamReadyForDraftRequest(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const fieldlessRequest = {
      ...request,
      progress: request.progress.map((progress) => ({
        ...progress,
        field: undefined,
      })),
    };
    const result = createRemainingWorkItemsFromDraftRequest(fieldlessRequest);
    const mathItems = result.items.filter((item) => item.field === '数学・数理系');

    expect(result.ambiguities).toContain('completed_years_without_field_scope');
    expect(mathItems.map((item) => item.year)).toEqual([
      2025,
      2024,
      2023,
      2022,
      2021,
      2020,
      2019,
    ]);
  });
});
