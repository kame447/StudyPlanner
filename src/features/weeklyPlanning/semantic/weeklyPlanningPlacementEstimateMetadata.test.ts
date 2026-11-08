import { describe, expect, it } from 'vitest';
import type { Actual, Plan } from '../../../types/domain';
import { buildWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocksCore';
import { deriveWeeklyPlanningEstimateCalibration } from '../personalization/weeklyPlanningEstimateCalibration';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import { createPlacementCandidate } from './weeklyPlanningStableV5PlacementCandidates';

// #47: the estimate behind each placed block must reach the draft block (and so the approved Plan), where the
// plan/actual calibration reads it. Each block records its own share of the base estimate.
const item = {
  version: 'weekly-planning-generic-work-item-v1', id: 'item-1', taskId: 'task-1', componentId: null, workloadFactId: 'workload-1',
  label: '数学ワーク', quantityRole: 'target', actionability: 'actionable',
  quantity: { amount: 20, unitCode: 'problem', unitLabel: '問', ordinalRange: null, actualRange: null },
  estimatedMinutes: 90, baseEstimatedMinutes: 60, calibrationMultiplier: 1, roundingStepMinutes: 15,
  estimateBasis: 'direct_effort', estimateSourceFactIds: [], estimateSourceWorkloadFactIds: [], splitPolicy: 'atomic',
  periodExpression: null, sourceFactRefs: ['task-1', 'workload-1', 'estimate-1'],
} as unknown as GenericPlanningWorkItem;
const graph = { tasks: [{ id: 'task-1', title: '数学', category: 'study', source: { conversationId: 'c1' } }], components: [] } as never;

function candidate(chunkIndex: number, start: number, duration: number, overrides: Partial<GenericPlanningWorkItem> = {}) {
  return createPlacementCandidate({ input: { graphRevision: 3 } as never, graph, item: { ...item, ...overrides }, chunkIndex, duration,
    slot: { date: '2026-11-09', start, end: start + duration } as never });
}
const build = (candidates: ReturnType<typeof candidate>[]) =>
  buildWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: 'owner-1', createdAt: '2026-11-08T00:00:00.000Z' });

describe('placed blocks carry their estimate metadata', () => {
  it('records numbers and fact ids only, with each block holding its own share of the base', () => {
    const blocks = build([candidate(0, 19 * 60, 45), candidate(1, 20 * 60, 45)]);
    const estimates = blocks.map(block => block.behaviorMetadata?.estimateMetadata);
    expect(estimates).toEqual([0, 1].map(() => ({
      version: 1, baseEstimateMinutes: 30, estimateBasis: 'direct_effort', calibrationMultiplier: 1,
      allocationMinutes: 45, roundingStepMinutes: 15, sourceFactRefs: ['task-1', 'workload-1', 'estimate-1'] })));
    // Nothing the user wrote is in the estimate: only the keys of the closed metadata shape.
    expect(Object.keys(estimates[0]!).sort()).toEqual(['allocationMinutes', 'baseEstimateMinutes', 'calibrationMultiplier',
      'estimateBasis', 'roundingStepMinutes', 'sourceFactRefs', 'version']);
  });

  it.each([
    ['no usable rounding step', { roundingStepMinutes: null }],
    ['a time the user chose to spend, not an estimate (intrinsic duration / provisional timebox)', { estimateBasis: 'intrinsic_duration' }],
    ['an observed pace, which is already built from actuals', { estimateBasis: 'observed_pace' }],
  ] as const)('has no estimate metadata for %s', (_name, overrides) => {
    const blocks = build([candidate(0, 19 * 60, 45, overrides as Partial<GenericPlanningWorkItem>)]);
    expect(blocks[0].behaviorMetadata).toBeDefined();
    expect(blocks[0].behaviorMetadata).not.toHaveProperty('estimateMetadata');
  });

  it('moves the calibration multiplier off 1 once actuals exist for plans saved from those blocks', () => {
    const blocks = build([candidate(0, 19 * 60, 45), candidate(1, 20 * 60, 45)]);
    const plans = blocks.map((block, index) => ({ id: `plan-${index}`, userId: 'owner-1', date: block.date, startTime: block.startTime,
      endTime: block.endTime, weeklyPlanningEstimate: block.behaviorMetadata!.estimateMetadata } as unknown as Plan));
    const actuals = plans.map((plan, index) => ({ id: `actual-${index}`, userId: 'owner-1', planId: plan.id, occurrenceDate: plan.date,
      actualStartTime: plan.startTime, actualEndTime: index === 0 ? '19:45' : '20:45', subject: '数学', note: '',
      updatedAt: '2026-11-09T21:00:00.000Z' } as Actual));
    // Each 45-minute block against a 30-minute base share: ratio 1.5. With the whole 60-minute base it would be 0.75.
    expect(deriveWeeklyPlanningEstimateCalibration({ plans, actuals })).toMatchObject({ observationCount: 2, medianRatio: 1.5 });
    // Plans without the field (every Plan saved before this) keep multiplier 1.
    const old = plans.map(plan => ({ ...plan, weeklyPlanningEstimate: undefined }) as Plan);
    expect(deriveWeeklyPlanningEstimateCalibration({ plans: old, actuals })).toMatchObject({ observationCount: 0, multiplier: 1 });
  });
});
