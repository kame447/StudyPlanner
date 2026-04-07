import { addDays, minutesBetween } from '../lib/date';
import type { Actual, EvaluationSummary, Plan } from '../types/domain';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPlanMinutes(plan: Plan): number {
  return minutesBetween(plan.startTime, plan.endTime);
}

function getActualMinutes(actual: Actual): number {
  return minutesBetween(actual.actualStartTime, actual.actualEndTime);
}

function calculateAchievement(dayPlans: Plan[], actualByPlanId: Map<string, Actual>): number {
  if (dayPlans.length === 0) {
    return 0;
  }

  const plannedMinutes = dayPlans.reduce((sum, plan) => sum + getPlanMinutes(plan), 0);

  if (plannedMinutes <= 0) {
    return 0;
  }

  const actualMinutes = dayPlans.reduce((sum, plan) => {
    const actual = actualByPlanId.get(plan.id);
    return sum + (actual ? getActualMinutes(actual) : 0);
  }, 0);

  return clamp(Math.round((actualMinutes / plannedMinutes) * 100), 0, 100);
}

function calculateConsistency(
  recentDates: string[],
  plans: Plan[],
  actualByPlanId: Map<string, Actual>,
): number {
  const activePlanDays = new Set(
    plans
      .filter((plan) => recentDates.includes(plan.date))
      .map((plan) => plan.date),
  );

  if (activePlanDays.size === 0) {
    return 0;
  }

  const actualRecordDays = recentDates.filter((date) =>
    plans.some((plan) => plan.date === date && actualByPlanId.has(plan.id)),
  ).length;

  return clamp(Math.round((actualRecordDays / activePlanDays.size) * 100), 0, 100);
}

function calculateRealism(
  recentPlans: Plan[],
  actualByPlanId: Map<string, Actual>,
): number {
  const realismSamples = recentPlans.flatMap((plan) => {
    const actual = actualByPlanId.get(plan.id);

    if (!actual) {
      return [];
    }

    const planMinutes = getPlanMinutes(plan);
    const actualMinutes = getActualMinutes(actual);
    const gapRatio =
      1 - Math.abs(actualMinutes - planMinutes) / Math.max(planMinutes, actualMinutes, 60);

    return [clamp(gapRatio, 0, 1)];
  });

  if (realismSamples.length === 0) {
    return 0;
  }

  return clamp(
    Math.round(
      (realismSamples.reduce((sum, sample) => sum + sample, 0) / realismSamples.length) *
        100,
    ),
    0,
    100,
  );
}

export function buildEvaluationSummary(
  selectedDate: string,
  plans: Plan[],
  actuals: Actual[],
): EvaluationSummary {
  const dayPlans = plans.filter((plan) => plan.date === selectedDate);
  const recentDates = Array.from({ length: 7 }, (_, index) =>
    addDays(selectedDate, index - 6),
  );
  const actualByPlanId = new Map(actuals.map((actual) => [actual.planId, actual]));
  const recentPlans = plans.filter((plan) => recentDates.includes(plan.date));
  const achievement = calculateAchievement(dayPlans, actualByPlanId);
  const consistency = calculateConsistency(recentDates, plans, actualByPlanId);
  const realism = calculateRealism(recentPlans, actualByPlanId);
  const hasRecentPlans = recentPlans.length > 0;
  const hasRecentActuals = recentPlans.some((plan) => actualByPlanId.has(plan.id));

  const lowestScore = Math.min(achievement, consistency, realism);
  let comment =
    '大きな崩れはありません。次は日ごとの予定量を30分刻みで整えると比較しやすくなります。';

  if (!hasRecentPlans) {
    comment = 'まだ評価できるデータがありません。まずは1件だけでも予定を入れてみましょう。';
  } else if (!hasRecentActuals) {
    comment = '予定はありますが実績記録がまだありません。短時間でも1件記録すると評価が動きます。';
  } else if (dayPlans.length === 0) {
    comment = '今日は予定がありません。必要なら1件だけでも計画を入れて比較できる状態を作りましょう。';
  } else if (lowestScore === achievement) {
    comment =
      '実績が予定に届いていません。所要時間を少し短めに置くと、達成度を上げながら継続しやすくなります。';
  } else if (lowestScore === consistency) {
    comment =
      '記録のない日が続くと継続度が下がります。短時間でも実績を1件残す日を増やしてください。';
  } else if (lowestScore === realism) {
    comment =
      '計画と実績の時間差が大きめです。次回は開始時刻か終了時刻を一段階だけ現実寄りに調整しましょう。';
  }

  return {
    achievement,
    consistency,
    realism,
    comment,
  };
}
