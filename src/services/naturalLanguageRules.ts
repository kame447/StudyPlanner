import { addDays, minutesFromTime, startOfWeek, timeFromMinutes } from '../lib/date';
import { buildDefaultPlanTitle } from '../lib/plans';
import { getRecurrenceWeekday, normalizeRecurrenceRules } from '../lib/planRecurrence';
import { getNaturalLanguageCatalog } from '../data/naturalLanguageCatalog';
import type {
  MonthEventRepeat,
  NaturalLanguageMode,
  NaturalLanguageSuggestion,
  Plan,
  PlanDraft,
  PlanType,
  RecurrenceRule,
  RecurrenceWeekday,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

export interface SuggestionInput {
  mode: NaturalLanguageMode;
  text: string;
  selectedDate: string;
  plans: Plan[];
  userId: string;
  userMaterials?: StudyMaterial[];
  userSubjects?: StudySubject[];
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
  '(\\d{1,2})(?:(?::(\\d{2}))|時(?!間)(半)?)';
const CLOCK_TIME_REGEX = new RegExp(CLOCK_TIME_PATTERN);
const CLOCK_TIME_GLOBAL_REGEX = new RegExp(CLOCK_TIME_PATTERN, 'g');
export const CLOCK_RANGE_REGEX = new RegExp(
  `${CLOCK_TIME_PATTERN}\\s*(?:-|〜|~|から)\\s*${CLOCK_TIME_PATTERN}`,
);
const CLOCK_RANGE_GLOBAL_REGEX = new RegExp(
  `${CLOCK_TIME_PATTERN}\\s*(?:-|〜|~|から)\\s*${CLOCK_TIME_PATTERN}`,
  'g',
);
export const CROSS_DAY_CLOCK_RANGE_REGEX = new RegExp(
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
const WEEKDAY_TOKEN_REGEX = /([月火水木金土日])曜(?:日)?/g;
const SHARED_DATE_PHRASE_REGEX =
  /明後日|明日|今日|来週(?:の)?[月火水木金土日]曜(?:日)?|今週(?:の)?[月火水木金土日]曜(?:日)?|[月火水木金土日]曜(?:日)?|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/;
const LEADING_SHARED_DATE_PHRASE_REGEX = new RegExp(
  `^\\s*(${SHARED_DATE_PHRASE_REGEX.source})`,
);

function toRecurrenceWeekdays(labels: string[]): RecurrenceWeekday[] {
  return labels
    .map((label) => {
      switch (label) {
        case '日':
          return 'sun';
        case '月':
          return 'mon';
        case '火':
          return 'tue';
        case '水':
          return 'wed';
        case '木':
          return 'thu';
        case '金':
          return 'fri';
        case '土':
          return 'sat';
        default:
          return null;
      }
    })
    .filter((value): value is RecurrenceWeekday => value !== null);
}
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
    .toLowerCase()
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
    recurrenceRules: [],
  };
}

export function detectType(text: string): PlanType {
  const normalizedText = normalizeParsingText(text);
  const looksLikeStudy =
    /(toeic|過去問|演習|復習|自習|自習時間|振り返り|良問の風|チャート|英単語|単語|長文|文法|レポート|課題|勉強|学習)/i.test(
      normalizedText,
    );
  const explicitNonStudy =
    /模試|学校行事|行事|塾|締切|提出|面談|面接|体育祭|文化祭/.test(
      normalizedText,
    );

  if (looksLikeStudy && !explicitNonStudy) {
    return 'study';
  }

  const matchedRule = getNaturalLanguageCatalog().planTypes.find((rule) =>
    rule.keywords.some((keyword) => includesKeyword(text, keyword)),
  );

  if (matchedRule) {
    if (
      matchedRule.type === 'mock-exam' &&
      looksLikeStudy &&
      !/模試/.test(normalizedText)
    ) {
      return 'study';
    }
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

  const detectedLabel = bestMatch?.label ?? '';

  if (/振り返り/.test(normalizedText)) {
    return '振り返り';
  }

  if (/自習/.test(normalizedText)) {
    return '自習';
  }

  if (/toeic/.test(normalizedText) || detectedLabel === 'TOEIC') {
    return '英語';
  }

  if (detectedLabel === '単語') {
    return /古文|漢文/.test(normalizedText) ? '国語' : '英語';
  }

  if (detectedLabel === 'レポート' || detectedLabel === '課題') {
    return /情報/.test(normalizedText) ? '情報' : '課題';
  }

  if (
    detectedLabel === '共通テスト' &&
    /過去問|演習/.test(normalizedText)
  ) {
    return '演習';
  }

  if (['現代文', '古文', '漢文', '古典'].includes(detectedLabel)) {
    return '国語';
  }

  return detectedLabel;
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
      /そのあと|その後|次に|続けて|朝の|朝|午前|午後|夜|夕方|おひるごはん食べた後に|お昼ごはん食べた後に|昼ごはん食べた後に|昼食後に?|毎朝|毎晩|毎夜|毎日|毎週|毎月|毎年|毎[月火水木金土日](?:曜)?|同じ時間帯に?|同じ時間に?|ようにしたい|として固定して|固定して|その代わり|他の日は|だけは|けど|けれど|もし|なら|時間は?|合計|テスト前日/g,
      '',
    )
    .replace(/\d+回/g, '')
    .replace(/全部|全て|連続で/g, '')
    .replace(/追加|入れて|登録|変更|修正|ずらして|にして|変えて|変える|予定|進める/g, '')
    .replace(/\b(?:から|まで|だけ|は|を|に|で|が|へ|の|と|間|半)\b/g, ' ');
}

function extractWeekdayLabels(text: string): string[] {
  const normalizedText = normalizeParsingText(text);
  const labels = Array.from(normalizedText.matchAll(WEEKDAY_TOKEN_REGEX)).map(
    (match) => match[1],
  );
  const compactSetMatches = Array.from(
    normalizedText.matchAll(/([月火水木金土日]{2,})(?:の|は|だけ|と|、|,|，)/g),
  ).flatMap((match) => match[1].split(''));

  return [...labels, ...compactSetMatches].filter(
    (label, index, array) => array.indexOf(label) === index,
  );
}

function hasOverrideCue(text: string): boolean {
  return /ただし|その代わり|代わりに|だけ|のみ|除く|他の日は|けど|けれど/.test(
    normalizeParsingText(text),
  );
}

function splitRecurrenceClauses(text: string): {
  baseClause: string;
  overrideClauses: string[];
} {
  const normalizedText = normalizeParsingText(text).trim();

  if (!normalizedText) {
    return {
      baseClause: '',
      overrideClauses: [],
    };
  }

  const clausePool: string[] = [];
  const overrideClauses: string[] = [];
  const sentenceParts = normalizedText
    .split(/\s*(?:。|；|;|\n+)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  sentenceParts.forEach((sentence) => {
    const clauses = sentence
      .split(/\s*(?:ただし|その代わり|代わりに|けど|けれど)\s*/g)
      .map((part) => part.trim())
      .filter(Boolean);

    clauses.forEach((clause, index) => {
      if (index === 0 && !hasOverrideCue(clause)) {
        clausePool.push(clause);
      } else {
        overrideClauses.push(clause);
      }
    });
  });

  const baseClause =
    clausePool.find((clause) =>
      /他の日は|毎朝|毎晩|毎夜|毎日|毎週|平日|土日|週末/.test(
        normalizeParsingText(clause),
      ),
    ) ??
    clausePool[0] ??
    overrideClauses.find((clause) =>
      /他の日は|毎朝|毎晩|毎夜|毎日|毎週|平日|土日|週末/.test(
        normalizeParsingText(clause),
      ),
    ) ??
    overrideClauses[0] ??
    normalizedText;

  const normalizedOverrides = [
    ...overrideClauses,
    ...clausePool.filter((clause) => clause !== baseClause),
  ].filter((clause, index, array) => array.indexOf(clause) === index);

  return {
    baseClause,
    overrideClauses: normalizedOverrides,
  };
}

function inferClauseRuleShape(
  text: string,
  draft: PlanDraft,
  fallbackRule?: RecurrenceRule,
): Pick<RecurrenceRule, 'kind' | 'weekdays' | 'dayType' | 'dates'> {
  const normalizedText = normalizeParsingText(text);
  const weekdayLabels = toRecurrenceWeekdays(extractWeekdayLabels(normalizedText));

  if (/平日/.test(normalizedText)) {
    return {
      kind: 'day-type',
      weekdays: [],
      dayType: 'weekday',
      dates: [],
    };
  }

  if (/土日|週末/.test(normalizedText)) {
    return {
      kind: 'day-type',
      weekdays: [],
      dayType: 'weekend',
      dates: [],
    };
  }

  if (weekdayLabels.length > 0) {
    return {
      kind: 'weekday',
      weekdays: weekdayLabels,
      dayType: null,
      dates: [],
    };
  }

  if (fallbackRule) {
    return {
      kind: fallbackRule.kind,
      weekdays: [...fallbackRule.weekdays],
      dayType: fallbackRule.dayType,
      dates: [...fallbackRule.dates],
    };
  }

  if (draft.repeat === 'weekly') {
    return {
      kind: 'weekday',
      weekdays: [getRecurrenceWeekday(draft.date)],
      dayType: null,
      dates: [],
    };
  }

  return {
    kind: 'daily',
    weekdays: [],
    dayType: null,
    dates: [],
  };
}

function resolveClauseTimeRange(
  text: string,
  draft: PlanDraft,
): Pick<PlanDraft, 'startTime' | 'endTime'> {
  const normalizedText = normalizeParsingText(text);
  const parsedTimes = parseTimes(text, draft.startTime);
  const explicitDuration = parseDurationMinutes(normalizedText);
  const hasExplicitRange =
    CROSS_DAY_CLOCK_RANGE_REGEX.test(normalizedText) ||
    CLOCK_RANGE_REGEX.test(normalizedText);
  const hasExplicitStart = CLOCK_TIME_REGEX.test(normalizedText);
  const baseDuration =
    minutesFromTime(draft.endTime) - minutesFromTime(draft.startTime);
  const startTime = parsedTimes.startTime || draft.startTime;

  if (hasExplicitRange) {
    return {
      startTime,
      endTime: parsedTimes.endTime || draft.endTime,
    };
  }

  if (hasExplicitStart && explicitDuration === undefined) {
    return {
      startTime,
      endTime: timeFromMinutes(minutesFromTime(startTime) + baseDuration),
    };
  }

  if (!hasExplicitStart && explicitDuration !== undefined) {
    return {
      startTime: draft.startTime,
      endTime: timeFromMinutes(minutesFromTime(draft.startTime) + explicitDuration),
    };
  }

  return {
    startTime,
    endTime: parsedTimes.endTime || draft.endTime,
  };
}

const GENERIC_RULE_TITLE_PATTERN =
  /^(?:勉強|学習|予定|開始|変更|修正|追加|登録|固定|にして|に変えて|変えて|変える|から|まで|だけ|のみ|除く|けど|けれど|ただし|その代わり|月火木金|月水金|火木土|のから|はから|とのから|時|時間|合計|テスト前日|\d+日|\d+回|\d+セット|[月火水木金土日]{2,})$/;

function trimRuleTitlePhrase(value: string): string {
  let current = normalizeParsingText(value)
    .replace(/[「」"'、。,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let previous = '';

  while (current && current !== previous) {
    previous = current;
    current = current
      .replace(/^(今日|明日|明後日)(?:の)?/g, '')
      .replace(/^(今週|来週|再来週)(?:の|は)?/g, '')
      .replace(/^\d{1,2}月中(?:は)?/g, '')
      .replace(/^(?:\d{1,2}月\d{1,2}日(?:まで|から|より)?)(?:は)?/g, '')
      .replace(/^(?:その日|この日|当日)(?:の)?/g, '')
      .replace(
        /^(?:(?:[月火水木金土日]曜(?:日)?(?:と|、|,|，)?)+(?:の夜|の朝|の昼|は)?|[月火水木金土日]{2,}(?:の夜|の朝|の昼|の|は|のは|だけ|だけは)?|月水金は|火木土は|月火木金(?:の\d+回)?(?:は)?|平日は|土日は|週末は|他の日は|毎日|毎朝|毎晩|毎夜|毎週|毎[月火水木金土日]曜(?:日)?)+/g,
        '',
      )
      .replace(
        /^(?:けど|けれど|ただし|その代わり|代わりに|もし[^、。]*なら|模試の前日なら|テスト前日|バイトがある|[^、。]*?(?:のみ|を除く|は除く))+/g,
        '',
      )
      .replace(/^(?:時間は?|合計)+/g, '')
      .replace(/\s*\d+\s*回\s*/g, ' ')
      .replace(/\s*\d+\s*日\s*/g, ' ')
      .replace(/\s*(?:全部|全て|連続で|どこかで)\s*/g, ' ')
      .replace(/^(?:から|まで|間|半|だけ|ずつ|して|のみ|除く|にして|に変えて|変えて|変える)+/g, '')
      .replace(/(?:から|まで|間|半|だけ|ずつ|して|のみ|除く|にして|に変えて|変えて|変える|時)+$/g, '')
      .replace(/^(?:に|で|を|は|が|の|へ|と)+/g, '')
      .replace(/(?:に|で|を|は|が|の|へ|と)+$/g, '')
      .replace(/(?:を)?(?:やる|する|進める|復習|演習|学習|勉強|予定|追加|入れて|入れる|登録|固定して)$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return current;
}

function stripLeadingSubjectFromRuleTitle(title: string, subject: string): string {
  const normalizedTitle = trimRuleTitlePhrase(title);
  const normalizedSubject = subject.trim();

  if (!normalizedTitle || !normalizedSubject) {
    return normalizedTitle;
  }

  const strippedTitle = normalizedTitle.replace(
    new RegExp(
      `^${normalizedSubject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:の|を|で|は|:|：|/|／|\\s+)`,
      'i',
    ),
    '',
  );

  return trimRuleTitlePhrase(strippedTitle);
}

function buildPreferredRuleStudyTitle(
  rawText: string,
  subject: string,
  currentTitle: string,
): string {
  const normalizedText = normalizeParsingText(rawText);
  const normalizedTitle = trimRuleTitlePhrase(currentTitle);
  const explicitPatterns: Array<[RegExp, string]> = [
    [/(情報の課題)/, '情報の課題'],
    [/(情報のレポート)/, '情報のレポート'],
    [/(英語長文)/, '英語長文'],
    [/(TOEICの勉強|TOEIC勉強|TOEIC)/i, 'TOEICの勉強'],
    [/(共通テスト(?:の)?過去問(?:演習)?)/, '共通テスト過去問演習'],
    [/(過去問演習)/, '過去問演習'],
    [/(良問の風)/, '良問の風'],
    [/(青チャート)/, '青チャート'],
    [/(黄色チャート)/, '黄色チャート'],
    [/(システム英単語)/, 'システム英単語'],
    [/(ターゲット1900)/, 'ターゲット1900'],
    [/(英単語の復習)/, '英単語の復習'],
    [/(週の振り返り|その週の振り返り)/, '週の振り返り'],
    [/(自習時間)/, '自習時間'],
    [/(勉強予定)/, '勉強予定'],
  ];

  for (const [pattern, value] of explicitPatterns) {
    if (pattern.test(normalizedText)) {
      return value;
    }
  }

  if (/英単語/.test(normalizedText) && /復習/.test(normalizedText)) {
    return '英単語の復習';
  }

  if (
    normalizedTitle &&
    !GENERIC_RULE_TITLE_PATTERN.test(normalizedTitle) &&
    normalizedTitle !== subject.trim()
  ) {
    return normalizedTitle;
  }

  return subject.trim() || normalizedTitle;
}

function normalizeRuleStudyLabels(params: {
  rawText: string;
  subject: string;
  title: string;
  type: PlanType;
  fallbackTitle?: string;
}): { subject: string; title: string } {
  const normalizedSubject =
    detectSubject(
      [params.subject, params.title, params.rawText].filter(Boolean).join(' '),
    ) || params.subject.trim();
  let normalizedTitle = trimRuleTitlePhrase(params.title);

  if (params.type === 'study') {
    const strippedTitle = stripLeadingSubjectFromRuleTitle(
      normalizedTitle,
      normalizedSubject,
    );

    if (strippedTitle) {
      normalizedTitle = strippedTitle;
    }

    if (
      !normalizedTitle ||
      normalizedTitle === normalizedSubject ||
      GENERIC_RULE_TITLE_PATTERN.test(normalizedTitle)
    ) {
      const rawCandidate = stripLeadingSubjectFromRuleTitle(
        trimRuleTitlePhrase(sanitizeSuggestedTitle(params.rawText)),
        normalizedSubject,
      );

      if (
        rawCandidate &&
        rawCandidate !== normalizedSubject &&
        !GENERIC_RULE_TITLE_PATTERN.test(rawCandidate)
      ) {
        normalizedTitle = rawCandidate;
      }
    }
  }

  if (!normalizedTitle || GENERIC_RULE_TITLE_PATTERN.test(normalizedTitle)) {
    normalizedTitle =
      params.fallbackTitle?.trim() ||
      buildDefaultPlanTitle(params.type, normalizedSubject);
  }

  return {
    subject: normalizedSubject,
    title: normalizedTitle,
  };
}

function buildClauseDraft(
  text: string,
  draft: PlanDraft,
  fallbackRule?: RecurrenceRule,
): PlanDraft {
  const normalizedLabels = normalizeRuleStudyLabels({
    rawText: text,
    subject: detectSubject(text) || draft.subject,
    title: sanitizeSuggestedTitle(text),
    type: draft.type,
    fallbackTitle: draft.title,
  });
  const timeValues = resolveClauseTimeRange(text, draft);

  return {
    ...draft,
    title: buildPreferredRuleStudyTitle(
      text,
      normalizedLabels.subject,
      normalizedLabels.title,
    ),
    subject: normalizedLabels.subject,
    startTime: timeValues.startTime,
    endTime: timeValues.endTime,
    repeatUntil: detectRepeatUntilText(text, draft.date) ?? draft.repeatUntil,
    recurrenceRules: fallbackRule ? [fallbackRule] : draft.recurrenceRules,
  };
}

export function detectRepeat(text: string): MonthEventRepeat {
  const normalizedText = normalizeParsingText(text);

  if (/毎朝|毎晩|毎夜|毎日/.test(normalizedText)) {
    return 'daily';
  }

  if (
    /平日|土日|週末|毎週|毎[月火水木金土日]曜(?:日)?|[月火水木金土日]曜(?:日)?は|(?:月|火|水|木|金|土|日){2,}(?:の夜|の朝|の昼|は|だけ|だけは)/.test(
      normalizedText,
    )
  ) {
    return 'weekly';
  }

  if (/毎月/.test(normalizedText)) {
    return 'monthly';
  }

  if (/毎年/.test(normalizedText)) {
    return 'yearly';
  }

  return 'none';
}

function detectRepeatUntilText(text: string, baseDate: string): string | null {
  const normalizedText = normalizeParsingText(text);
  const baseYear = Number(baseDate.slice(0, 4));
  const explicitDateMatch = normalizedText.match(/(\d{1,2})月(\d{1,2})日まで/);

  if (explicitDateMatch) {
    const month = explicitDateMatch[1].padStart(2, '0');
    const day = explicitDateMatch[2].padStart(2, '0');
    return `${baseYear}-${month}-${day}`;
  }

  const slashDateMatch = normalizedText.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})まで/);

  if (slashDateMatch) {
    return `${slashDateMatch[1]}-${slashDateMatch[2].padStart(2, '0')}-${slashDateMatch[3].padStart(2, '0')}`;
  }

  const monthOnlyMatch = normalizedText.match(/(\d{1,2})月中/);

  if (monthOnlyMatch) {
    const month = Number(monthOnlyMatch[1]);
    return `${baseYear}-${month.toString().padStart(2, '0')}-${daysInMonth(baseYear, month)
      .toString()
      .padStart(2, '0')}`;
  }

  return null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function buildStructuredRecurrenceRules(
  text: string,
  draft: PlanDraft,
  selectedDate = draft.date,
): RecurrenceRule[] {
  if (draft.repeat === 'none' && detectRepeat(text) === 'none') {
    return [];
  }

  const normalizedText = normalizeParsingText(text);
  const { baseClause, overrideClauses } = splitRecurrenceClauses(normalizedText);
  const baseDraft = buildClauseDraft(baseClause, draft);
  const recurrenceStartDate = resolveRecurrenceStartDate(
    baseClause,
    selectedDate,
    draft.date,
    baseDraft.repeatUntil,
  );
  const baseShape = inferClauseRuleShape(baseClause, draft);
  const baseRule = normalizeRecurrenceRules(
    [
      {
        id: 'recurrence-base',
        startDate: recurrenceStartDate,
        until: baseDraft.repeatUntil,
        dates: baseShape.dates,
        weekdays: baseShape.weekdays,
        dayType: baseShape.dayType,
        startTime: baseDraft.startTime,
        endTime: baseDraft.endTime,
        title: baseDraft.title,
        subject: baseDraft.subject,
        type: baseDraft.type,
        memo: baseDraft.memo,
        kind: baseShape.kind,
        isOverride: false,
      },
    ],
    baseDraft,
  )[0];

  const overrideRules = overrideClauses
    .flatMap((clauseText, index) => {
      const overrideDraft = buildClauseDraft(clauseText, baseDraft, baseRule);
      const overrideShape = inferClauseRuleShape(clauseText, overrideDraft, baseRule);
      const until =
        detectRepeatUntilText(clauseText, baseRule.startDate) ??
        baseRule.until ??
        overrideDraft.repeatUntil;

      if (
        !/平日|土日|週末|[月火水木金土日]曜(?:日)?|[月火水木金土日]{2,}|だけ|のみ|除く|他の日/.test(
          clauseText,
        )
      ) {
        return [];
      }

      const baseOverrideRule = {
        startDate: resolveRecurrenceStartDate(
          clauseText,
          selectedDate,
          baseRule.startDate,
          until,
        ),
        until,
        dates: overrideShape.dates,
        weekdays: overrideShape.weekdays,
        dayType: overrideShape.dayType,
        startTime: overrideDraft.startTime,
        endTime: overrideDraft.endTime,
        title: overrideDraft.title,
        subject: overrideDraft.subject,
        type: overrideDraft.type,
        memo: overrideDraft.memo,
        kind: overrideShape.kind,
        isOverride: true,
      };

      if (overrideShape.kind === 'weekday' && overrideShape.weekdays.length > 1) {
        return overrideShape.weekdays.map((weekday, weekdayIndex) =>
          normalizeRecurrenceRules(
            [
              {
                ...baseOverrideRule,
                id: `recurrence-override-${index + 1}-${weekdayIndex + 1}`,
                weekdays: [weekday],
              },
            ],
            overrideDraft,
          )[0],
        );
      }

      return [
        normalizeRecurrenceRules(
          [
            {
              ...baseOverrideRule,
              id: `recurrence-override-${index + 1}`,
            },
          ],
          overrideDraft,
        )[0],
      ];
    })
    .filter((rule): rule is RecurrenceRule => Boolean(rule));

  return normalizeRecurrenceRules(
    refineRulesForOverrides([baseRule, ...overrideRules]),
    draft,
  );
}

function refineRulesForOverrides(rules: RecurrenceRule[]): RecurrenceRule[] {
  const baseRule = rules.find((rule) => !rule.isOverride);

  if (!baseRule) {
    return rules;
  }

  const weekdayOverrides = rules
    .filter((rule) => rule.isOverride && rule.kind === 'weekday')
    .flatMap((rule) => rule.weekdays);

  if (
    baseRule.kind === 'daily' &&
    rules.some(
      (rule) =>
        rule.isOverride &&
        ((rule.kind === 'day-type' && rule.dayType === 'weekend') ||
          (rule.kind === 'weekday' &&
            rule.weekdays.includes('sat') &&
            rule.weekdays.includes('sun'))),
    )
  ) {
    baseRule.kind = 'day-type';
    baseRule.dayType = 'weekday';
    baseRule.weekdays = [];
    baseRule.dates = [];
  } else if (baseRule.kind === 'daily' && weekdayOverrides.length > 0) {
    baseRule.kind = 'weekday';
    baseRule.dayType = null;
    baseRule.dates = [];
    baseRule.weekdays = (['mon','tue','wed','thu','fri','sat','sun'] as RecurrenceWeekday[])
      .filter((weekday) => !weekdayOverrides.includes(weekday));
  }

  if (baseRule.kind === 'weekday') {
    const overriddenWeekdays = rules
      .filter((rule) => rule.isOverride && rule.kind === 'weekday')
      .flatMap((rule) => rule.weekdays);

    if (overriddenWeekdays.length > 0) {
      baseRule.weekdays = baseRule.weekdays.filter(
        (weekday) => !overriddenWeekdays.includes(weekday),
      );
    }
  }

  return rules.filter(
    (rule) =>
      rule !== baseRule ||
      rule.kind !== 'weekday' ||
      rule.weekdays.length > 0,
  );
}

function resolveRecurrenceStartDate(
  normalizedText: string,
  selectedDate: string,
  fallbackDate: string,
  repeatUntil: string | null,
): string {
  if (/来週から/.test(normalizedText)) {
    return addDays(startOfWeek(selectedDate), 7);
  }

  if (/明後日から/.test(normalizedText)) {
    return addDays(selectedDate, 2);
  }

  if (/明日から/.test(normalizedText)) {
    return addDays(selectedDate, 1);
  }

  if (/今日から/.test(normalizedText)) {
    return selectedDate;
  }

  if (
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:から|より)|\d{1,2}\/\d{1,2}(?:から|より)|\d{1,2}月\d{1,2}日(?:から|より)/.test(
      normalizedText,
    )
  ) {
    return fallbackDate;
  }

  if (repeatUntil && /まで/.test(normalizedText) && fallbackDate === repeatUntil) {
    return selectedDate;
  }

  if (/毎朝|毎晩|毎夜|毎日|平日|土日|週末|毎週|毎[月火水木金土日]曜(?:日)?/.test(normalizedText)) {
    return selectedDate;
  }

  return fallbackDate;
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
    .filter((value, index, array) => array.indexOf(value) === index);
  const selected = new Date(`${selectedDate}T00:00:00`);
  const selectedIndex = selected.getDay() === 0 ? 6 : selected.getDay() - 1;
  const sortedByDistance = targetIndices.sort((left, right) => {
    const leftDiff = (left - selectedIndex + 7) % 7;
    const rightDiff = (right - selectedIndex + 7) % 7;
    return leftDiff - rightDiff;
  });

  for (const targetIndex of sortedByDistance) {
    const diff = (targetIndex - selectedIndex + 7) % 7;
    return addDays(selectedDate, diff);
  }

  return addDays(selectedDate, (sortedByDistance[0] - selectedIndex + 7) % 7);
}

export function parseDate(text: string, selectedDate: string): string {
  const normalizedText = normalizeParsingText(text);
  const weekdayLabels = extractWeekdayLabels(normalizedText);

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

  if (weekdayMatch && !/毎週|毎[月火水木金土日]曜(?:日)?/.test(normalizedText)) {
    return resolveWeekdayDate(selectedDate, weekdayMatch[1], 'current_or_next');
  }

  if (weekdayLabels.length >= 2) {
    return resolveNearestMatchingWeekday(selectedDate, weekdayLabels);
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
  return /明後日|明日|今日|今週|来週|[月火水木金土日]曜(?:日)?|[月火水木金土日]{2,}(?:の夜|の朝|の昼|は|だけ|だけは)?|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/.test(normalizedText);
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

function isTimeOnlySupportText(text: string): boolean {
  const normalizedText = normalizeParsingText(text).trim();

  return /^(?:時間は?)\s*\d{1,2}(?::\d{2})?(?:で|です)?$/.test(normalizedText);
}

function hasTaskCue(text: string): boolean {
  if (isTimeOnlySupportText(text)) {
    return false;
  }

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

function isStandaloneRecurrenceLike(text: string): boolean {
  const normalizedText = normalizeParsingText(text);

  return (
    detectRepeat(normalizedText) !== 'none' &&
    !hasExplicitClockTime(normalizedText) &&
    parseDurationMinutes(normalizedText) === undefined
  );
}

function prependSharedDate(text: string, sharedDatePhrase: string): string {
  if (!sharedDatePhrase || hasExplicitDateExpression(text)) {
    return text.trim();
  }

  return `${sharedDatePhrase} ${text}`.trim();
}

function isContinuationSegment(text: string): boolean {
  const normalizedText = normalizeParsingText(text).trim();

  return /^(?:これを\s*\d+\s*セット|全部|連続で|(?:もう)?\d+回(?:目)?は|もう1回は|もう一回は|もし|時間は?\s*\d{1,2}(?::\d{2})?(?:で|です)?)/.test(
    normalizedText,
  );
}

function isPersistentPrefixSegment(text: string): boolean {
  const normalizedText = normalizeParsingText(text).trim();

  return (
    isStandaloneRecurrenceLike(normalizedText) ||
    /^(?:毎日の予定に?|来週のどこかで|今週のどこかで|(?:来週|今週|今日|明日|明後日)?から?.*まで)$/.test(normalizedText)
  );
}

function hasMeaningfulTitleCandidate(text: string): boolean {
  const candidate = trimRuleTitlePhrase(sanitizeSuggestedTitle(text));
  return Boolean(candidate) && !GENERIC_RULE_TITLE_PATTERN.test(candidate);
}

function shouldMergeComplementarySegment(
  previousSegment: string,
  nextSegment: string,
): boolean {
  const previousText = normalizeParsingText(previousSegment);
  const nextText = normalizeParsingText(nextSegment);
  const previousHasScheduleBits =
    hasExplicitClockTime(previousText) ||
    parseDurationMinutes(previousText) !== undefined ||
    detectRepeat(previousText) !== 'none' ||
    hasExplicitDateExpression(previousText) ||
    /まで/.test(previousText);
  const previousHasOverrideCue = hasOverrideCue(previousText);
  const previousHasIdentity =
    Boolean(detectSubject(previousText)) || hasMeaningfulTitleCandidate(previousText);
  const nextHasIdentity =
    Boolean(detectSubject(nextText)) || hasMeaningfulTitleCandidate(nextText);
  const nextHasScheduleBits =
    hasExplicitClockTime(nextText) ||
    parseDurationMinutes(nextText) !== undefined ||
    detectRepeat(nextText) !== 'none' ||
    hasExplicitDateExpression(nextText);

  if (
    previousHasScheduleBits &&
    !previousHasOverrideCue &&
    !previousHasIdentity &&
    nextHasIdentity
  ) {
    return true;
  }

  if (
    !hasTaskCue(previousText) &&
    /まで|から|平日|土日|週末|毎日|毎朝|毎晩|毎夜|毎週|[月火水木金土日]曜(?:日)?|[月火水木金土日]{2,}/.test(previousText) &&
    nextHasScheduleBits
  ) {
    return true;
  }

  return false;
}

function mergeHardSegments(segments: string[]): string[] {
  const merged: string[] = [];

  segments.forEach((segment) => {
    const previousSegment = merged[merged.length - 1];
    const normalizedSegment = normalizeParsingText(segment).trim();

    if (previousSegment && isTimeOnlySupportText(normalizedSegment)) {
      merged[merged.length - 1] = `${previousSegment} ${normalizedSegment}`.trim();
      return;
    }

    if (
      previousSegment &&
      /\d+回(?:入れて|やって|予定に入れて)/.test(normalizeParsingText(previousSegment)) &&
      /^(?:\d+回(?:目)?は|もう1回は|もう一回は|全部)/.test(normalizeParsingText(segment))
    ) {
      merged[merged.length - 1] = `${previousSegment} ${segment}`.trim();
      return;
    }

    if (
      previousSegment &&
      /\d+回(?:入れて|やって|予定に入れて)/.test(normalizeParsingText(previousSegment)) &&
      /^連続で$/.test(normalizeParsingText(segment))
    ) {
      merged[merged.length - 1] = `${previousSegment} ${segment}`.trim();
      return;
    }

    merged.push(segment);
  });

  return merged;
}

function mergeSoftSegments(segments: string[]): string[] {
  const merged: string[] = [];
  let persistentPrefix = '';

  segments.forEach((segment) => {
    const normalizedSegment = normalizeParsingText(segment).trim();
    const previousSegment = merged[merged.length - 1];
    const normalizedPreviousSegment = normalizeParsingText(previousSegment ?? '');

    if (!normalizedSegment) {
      return;
    }

    if (isPersistentPrefixSegment(normalizedSegment)) {
      persistentPrefix = persistentPrefix
        ? `${persistentPrefix} ${normalizedSegment}`.trim()
        : normalizedSegment;
      return;
    }

    const nextSegment =
      persistentPrefix && !hasExplicitDateExpression(normalizedSegment)
        ? `${persistentPrefix} ${normalizedSegment}`.trim()
        : normalizedSegment;

    if (
      previousSegment &&
      /\d+回(?:入れて|やって|予定に入れて)/.test(normalizedPreviousSegment) &&
      /^連続で$/.test(normalizedSegment)
    ) {
      merged[merged.length - 1] = `${previousSegment} ${normalizedSegment}`.trim();
      return;
    }

    if (
      previousSegment &&
      /\d+回(?:入れて|やって|予定に入れて)/.test(normalizedPreviousSegment) &&
      /^[月火水木金土日]{2,}.*(?:開始|から|にして)/.test(normalizedSegment) &&
      !detectSubject(normalizedSegment)
    ) {
      merged[merged.length - 1] = `${previousSegment} ${normalizedSegment}`.trim();
      return;
    }

    if (
      previousSegment &&
      shouldMergeComplementarySegment(previousSegment, nextSegment)
    ) {
      merged[merged.length - 1] = `${previousSegment} ${nextSegment}`.trim();
      return;
    }

    if (isContinuationSegment(nextSegment) && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${nextSegment}`.trim();
      return;
    }

    merged.push(nextSegment);
  });

  return merged;
}

export function splitAddTaskTexts(text: string): string[] {
  const normalizedText = normalizeParsingText(text).replace(/\r\n?/g, '\n').trim();

  if (!normalizedText) {
    return [];
  }

  const sharedDatePhrase =
    normalizedText.match(LEADING_SHARED_DATE_PHRASE_REGEX)?.[1] ??
    '';
  const hardSegments = mergeHardSegments(
    normalizedText
    .split(/\n+|[。；;]/)
    .map((segment) => segment.trim())
    .filter(Boolean),
  );

  const segments = hardSegments.flatMap((segment) => {
    if (
      /\d+回(?:入れて|やって|予定に入れて)/.test(normalizeParsingText(segment)) &&
      /(?:\d+回(?:目)?は|もう1回は|もう一回は|全部|連続で|[月火水木金土日]{2,})/.test(
        normalizeParsingText(segment),
      )
    ) {
      return [segment];
    }

    const softSegments = mergeSoftSegments(
      segment
      .split(/\s*(?:、|,|，|そのあと|その後|次に|あと|ただし|その代わり|代わりに|けど|けれど)\s*/g)
      .map((part) => part.trim())
      .filter(Boolean),
    );

    const taskLikeSegments = softSegments.filter(
      (part) => hasTaskCue(part) || isStandaloneRecurrenceLike(part),
    );

    if (softSegments.length <= 1 || taskLikeSegments.length < 2) {
      return [segment];
    }

    return taskLikeSegments;
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
        recurrenceRules: matchedPlan.recurrenceRules.map((rule) => ({
          ...rule,
          dates: [...rule.dates],
          weekdays: [...rule.weekdays],
        })),
      }
    : defaultDraft(userId, detectedDate);
  const detectedType = detectType(text);
  const detectedSubject = detectSubject(text);
  const detectedTimes = parseTimes(text, baseDraft.startTime);
  const detectedRepeat = detectRepeat(text);
  const normalizedLabels = normalizeRuleStudyLabels({
    rawText: text,
    subject: detectedSubject || baseDraft.subject,
    title: sanitizeSuggestedTitle(text),
    type: detectedType,
    fallbackTitle: baseDraft.title,
  });
  const cleanedTitle = buildPreferredRuleStudyTitle(
    text,
    normalizedLabels.subject,
    normalizedLabels.title,
  );
  const memoHint = extractMemoHint(text);

  const nextDraft: PlanDraft = {
    ...baseDraft,
    date: detectedDate,
    startTime: detectedTimes.startTime ?? baseDraft.startTime,
    endTime: detectedTimes.endTime ?? baseDraft.endTime,
    type: detectedType,
    subject: normalizedLabels.subject || baseDraft.subject,
    title:
      cleanedTitle ||
      baseDraft.title ||
      buildDefaultPlanTitle(detectedType, normalizedLabels.subject || baseDraft.subject),
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
