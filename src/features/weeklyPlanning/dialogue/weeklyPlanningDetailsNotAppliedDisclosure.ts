/**
 * Application-owned statement that the planning content of the message could not be reflected (Issue #488 x10).
 * `planningDetailsNotApplied` is a typed fact (the turn carried only its conversation act because the planning delta
 * was unusable); the renderer is told not to explain it, but disclosure must not depend on its compliance, so the
 * turn-level composer states it once beside the reply (and the emergency text uses the same sentence).
 *
 * It cannot co-occur with the nothing-read sentence by construction: a conversation-only turn needs a self-sufficient
 * act (a bare answer act never is one), while nothing-read requires that no act other than a bare answer exists. If both
 * facts ever arrive, nothing-read wins (it is the broader statement), so the sentence is never stacked.
 */
export const WEEKLY_PLANNING_DETAILS_NOT_APPLIED_TEXT =
  'メッセージの中の予定に関する内容は、今回は計画に反映できていません。変えたいことがあれば、もう一度教えてください。';

export function weeklyPlanningDetailsNotAppliedNotice(communication: null | undefined | {
  planningDetailsNotApplied?: boolean;
  nothingRead?: boolean;
  uncertaintyReleased?: { nothingRead: boolean };
}): string | null {
  if (communication?.planningDetailsNotApplied !== true) return null;
  if (communication.nothingRead === true || communication.uncertaintyReleased?.nothingRead === true) return null;
  return WEEKLY_PLANNING_DETAILS_NOT_APPLIED_TEXT;
}
