import { addDays, minutesFromTime } from '../../../lib/date';
import type {
  WeeklyConditionOperation,
  WeeklyPlanningConditionOverrideResult,
  WeeklyPlanningDefaultConditions,
  WeeklyPlanningPendingConfig,
} from '../weeklyPlanningTypes';
import {
  mergeSessionIntentOverrides,
  parseWeeklyPlanningConditionOperations,
} from '../parsing/weeklyConditionParser';
import {
  getQualityPreferenceMessage,
  mergeWeeklyPlanningQualityPreferences,
} from '../parsing/weeklyQualityPreferenceParser';

const DEFAULT_WAKE_TIME = '08:00';
const DEFAULT_SLEEP_START_TIME = '24:00';

export const WEEKLY_PLANNING_CONDITION_OVERRIDE_HELP =
  '対応できる条件変更例: 「7日間で」「勉強開始9時から」「22時までで」「9時から22時で」「お昼は13〜14時」「1回90分で」「休憩15分で」「睡眠は2時から9時」「配置できる分だけでいい」。';

function cloneWeeklyPlanningDefaults(
  defaults: WeeklyPlanningDefaultConditions,
): WeeklyPlanningDefaultConditions {
  return {
    ...defaults,
    unavailableRanges: defaults.unavailableRanges.map((range) => ({ ...range })),
    availableStudyRanges: defaults.availableStudyRanges.map((range) => ({ ...range })),
    preferredStudyRanges: defaults.preferredStudyRanges.map((range) => ({ ...range })),
  };
}

function withUpdatedDayCount(
  defaults: WeeklyPlanningDefaultConditions,
  dayCount: number,
): WeeklyPlanningDefaultConditions {
  const nextDayCount = Math.max(1, Math.floor(dayCount));

  return {
    ...cloneWeeklyPlanningDefaults(defaults),
    dayCount: nextDayCount,
    reserveDate: addDays(defaults.startDate, nextDayCount),
  };
}

function getAvailableStudyRangesForSleep(params: {
  wakeTime: string;
  sleepStartTime: string;
}): WeeklyPlanningDefaultConditions['availableStudyRanges'] {
  const wakeMinutes = minutesFromTime(params.wakeTime);
  const sleepStartMinutes = minutesFromTime(params.sleepStartTime);
  const endTime =
    sleepStartMinutes > wakeMinutes ? params.sleepStartTime : DEFAULT_SLEEP_START_TIME;

  return [
    {
      startTime: params.wakeTime,
      endTime,
      reason: '睡眠時間を除いた時間',
    },
  ];
}

function withUpdatedAvailableRanges(
  defaults: WeeklyPlanningDefaultConditions,
  updater: (
    range: WeeklyPlanningDefaultConditions['availableStudyRanges'][number],
  ) => WeeklyPlanningDefaultConditions['availableStudyRanges'][number],
): WeeklyPlanningDefaultConditions {
  const nextDefaults = cloneWeeklyPlanningDefaults(defaults);
  const nextRanges = nextDefaults.availableStudyRanges
    .map(updater)
    .filter((range) => minutesFromTime(range.startTime) < minutesFromTime(range.endTime));

  nextDefaults.availableStudyRanges =
    nextRanges.length > 0
      ? nextRanges
      : [{ startTime: DEFAULT_WAKE_TIME, endTime: DEFAULT_SLEEP_START_TIME, reason: '既定' }];
  return nextDefaults;
}

function applyWeeklyConditionOperation(params: {
  config: WeeklyPlanningPendingConfig;
  operation: WeeklyConditionOperation;
}): { config: WeeklyPlanningPendingConfig; message: string } {
  const config = params.config;
  const operation = params.operation;

  switch (operation.kind) {
    case 'setDayCount': {
      return {
        config: { ...config, defaults: withUpdatedDayCount(config.defaults, operation.dayCount) },
        message: `${operation.dayCount}日間に変更しました。`,
      };
    }
    case 'extendDayCount': {
      const dayCount = config.defaults.dayCount + operation.days;
      return {
        config: { ...config, defaults: withUpdatedDayCount(config.defaults, dayCount) },
        message: operation.days === 1 ? '予備日も配置対象に入れました。' : `${dayCount}日間に変更しました。`,
      };
    }
    case 'setAvailableStartTime': {
      return {
        config: {
          ...config,
          defaults: withUpdatedAvailableRanges(config.defaults, (range) => ({
            ...range,
            startTime: operation.startTime,
            reason: '指定された勉強可能時間帯',
          })),
        },
        message: `勉強開始時刻を${operation.startTime}に変更しました。`,
      };
    }
    case 'setAvailableEndTime': {
      return {
        config: {
          ...config,
          defaults: withUpdatedAvailableRanges(config.defaults, (range) => ({
            ...range,
            endTime: operation.endTime,
            reason: '指定された勉強可能時間帯',
          })),
        },
        message: `勉強終了時刻を${operation.endTime}に変更しました。`,
      };
    }
    case 'setAvailableRange': {
      const range = {
        startTime: operation.startTime,
        endTime: operation.endTime,
        reason: '指定された勉強可能時間帯',
      };
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.availableStudyRanges = [range];
      defaults.preferredStudyRanges = [range];
      defaults.unavailableRanges = [];
      return {
        config: { ...config, defaults },
        message: `勉強可能時間帯を${operation.startTime}-${operation.endTime}に変更しました。`,
      };
    }
    case 'addUnavailableRange': {
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.unavailableRanges = [
        ...defaults.unavailableRanges.filter((range) => range.reason !== operation.reason),
        {
          startTime: operation.startTime,
          endTime: operation.endTime,
          reason: operation.reason,
        },
      ];
      return {
        config: { ...config, defaults },
        message: `${operation.reason}として${operation.startTime}-${operation.endTime}を使わない時間にしました。`,
      };
    }
    case 'removeUnavailableRange': {
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.unavailableRanges = operation.reason
        ? defaults.unavailableRanges.filter((range) => range.reason !== operation.reason)
        : [];
      return {
        config: { ...config, defaults },
        message: operation.reason
          ? `${operation.reason}の除外時間を外しました。`
          : '使わない時間帯を外しました。',
      };
    }
    case 'setPreferredRange': {
      const range = {
        startTime: operation.startTime,
        endTime: operation.endTime,
        reason: '指定された集中時間帯',
      };
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.preferredStudyRanges = [range];
      return {
        config: { ...config, defaults },
        message: `集中しやすい時間帯を${operation.startTime}-${operation.endTime}に変更しました。`,
      };
    }
    case 'setMaxSessionMinutes': {
      return {
        config: {
          ...config,
          defaults: {
            ...cloneWeeklyPlanningDefaults(config.defaults),
            maxSessionMinutes: operation.minutes,
          },
        },
        message: `1回の学習上限を${operation.minutes}分に変更しました。`,
      };
    }
    case 'setBreakMinutes': {
      return {
        config: {
          ...config,
          defaults: {
            ...cloneWeeklyPlanningDefaults(config.defaults),
            breakMinutes: operation.minutes,
          },
        },
        message: `休憩時間を${operation.minutes}分に変更しました。`,
      };
    }
    case 'setSleepWindow': {
      const defaults = cloneWeeklyPlanningDefaults(config.defaults);
      defaults.sleepStartTime = operation.startTime;
      defaults.wakeTime = operation.endTime;
      defaults.availableStudyRanges = getAvailableStudyRangesForSleep({
        wakeTime: defaults.wakeTime,
        sleepStartTime: defaults.sleepStartTime,
      });
      return {
        config: { ...config, defaults },
        message: `睡眠時間を${operation.startTime}から${operation.endTime}に変更しました。`,
      };
    }
    case 'addSessionIntentOverride': {
      return {
        config: {
          ...config,
          sessionIntentOverrides: mergeSessionIntentOverrides(
            config.sessionIntentOverrides,
            operation.override,
          ),
        },
        message: operation.override.kind === 'fixed_two_hour'
            ? '2時間単位を優先する設定に変更しました。'
            : '長めのセッションを優先する設定に変更しました。',
      };
    }
    case 'addQualityPreference': {
      return {
        config: {
          ...config,
          qualityPreferences: mergeWeeklyPlanningQualityPreferences(
            config.qualityPreferences,
            operation.preference,
          ),
        },
        message: getQualityPreferenceMessage(operation.preference),
      };
    }
    case 'allowPartialPlacement': {
      return {
        config: { ...config, allowPartialPlacement: true },
        message: '配置できる分だけ作成する設定に変更しました。',
      };
    }
    default: {
      return { config, message: '' };
    }
  }
}

export function applyWeeklyPlanningConditionOverride(params: {
  config: WeeklyPlanningPendingConfig;
  text: string;
}): WeeklyPlanningConditionOverrideResult {
  const operations = parseWeeklyPlanningConditionOperations(params.text);

  if (operations.length === 0) {
    return {
      kind: 'unrecognized',
      config: params.config,
      message: WEEKLY_PLANNING_CONDITION_OVERRIDE_HELP,
    };
  }

  let nextConfig: WeeklyPlanningPendingConfig = {
    ...params.config,
    tasks: params.config.tasks.map((task) => ({ ...task, amount: { ...task.amount } })),
    defaults: cloneWeeklyPlanningDefaults(params.config.defaults),
    sessionIntentOverrides: [...(params.config.sessionIntentOverrides ?? [])],
    qualityPreferences: [...(params.config.qualityPreferences ?? [])],
  };
  const messages: string[] = [];

  operations.forEach((operation) => {
    const result = applyWeeklyConditionOperation({
      config: nextConfig,
      operation,
    });
    nextConfig = result.config;

    if (result.message) {
      messages.push(result.message);
    }
  });

  return {
    kind: 'updated',
    config: nextConfig,
    messages,
  };
}
