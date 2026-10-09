import type { WeeklyPlanningCapacityShortfall } from '../application/weeklyPlanningCapacityShortfall';

/**
 * Typed facts a reply MUST convey (Issue #488 P2, verified AI-written dialogue). A payload is numbers, the user's own labels and
 * flags: never application prose. The renderer writes the words; the application verifies the reply against these facts
 * (`weeklyPlanningReplyVerification`). A fact appears here only once its fixed-text appender is RETIRED: until then the
 * application sentence is appended as before and the renderer is told not to word it.
 */
export type WeeklyPlanningMustConveyEntry = {
  code: 'shortfall';
  /** Total minutes the plan needs (the figure the reply must state). */
  requiredMinutes: number;
  /** The unmet work shown: the user's own label and its estimated minutes. */
  unmet: Array<{ label: string; minutes: number }>;
  moreCount: number;
};

export type WeeklyPlanningMustConveyCode = WeeklyPlanningMustConveyEntry['code'];

/** Appenders whose fixed text has been replaced by a verified AI sentence. Slice 1 retires the capacity shortfall only. */
export const WEEKLY_PLANNING_RETIRED_APPENDERS: ReadonlySet<WeeklyPlanningMustConveyCode> = new Set<WeeklyPlanningMustConveyCode>(['shortfall']);

export function isWeeklyPlanningAppenderRetired(code: WeeklyPlanningMustConveyCode): boolean {
  return WEEKLY_PLANNING_RETIRED_APPENDERS.has(code);
}

export function mustConveyFromCapacityShortfall(shortfall: WeeklyPlanningCapacityShortfall): WeeklyPlanningMustConveyEntry {
  return {
    code: 'shortfall',
    requiredMinutes: shortfall.requiredMinutes,
    unmet: shortfall.unmetWork.map((item) => ({ label: item.label, minutes: item.minutes })),
    moreCount: shortfall.moreCount,
  };
}
