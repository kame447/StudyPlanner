import { summarizeWeeklyPlanningAllocationBreakdown } from '../features/weeklyPlanning/semantic/weeklyPlanningAllocationBreakdown';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { minutesBetween } from '../lib/date';

export function formatWeeklyPlanningAllocationMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}分`;
  return remainder === 0 ? `${hours}時間` : `${hours}時間${remainder}分`;
}

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
      見積もり{formatWeeklyPlanningAllocationMinutes(estimatedMinutes)}＋余裕{formatWeeklyPlanningAllocationMinutes(marginMinutes)}
    </span>
  );
}
