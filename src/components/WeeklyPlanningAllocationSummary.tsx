import { summarizeWeeklyPlanningAllocationBreakdown } from '../features/weeklyPlanning/semantic/weeklyPlanningAllocationBreakdown';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { formatMinutes, minutesBetween } from '../lib/date';

export function WeeklyPlanningAllocationSummary({ blocks }: { blocks: readonly WeeklyPlanDraftBlock[] }) {
  const summary = summarizeWeeklyPlanningAllocationBreakdown(blocks.map((block) => ({
    durationMinutes: minutesBetween(block.startTime, block.endTime),
    allocationBreakdown: block.allocationBreakdown,
  })));
  if (!summary || summary.marginMinutes <= 0) return null;
  const estimatedMinutes = Math.round(summary.estimatedMinutes);
  const marginMinutes = Math.max(0, Math.round(summary.allocatedMinutes) - estimatedMinutes);
  return (
    <span className="ai-planning-allocation-summary" aria-label="確保時間の内訳">
      見積もり{formatMinutes(estimatedMinutes)}＋余裕{formatMinutes(marginMinutes)}
    </span>
  );
}
