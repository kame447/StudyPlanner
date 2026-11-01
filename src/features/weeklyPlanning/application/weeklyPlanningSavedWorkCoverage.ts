import type { Plan } from '../../../types/domain';
import { parseWeeklyPlanningPlanSourceId, WEEKLY_PLANNING_PLAN_SOURCE_TYPE } from '../planning/weeklyPlanningPlanProvenance';

/** A movable work item as the preview scheduler names it. Only its identity and current amount matter here. */
interface CoverableWorkItem { id: string; estimatedMinutes: number | null }

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** Placement candidates are saved under `stable-v5:<graphRevision>:<workItemKey>:<chunk>`; fixed registrations have no chunk. */
const STUDY_BLOCK_ID = /^stable-v5:\d+:(.+):\d+$/;

/**
 * Work whose current amount an approved, saved plan already covers is not "unplaced": a reply must not offer to
 * schedule it again. Coverage is by identity, never by title: the saved weekly-planning plans carry the draft
 * block id they were saved from, which names the work item, and the saved minutes for that item must reach its
 * current estimate (a later correction that raises the amount leaves the remainder unplaced). Shared by Stable V5's
 * registration routing and VNext's preview, so both cores tell the same fact.
 */
export function workNotCoveredBySavedPlans<T extends CoverableWorkItem>(items: readonly T[], plans: readonly Plan[]): T[] {
  const savedMinutes = new Map<string, number>();
  for (const plan of plans) {
    if (plan.sourceType !== WEEKLY_PLANNING_PLAN_SOURCE_TYPE) continue;
    const identity = parseWeeklyPlanningPlanSourceId(plan.sourceId);
    const workItemKey = identity && STUDY_BLOCK_ID.exec(identity.sourceDraftBlockId)?.[1];
    if (!workItemKey) continue;
    savedMinutes.set(workItemKey, (savedMinutes.get(workItemKey) ?? 0) + Math.max(0, minutesOf(plan.endTime) - minutesOf(plan.startTime)));
  }
  return items.filter(item => item.estimatedMinutes === null || (savedMinutes.get(item.id) ?? 0) < item.estimatedMinutes);
}
