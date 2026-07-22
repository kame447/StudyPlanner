import { minutesFromTime } from '../../../lib/date';
import type { SimpleWeeklyTask, WeeklyPlanningDefaultConditions } from '../weeklyPlanningTypes';
import { normalizeWeeklyPlanningText } from '../parsing/weeklyPlanningText';
import { inferStudyTaskProfile } from '../profiling/studyTaskProfile';

export { distributeMinutesAcrossBuckets, roundToPlanningQuantum } from './minuteDistribution';

export function resolveTaskSpreadDayCount(params: {
  task: SimpleWeeklyTask;
  dayCount: number;
  consolidationIntent: boolean;
  allowTinySession: boolean;
}): number {
  if (params.consolidationIntent || params.dayCount <= 1) {
    return 1;
  }

  const minimumUsefulDailyMinutes = params.allowTinySession ? 30 : 60;
  const possibleSpreadDays = Math.max(
    1,
    Math.floor(params.task.durationMinutes / minimumUsefulDailyMinutes),
  );

  return Math.min(params.dayCount, possibleSpreadDays);
}

export function resolveTaskSpreadDateIndexes(params: {
  taskIndex: number;
  dayCount: number;
  spreadDayCount: number;
  forceEarly: boolean;
}): number[] {
  if (params.spreadDayCount >= params.dayCount) {
    return Array.from({ length: params.dayCount }, (_, index) => index);
  }

  const startIndex = params.forceEarly ? 0 : params.taskIndex % params.dayCount;
  return Array.from({ length: params.spreadDayCount }, (_, index) =>
    (startIndex + index) % params.dayCount,
  ).sort((left, right) => left - right);
}


function resolveDefaultSubjectAnchorMinutes(params: {
  task: SimpleWeeklyTask;
  taskIndex: number;
  defaults: WeeklyPlanningDefaultConditions;
}): number {
  const profile = inferStudyTaskProfile(params.task);
  const text = normalizeWeeklyPlanningText(`${params.task.title} ${params.task.sourceText}`);

  if (/英語|単語|暗記|復習|チェック|確認/.test(text)) {
    return 13 * 60;
  }

  if (/卒研|研究|文献|論文/.test(text)) {
    return 11 * 60;
  }

  if (/計算理論|数学|線形代数|確率統計|証明/.test(text)) {
    return 14 * 60 + 30;
  }

  if (/実装|開発|レポート|文章|執筆/.test(text)) {
    return 15 * 60;
  }

  if (profile.cognitiveLoad + profile.contextRetentionCost >= 8) {
    return 14 * 60;
  }

  const preferredRange = params.defaults.preferredStudyRanges[params.taskIndex % Math.max(1, params.defaults.preferredStudyRanges.length)];

  if (preferredRange) {
    return minutesFromTime(preferredRange.startTime) + 60;
  }

  return 13 * 60 + params.taskIndex * 60;
}

export function buildSubjectAnchorMinutes(
  tasks: SimpleWeeklyTask[],
  defaults: WeeklyPlanningDefaultConditions,
): Map<string, number> {
  const anchors = new Map<string, number>();
  const usedAnchors: number[] = [];

  tasks.forEach((task, taskIndex) => {
    if (anchors.has(task.title)) {
      return;
    }

    let anchorMinutes = resolveDefaultSubjectAnchorMinutes({ task, taskIndex, defaults });

    while (usedAnchors.some((usedAnchor) => Math.abs(usedAnchor - anchorMinutes) < 45)) {
      anchorMinutes += 60;
    }

    const latestReasonableAnchor = 21 * 60;
    if (anchorMinutes > latestReasonableAnchor) {
      anchorMinutes = 11 * 60 + (taskIndex % 5) * 60;
    }

    anchors.set(task.title, anchorMinutes);
    usedAnchors.push(anchorMinutes);
  });

  return anchors;
}

