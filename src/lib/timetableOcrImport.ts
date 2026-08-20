import { getCloudflareAiProxyUrl } from './aiConfig';
import {
  createAiImageFilePayload,
  getAiImageMimeType,
  type AiImageFilePayload,
} from './aiImageAttachment';
import { getFirebaseAuth } from './firebaseClient';
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

export type TimetableOcrFilePayload = AiImageFilePayload;

interface TimetableOcrWorkerResponse {
  result?: unknown;
  error?: string;
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

function buildTimetableOcrEndpoint(proxyUrl: string): string {
  const baseUrl = proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/timetable-ocr$/, '');

  return `${baseUrl}/timetable-ocr`;
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

function compactMemo(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ');
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
      const memo = compactMemo(normalizeText(item.memo), normalizeText(item.note));
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

export async function createTimetableOcrFilePayload(
  file: File,
): Promise<TimetableOcrFilePayload> {
  if (!getAiImageMimeType(file)) {
    throw new Error('画像読み取りは png / jpg / jpeg のみ対応しています。PDFは後で対応予定です。');
  }

  return createAiImageFilePayload(file);
}

export async function requestTimetableOcr(
  payload: TimetableOcrFilePayload,
): Promise<TimetableOcrResult> {
  const proxyUrl = getCloudflareAiProxyUrl();

  if (!proxyUrl) {
    throw new Error('AI proxy URL が設定されていません。');
  }

  const firebaseAuth = getFirebaseAuth();

  if (!firebaseAuth?.currentUser) {
    throw new Error('ログイン済みユーザーの Firebase セッションが見つかりません。');
  }

  const idToken = await firebaseAuth.currentUser.getIdToken();
  const endpoint = buildTimetableOcrEndpoint(proxyUrl);

  console.info('[Timetable OCR] request endpoint', endpoint);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      mimeType: payload.mimeType,
      base64: payload.base64,
    }),
  });
  const result = (await response.json()) as TimetableOcrWorkerResponse;

  if (!response.ok || !result.result) {
    throw new Error(
      result.error || '読み取りに失敗しました。画像を明るく撮り直してください。',
    );
  }

  return normalizeTimetableOcrResult(result.result);
}

export function buildMockTimetableOcrResult(
  _payload: TimetableOcrFilePayload,
): TimetableOcrResult {
  return {
    periods: [
      { periodNumber: 1, startTime: '09:10', endTime: '10:40' },
      { periodNumber: 2, startTime: '11:00', endTime: '12:30' },
      { periodNumber: 3, startTime: '13:40', endTime: '15:10' },
      { periodNumber: 4, startTime: '15:30', endTime: '17:00' },
      { periodNumber: 5, startTime: '17:20', endTime: '18:50' },
      { periodNumber: 6, startTime: '19:10', endTime: '20:40' },
    ],
    items: [
      { weekday: 'mon', periodNumber: 1, startTime: '09:10', endTime: '10:40', title: '数学②（理系）', subject: '数学', classroom: '402', memo: '＊' },
      { weekday: 'tue', periodNumber: 1, startTime: '09:10', endTime: '10:40', title: '数学①（理系）', subject: '数学', classroom: '402', memo: '＊' },
      { weekday: 'wed', periodNumber: 1, startTime: '09:10', endTime: '10:40', title: '完全習得英語Ⅰ', subject: '英語', classroom: '306', memo: '＊' },
      { weekday: 'thu', periodNumber: 1, startTime: '09:10', endTime: '10:40', title: '英文和訳演習V', subject: '英語', classroom: '402', memo: '＊' },
      { weekday: 'fri', periodNumber: 1, startTime: '09:10', endTime: '10:40', title: '理系数学演習V', subject: '数学', classroom: '402', memo: '＊' },
      { weekday: 'tue', periodNumber: 2, startTime: '11:00', endTime: '12:30', title: '完全習得数理系', subject: '数学', classroom: '403', memo: '＊' },
      { weekday: 'wed', periodNumber: 2, startTime: '11:00', endTime: '12:30', title: '英語①文法', subject: '英語', classroom: '402', memo: '＊' },
      { weekday: 'thu', periodNumber: 2, startTime: '11:00', endTime: '12:30', title: '完全習得物理', subject: '物理', classroom: '402', memo: '＊' },
      { weekday: 'fri', periodNumber: 2, startTime: '11:00', endTime: '12:30', title: '古文（理系）', subject: '古文', classroom: '402', memo: '' },
      { weekday: 'mon', periodNumber: 3, startTime: '13:40', endTime: '15:10', title: '化学①', subject: '化学', classroom: '502', memo: '' },
      { weekday: 'tue', periodNumber: 3, startTime: '13:40', endTime: '15:10', title: '現代文（理系）', subject: '現代文', classroom: '402', memo: '' },
      { weekday: 'wed', periodNumber: 3, startTime: '13:40', endTime: '15:10', title: '地総地探（共テ）', subject: '地理', classroom: '402', memo: '' },
      { weekday: 'thu', periodNumber: 3, startTime: '13:40', endTime: '15:10', title: '物理①', subject: '物理', classroom: '402', memo: '＊' },
      { weekday: 'fri', periodNumber: 3, startTime: '13:40', endTime: '15:10', title: '英語②表現', subject: '英語', classroom: '402', memo: '＊' },
      { weekday: 'mon', periodNumber: 4, startTime: '15:30', endTime: '17:00', title: '化学②', subject: '化学', classroom: '502', memo: '' },
      { weekday: 'tue', periodNumber: 4, startTime: '15:30', endTime: '17:00', title: '英語③長文', subject: '英語', classroom: '402', memo: '＊' },
      { weekday: 'wed', periodNumber: 4, startTime: '15:30', endTime: '17:00', title: '情報Ⅰ（共テ）', subject: '情報', classroom: '402', memo: 'V' },
      { weekday: 'thu', periodNumber: 4, startTime: '15:30', endTime: '17:00', title: '物理②', subject: '物理', classroom: '402', memo: '＊' },
      { weekday: 'fri', periodNumber: 4, startTime: '15:30', endTime: '17:00', title: '数学③（理系）', subject: '数学', classroom: '402', memo: '＊' },
      { weekday: 'tue', periodNumber: 5, startTime: '17:20', endTime: '18:50', title: '完全習得化学', subject: '化学', classroom: '302', memo: '' },
      { weekday: 'wed', periodNumber: 5, startTime: '17:20', endTime: '18:50', title: '漢文総合V', subject: '漢文', classroom: '307', memo: '' },
    ],
  };
}
