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

  const plannedMinutes = dayPlans.reduce((sum, plan) => sum + getPlanMinutes(plan), 0);
  const actualMinutes = dayPlans.reduce((sum, plan) => {
    const actual = actualByPlanId.get(plan.id);
    return sum + (actual ? getActualMinutes(actual) : 0);
  }, 0);

  const achievement =
    plannedMinutes === 0
      ? dayPlans.length === 0
        ? 55
        : 65
      : clamp(Math.round((actualMinutes / plannedMinutes) * 100), 0, 100);

  const activePlanDays = recentDates.filter((date) =>
    plans.some((plan) => plan.date === date),
  ).length;
  const actualRecordDays = recentDates.filter((date) =>
    plans.some((plan) => {
      if (plan.date !== date) {
        return false;
      }

      return actualByPlanId.has(plan.id);
    }),
  ).length;

  const consistency =
    activePlanDays === 0
      ? 45
      : clamp(Math.round((actualRecordDays / activePlanDays) * 100), 0, 100);

  const recentPlans = plans.filter((plan) =>
    recentDates.includes(plan.date),
  );

  const realismSamples = recentPlans.map((plan) => {
    const actual = actualByPlanId.get(plan.id);
    const planMinutes = getPlanMinutes(plan);

    if (!actual) {
      return 0.35;
    }

    const actualMinutesValue = getActualMinutes(actual);
    const gapRatio =
      1 -
      Math.abs(actualMinutesValue - planMinutes) /
        Math.max(planMinutes, actualMinutesValue, 60);

    return clamp(gapRatio, 0, 1);
  });

  const realism =
    realismSamples.length === 0
      ? 60
      : clamp(
          Math.round(
            (realismSamples.reduce((sum, sample) => sum + sample, 0) /
              realismSamples.length) *
              100,
          ),
          0,
          100,
        );

  const lowestScore = Math.min(achievement, consistency, realism);
  let comment = '大きな崩れはありません。次は日ごとの予定量を30分刻みで整えると比較しやすくなります。';

  if (dayPlans.length === 0) {
    comment = 'まずは1件だけでも予定を入れて、計画と実績の差分を残せる状態を作りましょう。';
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
