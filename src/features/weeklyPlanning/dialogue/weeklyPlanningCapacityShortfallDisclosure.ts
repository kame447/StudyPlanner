import type { WeeklyPlanningCapacityShortfall } from '../application/weeklyPlanningCapacityShortfall';

/**
 * Application-owned statement of the work that did not fit (Issue #488 B3). The renderer never
 * states these figures. "入りきらなかった" says what did not fit in this attempt; it does not claim
 * the application chose to drop it, and it never states free minutes or a shortfall against them.
 */
const minutesText = (value: number) => `${value.toLocaleString('en-US')}分`;

export function weeklyPlanningCapacityShortfallText(shortfall: WeeklyPlanningCapacityShortfall): string {
  const items = shortfall.unmetWork.map((item) => {
    // A minutes workload already states its minutes (no 「60分・約60分」).
    const duration = item.quantity === `${item.minutes}分` ? '' : `約${minutesText(item.minutes)}`;
    const detail = [item.quantity, duration].filter(Boolean).join('・');
    return `${item.label}（${detail}）`;
  });
  const more = shortfall.moreCount > 0 ? `、ほか${shortfall.moreCount}件` : '';
  return `入りきらなかった作業: ${items.join('、')}${more}。今回の計画に必要な時間は合計${minutesText(shortfall.requiredMinutes)}です。`;
}

