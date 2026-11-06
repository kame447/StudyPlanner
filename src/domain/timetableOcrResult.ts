import type { RecurrenceWeekday } from '../types/domain';

export interface TimetableOcrPeriodCandidate {
  periodNumber: number;
  startTime: string | null;
  endTime: string | null;
}

export interface TimetableOcrItemCandidate {
  weekday: RecurrenceWeekday | '';
  periodNumber: number | null;
  startTime: string | null;
  endTime: string | null;
  title: string;
  subject: string;
  classroom: string;
  memo: string;
}

export interface TimetableOcrResult {
  periods: TimetableOcrPeriodCandidate[];
  items: TimetableOcrItemCandidate[];
}

const VALID_WEEKDAYS = new Set<RecurrenceWeekday>([
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]);

const WEEKDAY_ALIASES: Record<string, RecurrenceWeekday> = {
  月: 'mon',
  月曜: 'mon',
  月曜日: 'mon',
  mon: 'mon',
  monday: 'mon',
  火: 'tue',
  火曜: 'tue',
  火曜日: 'tue',
  tue: 'tue',
  tuesday: 'tue',
  水: 'wed',
  水曜: 'wed',
  水曜日: 'wed',
  wed: 'wed',
  wednesday: 'wed',
  木: 'thu',
  木曜: 'thu',
  木曜日: 'thu',
  thu: 'thu',
  thursday: 'thu',
  金: 'fri',
  金曜: 'fri',
  金曜日: 'fri',
  fri: 'fri',
  friday: 'fri',
  土: 'sat',
  土曜: 'sat',
  土曜日: 'sat',
  sat: 'sat',
  saturday: 'sat',
  日: 'sun',
  日曜: 'sun',
  日曜日: 'sun',
  sun: 'sun',
  sunday: 'sun',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTime(value: unknown): string | null {
  const text = normalizeText(value);

  return /^\d{2}:\d{2}$/.test(text) ? text : null;
}

function normalizeWeekday(value: unknown): RecurrenceWeekday | '' {
  const text = normalizeText(value).toLowerCase();

  if (VALID_WEEKDAYS.has(text as RecurrenceWeekday)) {
    return text as RecurrenceWeekday;
  }

  return WEEKDAY_ALIASES[normalizeText(value)] ?? '';
}

function normalizePeriodNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : Number(normalizeText(value));

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  const rounded = Math.round(numberValue);

  return rounded >= 1 && rounded <= 12 ? rounded : null;
}

export function inferSubjectFromTitle(title: string): string {
  const normalized = title.trim();
  const match = normalized.match(/^(数学|英語|化学|物理|生物|地学|地理|歴史|日本史|世界史|現代文|古文|漢文|国語|情報)/);

  return match?.[1] ?? '';
}

export function isClassroomOnlyTitle(title: string): boolean {
  const normalized = title.trim();

  return /^[0-9０-９A-Za-zＡ-Ｚａ-ｚ-]+$/.test(normalized);
}

export function normalizeTimetableOcrResult(value: unknown): TimetableOcrResult {
  if (!isRecord(value)) {
    return { periods: [], items: [] };
  }

  const rawPeriods = Array.isArray(value.periods) ? value.periods : [];
  const periods = rawPeriods
    .map((period): TimetableOcrPeriodCandidate | null => {
      if (!isRecord(period)) {
        return null;
      }

      const periodNumber = normalizePeriodNumber(period.periodNumber);

      if (!periodNumber) {
        return null;
      }

      return {
        periodNumber,
        startTime: normalizeTime(period.startTime),
        endTime: normalizeTime(period.endTime),
      };
    })
    .filter((period): period is TimetableOcrPeriodCandidate => Boolean(period));
  const periodByNumber = new Map(periods.map((period) => [period.periodNumber, period]));
  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items = rawItems
    .map((item): TimetableOcrItemCandidate | null => {
      if (!isRecord(item)) {
        return null;
      }

      const periodNumber = normalizePeriodNumber(item.periodNumber);
      const title = normalizeText(item.title);
      const memo = [normalizeText(item.memo), normalizeText(item.note)]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' / ');
      const period = periodNumber ? periodByNumber.get(periodNumber) : undefined;

      return {
        weekday: normalizeWeekday(item.weekday),
        periodNumber,
        startTime: normalizeTime(item.startTime) ?? period?.startTime ?? null,
        endTime: normalizeTime(item.endTime) ?? period?.endTime ?? null,
        title,
        subject: normalizeText(item.subject) || inferSubjectFromTitle(title),
        classroom: normalizeText(item.classroom),
        memo,
      };
    })
    .filter((item): item is TimetableOcrItemCandidate => Boolean(item));

  return { periods, items };
}
