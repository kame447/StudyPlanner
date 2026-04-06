import {
  addDays,
  minutesFromTime,
  timeFromMinutes,
} from '../lib/date';
import { buildDefaultPlanTitle } from '../lib/plans';
import type {
  NaturalLanguageMode,
  NaturalLanguageSuggestion,
  Plan,
  PlanDraft,
  PlanType,
} from '../types/domain';

interface SuggestionInput {
  mode: NaturalLanguageMode;
  text: string;
  selectedDate: string;
  plans: Plan[];
  userId: string;
}

const SUBJECT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /数学|算数/, label: '数学' },
  { pattern: /英語/, label: '英語' },
  { pattern: /国語|現代文|古文|漢文/, label: '国語' },
  { pattern: /理科|物理/, label: '物理' },
  { pattern: /化学/, label: '化学' },
  { pattern: /生物/, label: '生物' },
  { pattern: /日本史|世界史|歴史/, label: '歴史' },
  { pattern: /地理/, label: '地理' },
  { pattern: /情報|プログラミング/, label: '情報' },
];

function defaultDraft(userId: string, date: string): PlanDraft {
  return {
    userId,
    title: '',
    subject: '',
    date,
    startTime: '19:00',
    endTime: '20:00',
    type: 'study',
    memo: '',
  };
}

function detectType(text: string): PlanType {
  if (/模試|試験|テスト/.test(text)) {
    return 'mock-exam';
  }

  if (/学校|行事|面談|授業/.test(text)) {
    return 'school-event';
  }

  if (/塾|講習/.test(text)) {
    return 'cram-school';
  }

  if (/締切|提出/.test(text)) {
    return 'deadline';
  }

  if (/予定|勉強|学習/.test(text)) {
    return 'study';
  }

  return 'study';
}

function detectSubject(text: string): string {
  const matched = SUBJECT_PATTERNS.find((item) => item.pattern.test(text));
  return matched?.label ?? '';
}

function parseDate(text: string, selectedDate: string): string {
  if (/明後日/.test(text)) {
    return addDays(selectedDate, 2);
  }

  if (/明日/.test(text)) {
    return addDays(selectedDate, 1);
  }

  if (/今日/.test(text)) {
    return selectedDate;
  }

  const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
  const monthMatch = text.match(/(\d{1,2})月(\d{1,2})日/);
  const parts = slashMatch ?? monthMatch;

  if (parts) {
    const currentYear = Number(selectedDate.slice(0, 4));
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${currentYear}-${month}-${day}`;
  }

  return selectedDate;
}

function normalizeTime(hoursText: string, minutesText?: string, hasHalf?: boolean): string {
  const hours = Number(hoursText);
  const minutes = hasHalf ? 30 : Number(minutesText ?? '0');
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function parseTimes(text: string): { startTime?: string; endTime?: string } {
  const rangeMatch = text.match(
    /(\d{1,2})(?::(\d{2}))?時?(半)?\s*(?:-|〜|~|から)\s*(\d{1,2})(?::(\d{2}))?時?(半)?/,
  );

  if (rangeMatch) {
    return {
      startTime: normalizeTime(rangeMatch[1], rangeMatch[2], Boolean(rangeMatch[3])),
      endTime: normalizeTime(rangeMatch[4], rangeMatch[5], Boolean(rangeMatch[6])),
    };
  }

  const singleMatch = text.match(/(\d{1,2})(?::(\d{2}))?時?(半)?/);
  const durationHourMatch = text.match(/(\d+(?:\.\d+)?)時間/);
  const durationMinuteMatch = text.match(/(\d+)分/);

  if (!singleMatch) {
    return {};
  }

  const startTime = normalizeTime(
    singleMatch[1],
    singleMatch[2],
    Boolean(singleMatch[3]),
  );

  let durationMinutes = 60;

  if (durationHourMatch) {
    durationMinutes = Math.round(Number(durationHourMatch[1]) * 60);
  } else if (durationMinuteMatch) {
    durationMinutes = Number(durationMinuteMatch[1]);
  }

  const endTime = timeFromMinutes(minutesFromTime(startTime) + durationMinutes);
  return { startTime, endTime };
}

function stripKeywords(text: string): string {
  return text
    .replace(/明後日|明日|今日/g, '')
    .replace(/\d{1,2}\/\d{1,2}/g, '')
    .replace(/\d{1,2}月\d{1,2}日/g, '')
    .replace(
      /(\d{1,2})(?::\d{2})?時?(半)?\s*(?:-|〜|~|から)\s*(\d{1,2})(?::\d{2})?時?(半)?/g,
      '',
    )
    .replace(/(\d{1,2})(?::\d{2})?時?(半)?/g, '')
    .replace(/\d+(?:\.\d+)?時間|\d+分/g, '')
    .replace(/追加|入れて|登録|変更|修正|ずらして|にして|予定/g, '')
    .replace(/[「」"'、。,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchPlan(text: string, plans: Plan[]): Plan | undefined {
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

function buildReason(mode: NaturalLanguageMode, matchedPlan?: Plan): string {
  if (mode === 'edit' && matchedPlan) {
    return `既存予定「${matchedPlan.title}」を基準に、文中の日付と時刻を反映した叩き台です。`;
  }

  if (mode === 'edit') {
    return '変更対象は未確定です。候補の予定を選んでから反映してください。';
  }

  return '日付・時刻・予定種別を自然言語から推定した追加案です。';
}

export function generateNaturalLanguageSuggestion({
  mode,
  text,
  selectedDate,
  plans,
  userId,
}: SuggestionInput): NaturalLanguageSuggestion {
  const matchedPlan = mode === 'edit' ? matchPlan(text, plans) : undefined;
  const detectedDate = parseDate(text, selectedDate);
  const detectedType = detectType(text);
  const detectedSubject = detectSubject(text);
  const detectedTimes = parseTimes(text);
  const cleanedTitle = stripKeywords(text);
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
      }
    : defaultDraft(userId, detectedDate);

  const nextDraft: PlanDraft = {
    ...baseDraft,
    date: detectedDate,
    startTime: detectedTimes.startTime ?? baseDraft.startTime,
    endTime: detectedTimes.endTime ?? baseDraft.endTime,
    type: detectedType ?? baseDraft.type,
    subject: detectedSubject || baseDraft.subject,
    title:
      cleanedTitle ||
      baseDraft.title ||
      buildDefaultPlanTitle(detectedType, detectedSubject || baseDraft.subject),
    memo: baseDraft.memo,
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
    matchedPlanId: matchedPlan?.id,
    parsedPlan: nextDraft,
  };
}
