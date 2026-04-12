import { addDays, minutesFromTime, startOfWeek, timeFromMinutes } from '../lib/date';
import { buildDefaultPlanTitle } from '../lib/plans';
import { getNaturalLanguageCatalog } from '../data/naturalLanguageCatalog';
import type {
  MonthEventRepeat,
  NaturalLanguageMode,
  NaturalLanguageSuggestion,
  Plan,
  PlanDraft,
  PlanType,
} from '../types/domain';

export interface SuggestionInput {
  mode: NaturalLanguageMode;
  text: string;
  selectedDate: string;
  plans: Plan[];
  userId: string;
}

const LOCALIZED_NUMBER_PATTERN = '(?:\\d+(?:\\.\\d+)?|[〇零一二三四五六七八九十百]+)';
const CHAPTER_PATTERNS = [
  new RegExp(`第?\\s*${LOCALIZED_NUMBER_PATTERN}\\s*章`, 'gi'),
  /chapter\s*\d+/gi,
  /lesson\s*\d+/gi,
  /unit\s*\d+/gi,
  /section\s*\d+/gi,
];
const CLOCK_TIME_PATTERN =
  '(\\d{1,2})(?:(?::(\\d{2}))|時(半)?)';
const CLOCK_TIME_REGEX = new RegExp(CLOCK_TIME_PATTERN);
const CLOCK_TIME_GLOBAL_REGEX = new RegExp(CLOCK_TIME_PATTERN, 'g');
const CLOCK_RANGE_REGEX = new RegExp(
  `${CLOCK_TIME_PATTERN}\\s*(?:-|〜|~|から)\\s*${CLOCK_TIME_PATTERN}`,
);
const CLOCK_RANGE_GLOBAL_REGEX = new RegExp(
  `${CLOCK_TIME_PATTERN}\\s*(?:-|〜|~|から)\\s*${CLOCK_TIME_PATTERN}`,
  'g',
);
const CROSS_DAY_CLOCK_RANGE_REGEX = new RegExp(
  `${CLOCK_TIME_PATTERN}\\s*から\\s*(?:翌日|[月火水木金土日]曜(?:日)?の?)?\\s*${CLOCK_TIME_PATTERN}\\s*まで`,
);
const WEEKDAY_INDEX: Record<string, number> = {
  月: 0,
  火: 1,
  水: 2,
  木: 3,
  金: 4,
  土: 5,
  日: 6,
};
const SHARED_DATE_PHRASE_REGEX =
  /明後日|明日|今日|来週(?:の)?[月火水木金土日]曜(?:日)?|今週(?:の)?[月火水木金土日]曜(?:日)?|[月火水木金土日]曜(?:日)?|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/;
function getActionWordPatterns(): RegExp[] {
  return getNaturalLanguageCatalog().actionWords.map((keyword) =>
    keyword === 'do' ? /\bdo\b/gi : new RegExp(keyword, 'g'),
  );
}

function normalizeParsingText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[：]/g, ':')
    .replace(/[／]/g, '/')
    .replace(/(\d{1,2})時(\d{1,2})分/g, '$1:$2')
    .replace(/(\d{1,2})時半/g, '$1:30')
    .replace(/[　]/g, ' ');
}

function normalizeCatalogText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s+/g, '')
    .replace(/[Ⅰ]/g, 'I')
    .replace(/[Ⅱ]/g, 'II')
    .replace(/[Ⅲ]/g, 'III');
}

function includesKeyword(text: string, keyword: string): boolean {
  return normalizeCatalogText(text).includes(normalizeCatalogText(keyword));
}

export function defaultDraft(userId: string, date: string): PlanDraft {
  return {
    userId,
    title: '',
    subject: '',
    date,
    startTime: '19:00',
    endTime: '20:00',
    type: 'study',
    memo: '',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
  };
}

export function detectType(text: string): PlanType {
  const matchedRule = getNaturalLanguageCatalog().planTypes.find((rule) =>
    rule.keywords.some((keyword) => includesKeyword(text, keyword)),
  );

  if (matchedRule) {
    return matchedRule.type as PlanType;
  }

  return 'study';
}

export function detectSubject(text: string): string {
  const normalizedText = normalizeCatalogText(text);
  let bestMatch:
    | {
        label: string;
        score: number;
      }
    | undefined;

  getNaturalLanguageCatalog().subjects.forEach((rule) => {
    rule.keywords.forEach((keyword) => {
      const normalizedKeyword = normalizeCatalogText(keyword);

      if (!normalizedKeyword || !normalizedText.includes(normalizedKeyword)) {
        return;
      }

      const score = normalizedKeyword.length;

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          label: rule.label,
          score,
        };
      }
    });
  });

  return bestMatch?.label ?? '';
}

function removeSchedulingTerms(text: string): string {
  return normalizeParsingText(text)
    .replace(
      /明後日|明日|今日|今週|来週|再来週|平日|土日|週末|月水金|火木土|月火水木金土日|[月火水木金土日]曜(?:日)?/g,
      '',
    )
    .replace(/\d{1,2}\/\d{1,2}/g, '')
    .replace(/\d{1,2}月\d{1,2}日/g, '')
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, '')
    .replace(CLOCK_RANGE_GLOBAL_REGEX, '')
    .replace(CLOCK_TIME_GLOBAL_REGEX, '')
    .replace(
      new RegExp(`${LOCALIZED_NUMBER_PATTERN}時間(?:半|${LOCALIZED_NUMBER_PATTERN}分)?`, 'g'),
      '',
    )
    .replace(new RegExp(`${LOCALIZED_NUMBER_PATTERN}分`, 'g'), '')
    .replace(
      /そのあと|その後|次に|続けて|朝の|朝|午前|午後|夜|夕方|おひるごはん食べた後に|お昼ごはん食べた後に|昼ごはん食べた後に|昼食後に?|毎朝|毎晩|毎夜|毎日|毎週|毎月|毎年|毎[月火水木金土日](?:曜)?|同じ時間帯に?|同じ時間に?|ようにしたい|として固定して|固定して|その代わり|他の日は|だけは/g,
      '',
    )
    .replace(/追加|入れて|登録|変更|修正|ずらして|にして|予定|進める/g, '')
    .replace(/\b(?:から|まで|だけ|は|を|に|で|が|へ|の|と|間|半)\b/g, ' ');
}

export function detectRepeat(text: string): MonthEventRepeat {
  const normalizedText = normalizeParsingText(text);

  if (
    /平日|土日|週末|毎週|毎(?:月曜?|火曜?|水曜?|木曜?|金曜?|土曜?|日曜?)|[月火水木金土日]曜(?:日)?は|(?:月|火|水|木|金|土|日){2,}(?:の夜|の朝|の昼|は)/.test(
      normalizedText,
    )
  ) {
    return 'weekly';
  }

  if (/毎朝|毎晩|毎夜|毎日/.test(normalizedText)) {
    return 'daily';
  }

  if (/毎月/.test(normalizedText)) {
    return 'monthly';
  }

  if (/毎年/.test(normalizedText)) {
    return 'yearly';
  }

  return 'none';
}

function resolveWeekdayDate(
  selectedDate: string,
  weekdayLabel: string,
  scope: 'current_or_next' | 'next_week',
): string {
  const targetIndex = WEEKDAY_INDEX[weekdayLabel];

  if (scope === 'next_week') {
    const nextWeekStart = startOfWeek(addDays(selectedDate, 7));
    return addDays(nextWeekStart, targetIndex);
  }

  const selected = new Date(`${selectedDate}T00:00:00`);
  const selectedIndex = selected.getDay() === 0 ? 6 : selected.getDay() - 1;
  const diff = (targetIndex - selectedIndex + 7) % 7;
  return addDays(selectedDate, diff);
}

function resolveNearestMatchingWeekday(
  selectedDate: string,
  weekdayLabels: string[],
): string {
  const targetIndices = weekdayLabels
    .map((label) => WEEKDAY_INDEX[label])
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((left, right) => left - right);
  const selected = new Date(`${selectedDate}T00:00:00`);
  const selectedIndex = selected.getDay() === 0 ? 6 : selected.getDay() - 1;

  for (const targetIndex of targetIndices) {
    const diff = (targetIndex - selectedIndex + 7) % 7;

    if (diff >= 0) {
      return addDays(selectedDate, diff);
    }
  }

  return addDays(selectedDate, (targetIndices[0] - selectedIndex + 7) % 7);
}

export function parseDate(text: string, selectedDate: string): string {
  const normalizedText = normalizeParsingText(text);

  if (/明後日/.test(normalizedText)) {
    return addDays(selectedDate, 2);
  }

  if (/明日/.test(normalizedText)) {
    return addDays(selectedDate, 1);
  }

  if (/今日/.test(normalizedText)) {
    return selectedDate;
  }

  const nextWeekWeekdayMatch = normalizedText.match(
    /来週(?:の)?([月火水木金土日])曜(?:日)?/,
  );

  if (nextWeekWeekdayMatch) {
    return resolveWeekdayDate(selectedDate, nextWeekWeekdayMatch[1], 'next_week');
  }

  const thisWeekWeekdayMatch = normalizedText.match(
    /今週(?:の)?([月火水木金土日])曜(?:日)?/,
  );

  if (thisWeekWeekdayMatch) {
    return resolveWeekdayDate(
      selectedDate,
      thisWeekWeekdayMatch[1],
      'current_or_next',
    );
  }

  const weekdayMatch = normalizedText.match(/([月火水木金土日])曜(?:日)?/);

  if (weekdayMatch) {
    return resolveWeekdayDate(selectedDate, weekdayMatch[1], 'current_or_next');
  }

  const weekdaySetMatch = normalizedText.match(/([月火水木金土日]{2,})(?:の夜|の朝|の昼|は)/);

  if (weekdaySetMatch) {
    return resolveNearestMatchingWeekday(
      selectedDate,
      weekdaySetMatch[1].split(''),
    );
  }

  if (/平日/.test(normalizedText)) {
    return resolveNearestMatchingWeekday(selectedDate, ['月', '火', '水', '木', '金']);
  }

  if (/土日|週末/.test(normalizedText)) {
    return resolveNearestMatchingWeekday(selectedDate, ['土', '日']);
  }

  if (/来週/.test(normalizedText)) {
    return startOfWeek(addDays(selectedDate, 7));
  }

  const slashMatch = normalizedText.match(/(\d{1,2})\/(\d{1,2})/);
  const monthMatch = normalizedText.match(/(\d{1,2})月(\d{1,2})日/);
  const parts = slashMatch ?? monthMatch;

  if (parts) {
    const currentYear = Number(selectedDate.slice(0, 4));
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${currentYear}-${month}-${day}`;
  }

  return selectedDate;
}

export function hasExplicitClockTime(text: string): boolean {
  return CLOCK_TIME_REGEX.test(normalizeParsingText(text));
}

function normalizeTime(hoursText: string, minutesText?: string, hasHalf?: boolean): string {
  const hours = Number(hoursText);
  const minutes = hasHalf ? 30 : Number(minutesText ?? '0');
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function parseJapaneseInteger(value: string): number | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  const digitMap: Record<string, number> = {
    〇: 0,
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (normalized === '十') {
    return 10;
  }

  const hundredIndex = normalized.indexOf('百');
  let total = 0;
  let rest = normalized;

  if (hundredIndex >= 0) {
    const hundredValue = normalized.slice(0, hundredIndex);
    total += (digitMap[hundredValue] ?? 1) * 100;
    rest = normalized.slice(hundredIndex + 1);
  }

  const tenIndex = rest.indexOf('十');

  if (tenIndex >= 0) {
    const tenValue = rest.slice(0, tenIndex);
    total += (digitMap[tenValue] ?? 1) * 10;
    rest = rest.slice(tenIndex + 1);
  }

  if (rest) {
    const ones = rest
      .split('')
      .reduce<number>((sum, char) => sum * 10 + (digitMap[char] ?? 0), 0);
    total += ones;
  }

  return total > 0 ? total : null;
}

export function parseDurationMinutes(text: string): number | undefined {
  const normalizedText = normalizeParsingText(text);
  const hourMinuteMatch = normalizedText.match(
    new RegExp(
      `(${LOCALIZED_NUMBER_PATTERN})時間(?:(半)|(${LOCALIZED_NUMBER_PATTERN})分)?`,
    ),
  );

  if (hourMinuteMatch) {
    const hoursValue = parseJapaneseInteger(hourMinuteMatch[1]);
    const minutesValue = hourMinuteMatch[2]
      ? 30
      : parseJapaneseInteger(hourMinuteMatch[3] ?? '');

    if (hoursValue !== null) {
      return hoursValue * 60 + (minutesValue ?? 0);
    }
  }

  const minuteMatch = normalizedText.match(
    new RegExp(`(${LOCALIZED_NUMBER_PATTERN})分`),
  );

  if (!minuteMatch) {
    return undefined;
  }

  const minutesValue = parseJapaneseInteger(minuteMatch[1]);
  return minutesValue ?? undefined;
}

export function parseTimes(
  text: string,
  fallbackStartTime = '19:00',
): { startTime?: string; endTime?: string } {
  const normalizedText = normalizeParsingText(text);
  const crossDayRangeMatch = normalizedText.match(CROSS_DAY_CLOCK_RANGE_REGEX);

  if (crossDayRangeMatch) {
    const startTime = normalizeTime(
      crossDayRangeMatch[1],
      crossDayRangeMatch[2],
      Boolean(crossDayRangeMatch[3]),
    );
    const endTime = normalizeTime(
      crossDayRangeMatch[4],
      crossDayRangeMatch[5],
      Boolean(crossDayRangeMatch[6]),
    );
    return {
      startTime,
      endTime,
    };
  }

  const rangeMatch = normalizedText.match(CLOCK_RANGE_REGEX);

  if (rangeMatch) {
    return {
      startTime: normalizeTime(rangeMatch[1], rangeMatch[2], Boolean(rangeMatch[3])),
      endTime: normalizeTime(rangeMatch[4], rangeMatch[5], Boolean(rangeMatch[6])),
    };
  }

  const singleMatch = normalizedText.match(CLOCK_TIME_REGEX);
  const durationMinutes = parseDurationMinutes(normalizedText);

  if (singleMatch) {
    const startTime = normalizeTime(
      singleMatch[1],
      singleMatch[2],
      Boolean(singleMatch[3]),
    );
    const endTime = timeFromMinutes(
      minutesFromTime(startTime) + (durationMinutes ?? 60),
    );
    return { startTime, endTime };
  }

  if (durationMinutes !== undefined) {
    // 開始時刻が書かれていない場合でも、「二時間」のような入力では
    // 既定の開始時刻を保ったまま終了時刻を延ばした方が期待に近い。
    return {
      startTime: fallbackStartTime,
      endTime: timeFromMinutes(minutesFromTime(fallbackStartTime) + durationMinutes),
    };
  }

  return {};
}

export function extractMemoHint(text: string): string {
  const normalizedText = normalizeParsingText(text);
  const matchedHints = CHAPTER_PATTERNS.flatMap((pattern) => {
    const matches = normalizedText.match(pattern);
    return matches ?? [];
  });

  return Array.from(new Set(matchedHints.map((value) => value.replace(/\s+/g, ' ').trim()))).join(' / ');
}

export function sanitizeSuggestedTitle(text: string): string {
  const withoutSchedule = removeSchedulingTerms(text)
    .replace(/[「」"'、。,]/g, ' ');
  const withoutChapterMarkers = CHAPTER_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, ' '),
    withoutSchedule,
  );

  const withoutActionWords = getActionWordPatterns().reduce(
    (current, pattern) => current.replace(pattern, ' '),
    withoutChapterMarkers,
  );

  return withoutActionWords.replace(/\s+/g, ' ').trim();
}

export function matchPlan(text: string, plans: Plan[]): Plan | undefined {
  const normalized = text.trim();

  return [...plans]
    .map((plan) => {
      let score = 0;

      if (normalized.includes(plan.title)) {
        score += 4;
      }

      if (plan.subject && normalized.includes(plan.subject)) {
        score += 2;
      }

      if (normalized.includes(plan.date.slice(5))) {
        score += 1;
      }

      return { plan, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.plan;
}

function hasExplicitDateExpression(text: string): boolean {
  const normalizedText = normalizeParsingText(text);
  return /明後日|明日|今日|今週|来週|[月火水木金土日]曜(?:日)?|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/.test(normalizedText);
}

export function isBreakLikeText(text: string): boolean {
  const normalizedText = normalizeParsingText(text).replace(/\s+/g, '');

  return (
    /休憩|休んで|休む|ひと休み|一休み|休み/.test(normalizedText) &&
    !/英語|数学|国語|物理|化学|生物|地学|情報|日本史|世界史|地理|政経|倫理|古文|漢文|現代文|レポート|課題|チャート|良問の風|英単語|古文単語/.test(
      normalizedText,
    )
  );
}

function hasTaskCue(text: string): boolean {
  return (
    hasExplicitClockTime(text) ||
    parseDurationMinutes(text) !== undefined ||
    Boolean(detectSubject(text)) ||
    detectType(text) !== 'study' ||
    /勉強|やる|する|進める|復習|演習|模試|面接|体育祭|英単語|古文単語/.test(
      normalizeParsingText(text),
    )
  );
}

function prependSharedDate(text: string, sharedDatePhrase: string): string {
  if (!sharedDatePhrase || hasExplicitDateExpression(text)) {
    return text.trim();
  }

  return `${sharedDatePhrase} ${text}`.trim();
}

export function splitAddTaskTexts(text: string): string[] {
  const normalizedText = normalizeParsingText(text).replace(/\r\n?/g, '\n').trim();

  if (!normalizedText) {
    return [];
  }

  const sharedDatePhrase =
    normalizedText.match(SHARED_DATE_PHRASE_REGEX)?.[0] ??
    '';
  const hardSegments = normalizedText
    .split(/\n+|[。；;]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const segments = hardSegments.flatMap((segment) => {
    const softSegments = segment
      .split(/\s*(?:、|,|，|そのあと|その後|次に|あと|ただし|その代わり|代わりに)\s*/g)
      .map((part) => part.trim())
      .filter(Boolean);

    if (softSegments.length <= 1 || !softSegments.every(hasTaskCue)) {
      return [segment];
    }

    return softSegments;
  });

  const normalizedSegments = segments
    .map((segment) => prependSharedDate(segment, sharedDatePhrase))
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((segment) => !isBreakLikeText(segment));

  const uniqueSegments = normalizedSegments.filter(
    (segment, index, array) => array.indexOf(segment) === index,
  );

  return uniqueSegments.length > 0 ? uniqueSegments : [normalizedText];
}

function buildReason(mode: NaturalLanguageMode, matchedPlan?: Plan): string {
  if (mode === 'edit' && matchedPlan) {
    return `既存予定「${matchedPlan.title}」を基準に、文中の日付と時刻を反映した叩き台です。`;
  }

  if (mode === 'edit') {
    return '変更対象は未確定です。候補の予定を選んでから反映してください。';
  }

  return '日付・時刻・予定種別を自然言語から推定した追加案です。';
}

export function generateRuleBasedSuggestion({
  mode,
  text,
  selectedDate,
  plans,
  userId,
}: SuggestionInput): NaturalLanguageSuggestion {
  const matchedPlan = mode === 'edit' ? matchPlan(text, plans) : undefined;
  const detectedDate = parseDate(text, selectedDate);
  const baseDraft = matchedPlan
    ? {
        userId,
        title: matchedPlan.title,
        subject: matchedPlan.subject,
        date: matchedPlan.date,
        startTime: matchedPlan.startTime,
        endTime: matchedPlan.endTime,
        type: matchedPlan.type,
        memo: matchedPlan.memo,
        repeat: matchedPlan.repeat,
        repeatUntil: matchedPlan.repeatUntil,
        excludedDates: matchedPlan.excludedDates,
      }
    : defaultDraft(userId, detectedDate);
  const detectedType = detectType(text);
  const detectedSubject = detectSubject(text);
  const detectedTimes = parseTimes(text, baseDraft.startTime);
  const detectedRepeat = detectRepeat(text);
  const cleanedTitle = sanitizeSuggestedTitle(text);
  const memoHint = extractMemoHint(text);

  const nextDraft: PlanDraft = {
    ...baseDraft,
    date: detectedDate,
    startTime: detectedTimes.startTime ?? baseDraft.startTime,
    endTime: detectedTimes.endTime ?? baseDraft.endTime,
    type: detectedType,
    subject: detectedSubject || baseDraft.subject,
    title:
      cleanedTitle ||
      baseDraft.title ||
      buildDefaultPlanTitle(detectedType, detectedSubject || baseDraft.subject),
    memo: memoHint || baseDraft.memo,
    repeat: detectedRepeat === 'none' ? baseDraft.repeat : detectedRepeat,
    repeatUntil: detectedRepeat === 'none' ? baseDraft.repeatUntil : null,
    excludedDates: detectedRepeat === 'none' ? baseDraft.excludedDates : [],
  };

  const detectedFieldCount = [
    detectedDate !== selectedDate,
    Boolean(detectedTimes.startTime),
    Boolean(detectedSubject),
    Boolean(cleanedTitle),
  ].filter(Boolean).length;

  return {
    mode,
    rawText: text,
    confidence: Math.min(0.55 + detectedFieldCount * 0.1, 0.92),
    reason: buildReason(mode, matchedPlan),
    source: 'rules',
    providerLabel: 'ルールベース',
    status: 'ready',
    matchedPlanId: matchedPlan?.id,
    parsedPlan: nextDraft,
    assumptions: [],
    unresolvedFields: [],
    issues: [],
  };
}
