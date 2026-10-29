// The only way VNext could become the conversation core: one user-facing switch
// that requires every part of the replacement together (design §9.2). Any
// missing part keeps Stable V5. Not consumed by production code at this stage.

export type WeeklyPlanningVNextSwitchPart =
  /** Scheduler, questions and renderer read the VNext projection. */
  | 'projection_consumed'
  /** V5 progress writers (reconciliation, percent, bounded) no longer run. */
  | 'old_derived_writers_stopped'
  /** Answers bind inside the presentation binding to projection questions. */
  | 'answer_binding'
  /** Saved V5 sessions are migrated with a revision bump. */
  | 'checkpoint_migration'
  /** VNext checkpoints carry the capability the V5 reader rejects. */
  | 'checkpoint_capability';

export const WEEKLY_PLANNING_VNEXT_SWITCH_PARTS: readonly WeeklyPlanningVNextSwitchPart[] = [
  'projection_consumed',
  'old_derived_writers_stopped',
  'answer_binding',
  'checkpoint_migration',
  'checkpoint_capability',
];

export type WeeklyPlanningConversationCore =
  | { core: 'stable_v5'; missing: WeeklyPlanningVNextSwitchPart[] }
  | { core: 'vnext' };

export function resolveWeeklyPlanningConversationCore(params: {
  /** Explicit owner decision; false unless adoption is approved. */
  vnextRequested: boolean;
  readyParts: ReadonlySet<WeeklyPlanningVNextSwitchPart>;
}): WeeklyPlanningConversationCore {
  const missing = WEEKLY_PLANNING_VNEXT_SWITCH_PARTS.filter((part) => !params.readyParts.has(part));
  if (!params.vnextRequested || missing.length > 0) return { core: 'stable_v5', missing };
  return { core: 'vnext' };
}
