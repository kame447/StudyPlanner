/**
 * Application-owned statement that the final reading of the turn was entirely empty (Issue #488 x6): no delta and
 * no act the renderer would answer. It states what happened to the message, never the plan, so a dropped condition is
 * never silent. One sentence for the whole turn: the turn-level composer renders it once, whether the empty reading
 * also released a free-form question or not. The renderer never words it.
 */
import { weeklyPlanningUncertaintyReleaseText } from './weeklyPlanningUncertaintyReleaseDisclosure';

export const WEEKLY_PLANNING_NOTHING_READ_TEXT = 'この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。';

/** The sentence the turn shows, once: `communication.nothingRead` or a no-delta release (its own typed flag). */
export function weeklyPlanningNothingReadNotice(communication: null | undefined | {
  nothingRead?: boolean;
  uncertaintyReleased?: { nothingRead: boolean };
} | undefined): string | null {
  return communication?.nothingRead === true || communication?.uncertaintyReleased?.nothingRead === true
    ? WEEKLY_PLANNING_NOTHING_READ_TEXT : null;
}

/**
 * The release sentence and the nothing-read sentence as the one block the reply shows: the release is worded without
 * its own copy of the nothing-read sentence, which is appended once from the turn-level fact.
 */
export function weeklyPlanningReleaseAndNothingReadText(communication: null | undefined | {
  nothingRead?: boolean;
  uncertaintyReleased?: { quote: string | null; nothingRead: boolean };
}): string {
  const released = communication?.uncertaintyReleased
    ? weeklyPlanningUncertaintyReleaseText({ quote: communication.uncertaintyReleased.quote }) : '';
  return `${released}${weeklyPlanningNothingReadNotice(communication) ?? ''}`;
}
