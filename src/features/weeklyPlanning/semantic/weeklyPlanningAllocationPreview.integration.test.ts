import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';
import { summarizeWeeklyPlanningAllocationBreakdown } from './weeklyPlanningAllocationBreakdown';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../preview/weeklyPlanningPreviewBlocks';

const source = {
  conversationId: 'allocation', turnId: 'turn', semanticLocalId: 'source', sourceText: 'work', origin: 'user' as const,
};

describe('allocation evidence through actual scheduling and preview handoff', () => {
  it.each([['page', 20, 3, 60, 70], ['page', 40, 3, 120, 135], ['minute', 120, null, 120, 120]] as const)(
    '%s workload %i at %s minutes retains %i estimated and %i allocated', (unitCode, amount, pace, estimate, allocated) => {
      const graph = {
        ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
        tasks: [{ id: 'task', category: 'study' as const, title: 'work', source, createdRevision: 1 }],
        workloads: [{
          id: 'workload', taskId: 'task', componentId: null, quantityRole: 'target' as const,
          amount, unitCode, unitLabel: unitCode, rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null, source, createdRevision: 1,
        }],
        effortEstimates: pace === null ? [] : [{
          id: 'pace', taskId: 'task', targetFactId: 'workload', kind: 'duration_per_unit' as const,
          minutes: pace, unitCode, precision: 'approximate' as const, source, createdRevision: 1,
        }],
        factLifecycles: ['task', 'workload', ...(pace === null ? [] : ['pace'])].map((factId) => ({
          factId, status: 'active' as const, createdRevision: 1,
          terminalRevision: null, supersededByFactId: null,
        })),
      };
      const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
      const compiled = compileGenericSchedulerInput({ graph: active, context: {
        ownerId: 'owner', currentDate: '2026-10-12', planningStartDate: '2026-10-12',
        planningEndDate: '2026-10-18', timeZone: 'Asia/Tokyo',
      } });
      expect(compiled.status).toBe('ready');
      const output = scheduleWeeklyPlanningStableV5Preview({
        input: compiled.input!, graph: createWeeklyPlanningPlacementGraphViewV5(active),
      });
      expect(output.status).toBe('ready');
      const summary = summarizeWeeklyPlanningAllocationBreakdown(output.candidates);
      expect(summary).toMatchObject({ estimatedMinutes: estimate, allocatedMinutes: allocated, marginMinutes: allocated - estimate });
      const previews = createWeeklyPlanningPreviewBlocks(output.candidates);
      const drafts = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: output.candidates, userId: 'owner', createdAt: 'now' });
      for (let index = 0; index < output.candidates.length; index += 1) {
        expect(previews[index].allocationBreakdown).toEqual(output.candidates[index].allocationBreakdown);
        expect(createWeeklyPlanningPreviewDisplayBlock(previews[index], 'owner').allocationBreakdown)
          .toEqual(output.candidates[index].allocationBreakdown);
        expect(drafts[index].allocationBreakdown).toEqual(output.candidates[index].allocationBreakdown);
      }
    },
  );
});
