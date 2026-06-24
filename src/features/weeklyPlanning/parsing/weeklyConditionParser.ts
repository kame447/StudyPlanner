import type {
  SessionIntentOverride,
  SessionIntentScope,
  SimpleWeeklyTask,
  WeeklyConditionOperation,
} from '../weeklyPlanningTypes';
import {
  normalizeConditionText,
  normalizeWeeklyPlanningText,
  parseJapaneseSmallInteger,
} from './weeklyPlanningText';
import {
  classifyQualityPreferenceOperations,
  hasQualityAvoidanceCue,
} from './weeklyQualityPreferenceParser';

function formatClockParts(hourText: string, minuteText = '0'): string {
  const hour = Math.min(Math.max(Number(hourText), 0), 24);
  const minute = Math.min(Math.max(Number(minuteText), 0), 59);

  if (hour === 24) {
    return '24:00';
  }

  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function isPartialPlacementConfirmationText(text: string): boolean {
  return /配置できる分だけ|入る分だけ|入るところまで|置ける分だけ|置けるところまで|部分的でいい|部分でいい/.test(
    normalizeWeeklyPlanningText(text),
  );
}

function splitConditionClauses(text: string): string[] {
  return normalizeWeeklyPlanningText(text)
    .replace(/\r?\n+/g, '、')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:それと|あと|さらに)/g, '、')
    .replace(
      /で(?=(?:お昼|昼|昼休み|夕食|夜ごはん|夜ご飯|晩ごはん|晩ご飯|食事|休憩|睡眠|寝|起床|勉強|開始|終了|夜は|朝は|午前|午後|最大|1回|一回|[\d一二三四五六七八九十]+\s*日(?:間)?))/g,
      '、',
    )
    .split(/[、。,\.]+/)
    .map((clause) =>
      clause
        .replace(/(?:でいい|にして|想定でやってほしい)$/g, '')
        .trim(),
    )
    .filter(Boolean);
}

function parseClockRange(text: string): { startTime: string; endTime: string } | null {
  const normalizedText = normalizeConditionText(text);
  const match = normalizedText.match(
    /(\d{1,2})(?::(\d{1,2}))?\s*(?:時)?(半)?\s*(?:から|~|-)\s*(\d{1,2})(?::(\d{1,2}))?\s*(?:時)?(半)?/,
  );

  if (!match) {
    return null;
  }

  return {
    startTime: formatClockParts(match[1], match[3] ? '30' : (match[2] ?? '0')),
    endTime: formatClockParts(match[4], match[6] ? '30' : (match[5] ?? '0')),
  };
}

function extractClockMentions(text: string): string[] {
  const normalizedText = normalizeConditionText(text);
  const mentions: string[] = [];

  Array.from(normalizedText.matchAll(/(\d{1,2})(?::(\d{1,2})|時(半)?)/g)).forEach(
    (match) => {
      mentions.push(formatClockParts(match[1], match[3] ? '30' : (match[2] ?? '0')));
    },
  );
  Array.from(normalizedText.matchAll(/(\d{1,2})\s*(?=から|まで)/g)).forEach(
    (match) => {
      const time = formatClockParts(match[1], '0');

      if (!mentions.includes(time)) {
        mentions.push(time);
      }
    },
  );

  return mentions;
}

function extractDurationMentions(text: string): number[] {
  return Array.from(normalizeConditionText(text).matchAll(/(\d+)\s*分/g)).map(
    (match) => Number(match[1]),
  );
}

function getLastMinutesMention(text: string): number | null {
  const mentions = extractDurationMentions(text);
  const lastMention = mentions[mentions.length - 1];

  return lastMention ?? null;
}

export function createSessionIntentOverrideFromText(
  text: string,
  scope: SessionIntentScope = 'global',
): SessionIntentOverride | null {
  const normalizedText = normalizeConditionText(text);

  if (/(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d/.test(normalizedText)) {
    return {
      scope,
      kind: 'fixed_two_hour',
      targetSessionMinutes: 120,
    };
  }

  if (/\u9577\u3081|\u5168\u4f53\u7684\u306b\u9577/.test(normalizedText)) {
    return {
      scope,
      kind: 'prefer_long',
      targetSessionMinutes: 120,
    };
  }

  if (/\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u7247\u3065\u3051|\u7247\u4ed8\u3051/.test(normalizedText)) {
    return { scope, kind: 'consolidate', targetSessionMinutes: 120 };
  }

  if (/\u5148\u306b|\u4eca\u65e5\u4e2d|\u512a\u5148/.test(normalizedText)) {
    return { scope, kind: 'one_shot_first', targetSessionMinutes: 120 };
  }

  return null;
}

function normalizeSessionIntentOverride(
  override: SessionIntentOverride,
): SessionIntentOverride {
  return {
    ...override,
    targetSessionMinutes: override.targetSessionMinutes
      ? Math.max(30, Math.round(override.targetSessionMinutes))
      : undefined,
  };
}

export function mergeSessionIntentOverrides(
  baseOverrides: SessionIntentOverride[] = [],
  nextOverride: SessionIntentOverride,
): SessionIntentOverride[] {
  const normalizedNext = normalizeSessionIntentOverride(nextOverride);
  const keyFor = (override: SessionIntentOverride) =>
    `${override.scope}|${override.kind}|${override.appliesToTaskTitle ?? ''}`;
  const nextKey = keyFor(normalizedNext);

  return [
    ...baseOverrides.filter((override) => keyFor(override) !== nextKey),
    normalizedNext,
  ];
}

export function inferSessionIntentOverridesFromText(params: {
  text: string;
  tasks: SimpleWeeklyTask[];
}): SessionIntentOverride[] {
  const normalizedText = normalizeWeeklyPlanningText(params.text);
  const overrides: SessionIntentOverride[] = [];

  if (
    /(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d/.test(normalizedText) ||
    /\u5168\u4f53|\u5168\u4f53\u7684|\u5168\u90e8|\u307f\u3093\u306a/.test(normalizedText)
  ) {
    const globalOverride = createSessionIntentOverrideFromText(normalizedText, 'global');

    if (globalOverride) {
      overrides.push(globalOverride);
    }
  }

  params.tasks.forEach((task) => {
    const taskOverride = createSessionIntentOverrideFromText(task.sourceText, 'task');

    if (taskOverride && hasTaskConsolidationIntent(task.sourceText)) {
      overrides.push({
        ...taskOverride,
        appliesToTaskTitle: task.title,
      });
    }
  });

  return overrides.reduce<SessionIntentOverride[]>(
    (merged, override) => mergeSessionIntentOverrides(merged, override),
    [],
  );
}

function resolveUnavailableReason(text: string): string {
  if (/昼|お昼|昼食|昼ごはん|昼ご飯|ランチ/.test(text)) {
    return '昼食';
  }

  if (/夕食|夜ごはん|夜ご飯|晩ごはん|晩ご飯|晩御飯|食事|ごはん|ご飯/.test(text)) {
    return '夕食';
  }

  if (/休憩|休み|インターバル/.test(text)) {
    return '休憩';
  }

  return '使用不可';
}

function hasExplicitDayCountInstruction(text: string): boolean {
  return /日(?:間)?\s*(?:で|にして|へ変更|に変更|に分散|へ分散|で分散|でやって|で作成|使って|配置|$)/.test(
    text,
  );
}

function hasExplicitMaxSessionInstruction(text: string): boolean {
  return (
    /(?:1回|一回|1セッション|セッション|最大|上限|連続|ぶっ続け).*?\d+\s*分\s*(?:で|まで|以内|にして|に変更|上限|$)/.test(
      text,
    ) ||
    /\d+\s*分\s*(?:以内|まで)/.test(text) ||
    /(?:最大|上限)\s*\d+\s*分/.test(text) ||
    /じゃなくて\s*\d+\s*分/.test(text)
  );
}

function classifyConditionClause(clause: string): WeeklyConditionOperation[] {
  const normalizedClause = normalizeConditionText(clause);
  const operations: WeeklyConditionOperation[] = [];
  const dayCountMatch = normalizedClause.match(
    /([\d一二三四五六七八九十]+)\s*日(?:間)?(?=\s*(?:で|に|へ|使|配置|$))/,
  );
  const qualityPreferenceOperations = classifyQualityPreferenceOperations(normalizedClause);
  const hasQualityAvoidance = hasQualityAvoidanceCue(normalizedClause);

  const clockRange = parseClockRange(normalizedClause);
  const clockMentions = extractClockMentions(normalizedClause);
  const minuteMentions = extractDurationMentions(normalizedClause);
  const lastMinutes = minuteMentions[minuteMentions.length - 1];
  const hasSleepCue = /睡眠|寝る|寝て|就寝|起床|起きる|起き/.test(normalizedClause);
  const hasUnavailableCue =
    /昼|お昼|昼食|昼ごはん|昼ご飯|ランチ|夕食|夜ごはん|夜ご飯|晩ごはん|晩ご飯|食事|ごはん|ご飯|空け|使わない|除外|無理/.test(
      normalizedClause,
    ) ||
    (/休憩|休み|インターバル/.test(normalizedClause) && Boolean(clockRange));
  const hasStartCue =
    /勉強開始|開始|始め|スタート|勉強可能|使える|朝は|午前は|から勉強|勉強できる/.test(
      normalizedClause,
    );
  const hasEndCue = /終了|終わり|まで|何時まで|夜は/.test(normalizedClause);

  const sessionIntentOverride = createSessionIntentOverrideFromText(
    normalizedClause,
    'global',
  );

  if (sessionIntentOverride) {
    operations.push({
      kind: 'addSessionIntentOverride',
      override: sessionIntentOverride,
    });
  }


  if (dayCountMatch && hasExplicitDayCountInstruction(normalizedClause)) {
    const dayCount = parseJapaneseSmallInteger(dayCountMatch[1]);
    if (dayCount !== null) {
      operations.push({ kind: 'setDayCount', dayCount });
    }
  } else if (/予備日(?:も)?使|予備日を使/.test(normalizedClause)) {
    operations.push({ kind: 'extendDayCount', days: 1 });
  } else if (/期間を延ばす/.test(normalizedClause)) {
    operations.push({ kind: 'extendDayCount', days: 1 });
  }

  if (isPartialPlacementConfirmationText(normalizedClause)) {
    operations.push({ kind: 'allowPartialPlacement' });
  }

  if (hasSleepCue && clockRange) {
    operations.push({
      kind: 'setSleepWindow',
      startTime: clockRange.startTime,
      endTime: clockRange.endTime,
    });
    return operations;
  }

  if (hasSleepCue && clockMentions.length >= 2) {
    operations.push({
      kind: 'setSleepWindow',
      startTime: clockMentions[0],
      endTime: clockMentions[1],
    });
    return operations;
  }

  if (/食事|昼食|夕食|昼休み|休憩/.test(normalizedClause) && /なし|不要|いらない|消して|外して/.test(normalizedClause)) {
    operations.push({
      kind: 'removeUnavailableRange',
      reason: /昼|昼食|昼休み/.test(normalizedClause)
        ? '昼食'
        : /夕|夜ご飯|食事/.test(normalizedClause)
          ? '夕食'
          : undefined,
    });
    return operations;
  }

  if (clockRange && hasUnavailableCue) {
    operations.push({
      kind: 'addUnavailableRange',
      startTime: clockRange.startTime,
      endTime: clockRange.endTime,
      reason: resolveUnavailableReason(normalizedClause),
    });
    return operations;
  }

  if (clockRange && /中心|集中|メイン|優先/.test(normalizedClause)) {
    operations.push({
      kind: 'setPreferredRange',
      startTime: clockRange.startTime,
      endTime: clockRange.endTime,
    });
  } else if (clockRange) {
    operations.push({
      kind: 'setAvailableRange',
      startTime: clockRange.startTime,
      endTime: clockRange.endTime,
    });
  } else if (clockMentions.length > 0 && hasStartCue && !hasEndCue) {
    operations.push({ kind: 'setAvailableStartTime', startTime: clockMentions[0] });
  } else if (clockMentions.length > 0 && hasEndCue) {
    operations.push({ kind: 'setAvailableEndTime', endTime: clockMentions[0] });
  }

  if (!hasQualityAvoidance && hasExplicitMaxSessionInstruction(normalizedClause)) {
    const minutes = getLastMinutesMention(normalizedClause);
    if (minutes !== null) {
      operations.push({ kind: 'setMaxSessionMinutes', minutes: Math.max(30, minutes) });
    }
  }

  qualityPreferenceOperations.forEach((operation) => operations.push(operation));

  if (/休憩|休み|インターバル/.test(normalizedClause) && !clockRange && lastMinutes !== undefined) {
    operations.push({ kind: 'setBreakMinutes', minutes: Math.max(0, lastMinutes) });
  }

  if (/午前は使わない/.test(normalizedClause)) {
    operations.push({ kind: 'setAvailableStartTime', startTime: '12:00' });
  } else if (/夜も使う/.test(normalizedClause)) {
    operations.push({
      kind: 'setAvailableRange',
      startTime: '20:00',
      endTime: '24:00',
    });
  }

  return operations;
}

export function parseWeeklyPlanningConditionOperations(
  text: string,
): WeeklyConditionOperation[] {
  const operations = splitConditionClauses(text).flatMap(classifyConditionClause);

  return operations.filter(
    (operation, index, array) =>
      array.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(operation)) ===
      index,
  );
}

export function hasTaskConsolidationIntent(text: string): boolean {
  const normalizedText = normalizeWeeklyPlanningText(text);

  return /\u4e00\u6c17|\u307e\u3068\u3081\u3066|\u7247\u3065\u3051|\u7247\u4ed8\u3051|\u5148\u306b|\u4eca\u65e5\u4e2d|\u512a\u5148|\u9577\u3081|(?:2|\u4e8c)\s*\u6642\u9593\s*\u5358\u4f4d/.test(
    normalizedText,
  );
}
