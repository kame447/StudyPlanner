import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { createWeeklyDraftRequestFromIntakeState } from '../intake/weeklyPlanningDraftRequestAdapter';
import {
  createRemainingWorkItemsFromDraftRequest,
  resolveWorkItemSplitPolicy,
} from '../intake/weeklyPlanningRemainingWorkItems';
import { WP_RP_001_WEEKEND_EXAM_EXPECTED } from '../testFixtures/weeklyPlanningGoldExpectations';
import { applyWeekendExamReadyForDraftRequest } from './weeklyPlanningRoleplayTestHelpers';

const ZERO_PROGRESS_FIELDS = [
  '数学・数理系',
  'ソフトウェア系',
  'ハードウェア系',
  'OS とネットワーク',
  'ヒューマンサイエンス系',
];

function createZeroProgressDraftReadyState(): PlanningIntakeState {
  return {
    status: 'draft_ready',
    intent: 'exam_prep_planning',
    examPrepScope: {
      examType: '院試',
      fields: ZERO_PROGRESS_FIELDS,
      totalFields: 5,
      totalYears: 7,
      yearRange: {
        startYear: 2019,
        endYear: 2025,
        sourceText: '2019〜2025',
      },
      unitModel: 'year_field_chunk',
      rawText: ['院試の5分野を2019〜2025で進める'],
    },
    tasks: [],
    progress: [],
    unitRates: [
      {
        unit: 'year_field_chunk',
        minutesPerUnit: 180,
        source: 'user',
        rawText: '一分野の一年分は3時間くらい',
      },
    ],
    constraints: [],
    priorityPolicy: {
      kind: 'field_first',
      order: ZERO_PROGRESS_FIELDS,
    },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    sourceTurns: ['完了済みはまだない'],
  };
}

describe('weekly planning remaining work items', () => {
  it('resolves split policy deterministically from the study scope unit', () => {
    expect(resolveWorkItemSplitPolicy('year_field_chunk')).toBe('atomic');
    expect(resolveWorkItemSplitPolicy('topic')).toBe('atomic');
    expect(resolveWorkItemSplitPolicy('minutes')).toBe('splittable');
    expect(resolveWorkItemSplitPolicy('hours')).toBe('splittable');
    expect(resolveWorkItemSplitPolicy('pages')).toBe('splittable');
    expect(resolveWorkItemSplitPolicy('problems')).toBe('splittable');
    expect(resolveWorkItemSplitPolicy('unknown')).toBe('splittable');
  });

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
    expect(mathItems.every((item) => item.splitPolicy === 'atomic')).toBe(true);
    expect(softwareItems.every((item) => item.splitPolicy === 'atomic')).toBe(true);
    expect(softwareItems.every((item) => item.source === 'exam_prep_request')).toBe(true);
    expect(result.items.findIndex((item) => item.field === '数学・数理系')).toBeLessThan(
      result.items.findIndex((item) => item.field === 'ソフトウェア系'),
    );
  });
  it('creates all field-year remaining work items when completed progress is empty', () => {
    const request = createWeeklyDraftRequestFromIntakeState(
      createZeroProgressDraftReadyState(),
    );

    expect(request).not.toBeNull();
    if (!request) {
      throw new Error('expected draft request');
    }

    const result = createRemainingWorkItemsFromDraftRequest(request);

    expect(result.items).toHaveLength(35);
    expect(result.items.every((item) => item.estimatedMinutes === 180)).toBe(true);
    expect(result.items.every((item) => item.unit === 'year_field_chunk')).toBe(true);
    expect(result.items.filter((item) => item.field === '数学・数理系').map((item) => item.year)).toEqual([
      2025,
      2024,
      2023,
      2022,
      2021,
      2020,
      2019,
    ]);
    expect(result.ambiguities).toEqual([]);
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



  it('uses all completion target for every uncompleted year in the target field', () => {
    const state = createZeroProgressDraftReadyState();
    const request = createWeeklyDraftRequestFromIntakeState({
      ...state,
      progress: [
        {
          field: 'ヒューマンサイエンス系',
          completedYears: [2025, 2024, 2023, 2022],
          completionTarget: { kind: 'all', rawText: '残り全部' },
          ambiguity: 'none',
          rawText: 'ヒューマンサイエンスは2025〜2022まで完了済み、残り全部',
        },
      ],
    });

    expect(request).not.toBeNull();
    if (!request) throw new Error('expected draft request');

    const result = createRemainingWorkItemsFromDraftRequest(request);
    expect(result.items.filter((item) => item.field === 'ヒューマンサイエンス系').map((item) => item.year)).toEqual([
      2021,
      2020,
      2019,
    ]);
  });

  it('uses latest_n_years completion target for the latest uncompleted years only', () => {
    const request = createWeeklyDraftRequestFromIntakeState({
      ...createZeroProgressDraftReadyState(),
      progress: [
        {
          field: 'OS とネットワーク',
          completionTarget: { kind: 'latest_n_years', count: 2, rawText: 'OSは2年分' },
          ambiguity: 'none',
          rawText: 'OSは2年分',
        },
      ],
    });

    expect(request).not.toBeNull();
    if (!request) throw new Error('expected draft request');

    const result = createRemainingWorkItemsFromDraftRequest(request);
    expect(result.items.filter((item) => item.field === 'OS とネットワーク').map((item) => item.year)).toEqual([
      2025,
      2024,
    ]);
  });

  it('keeps completedYears separate from explicit completion target ranges', () => {
    const request = createWeeklyDraftRequestFromIntakeState({
      ...createZeroProgressDraftReadyState(),
      progress: [
        {
          field: '数学・数理系',
          completedYears: [2025],
          completionTarget: { kind: 'year_range', startYear: 2025, endYear: 2023, rawText: '2025〜2023までやりたい' },
          ambiguity: 'none',
          rawText: '数学は2025完了、2025〜2023までやりたい',
        },
      ],
    });

    expect(request).not.toBeNull();
    if (!request) throw new Error('expected draft request');

    const result = createRemainingWorkItemsFromDraftRequest(request);
    expect(result.items.filter((item) => item.field === '数学・数理系').map((item) => item.year)).toEqual([
      2024,
      2023,
    ]);
  });

  it('treats up_to_reachable as a tentative target without reducing year work items in this task', () => {
    const request = createWeeklyDraftRequestFromIntakeState({
      ...createZeroProgressDraftReadyState(),
      progress: [
        {
          field: 'ソフトウェア系',
          completionTarget: { kind: 'up_to_reachable', rawText: 'できるところまで' },
          ambiguity: 'none',
          rawText: 'ソフトウェアはできるところまで',
        },
      ],
    });

    expect(request).not.toBeNull();
    if (!request) throw new Error('expected draft request');

    const result = createRemainingWorkItemsFromDraftRequest(request);
    expect(result.items.filter((item) => item.field === 'ソフトウェア系').map((item) => item.year)).toEqual([
      2025,
      2024,
      2023,
      2022,
      2021,
      2020,
      2019,
    ]);
  });

  it('preserves up_to_reachable identity separately from all in completionTargets metadata', () => {
    const request = createWeeklyDraftRequestFromIntakeState({
      ...createZeroProgressDraftReadyState(),
      progress: [
        {
          field: 'ヒューマンサイエンス系',
          completionTarget: { kind: 'all', rawText: '残り全部' },
          ambiguity: 'none',
          rawText: 'ヒューマンサイエンスは残り全部',
        },
        {
          field: 'ソフトウェア系',
          completionTarget: { kind: 'up_to_reachable', rawText: 'できるところまで' },
          ambiguity: 'none',
          rawText: 'ソフトウェアはできるところまで',
        },
      ],
    });

    expect(request).not.toBeNull();
    if (!request) throw new Error('expected draft request');

    const result = createRemainingWorkItemsFromDraftRequest(request);

    // Both fields currently produce the same set of remaining years (capacity policy
    // is not implemented yet), but identity must still be recoverable from metadata.
    expect(result.items.filter((item) => item.field === 'ヒューマンサイエンス系').map((item) => item.year))
      .toEqual(result.items.filter((item) => item.field === 'ソフトウェア系').map((item) => item.year));

    expect(result.completionTargets).toEqual(
      expect.arrayContaining([
        { field: 'ヒューマンサイエンス系', target: { kind: 'all', rawText: '残り全部' } },
        { field: 'ソフトウェア系', target: { kind: 'up_to_reachable', rawText: 'できるところまで' } },
      ]),
    );

    const humanScienceTarget = result.completionTargets.find(
      (entry) => entry.field === 'ヒューマンサイエンス系',
    );
    const softwareTarget = result.completionTargets.find(
      (entry) => entry.field === 'ソフトウェア系',
    );

    expect(humanScienceTarget?.target.kind).toBe('all');
    expect(softwareTarget?.target.kind).toBe('up_to_reachable');
    expect(humanScienceTarget?.target.kind).not.toBe(softwareTarget?.target.kind);
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
