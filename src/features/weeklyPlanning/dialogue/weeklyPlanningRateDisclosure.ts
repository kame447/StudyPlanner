/**
 * Application-owned statements about a per-unit rate the user gave (Issue #488 x8). The renderer never words them.
 * - projected: the model typed a clock unit for the rate; the app used it as minutes per counted unit and says so.
 * - ignored: an accepted rate could not be used (its unit does not fit the work) while the app asks for the rate again.
 * One sentence per fact and turn, quoting the user's own words.
 */
export function weeklyPlanningRateUnitProjectedText(fact: { quote: string; minutes: number; unitLabel: string }): string {
  return `「${fact.quote}」は、${fact.unitLabel}あたり${fact.minutes}分として使いました。`;
}

export function weeklyPlanningIgnoredRateText(fact: { quote: string; unit: string }): string {
  return `「${fact.quote}」は、この作業の単位（${fact.unit}）と合わなかったため使えませんでした。`;
}

/** The rate sentences of a turn, in one block (empty when the turn has none). */
export function weeklyPlanningRateNotices(communication: null | undefined | {
  rateUnitProjected?: { quote: string; minutes: number; unitLabel: string };
  ignoredRate?: { quote: string; unit: string };
}): string {
  return [
    communication?.rateUnitProjected ? weeklyPlanningRateUnitProjectedText(communication.rateUnitProjected) : '',
    communication?.ignoredRate ? weeklyPlanningIgnoredRateText(communication.ignoredRate) : '',
  ].join('');
}
