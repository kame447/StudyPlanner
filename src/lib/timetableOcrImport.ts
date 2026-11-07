import { UserFacingError } from './userFacingError';
import { getCloudflareAiProxyUrl } from './aiConfig';
import {
  createAiImageFilePayload,
  getAiImageMimeType,
  type AiImageFilePayload,
} from './aiImageAttachment';
import { getFirebaseAuth } from './firebaseClient';
import {
  normalizeTimetableOcrResult,
  type TimetableOcrResult,
} from '../domain/timetableOcrResult';

export {
  inferSubjectFromTitle,
  isClassroomOnlyTitle,
  normalizeTimetableOcrResult,
} from '../domain/timetableOcrResult';
export type {
  TimetableOcrPeriodCandidate,
  TimetableOcrItemCandidate,
  TimetableOcrResult,
} from '../domain/timetableOcrResult';

export type TimetableOcrFilePayload = AiImageFilePayload;

interface TimetableOcrWorkerResponse {
  result?: unknown;
  error?: string;
}

function buildTimetableOcrEndpoint(proxyUrl: string): string {
  const baseUrl = proxyUrl
    .replace(/\/$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/timetable-ocr$/, '');

  return `${baseUrl}/timetable-ocr`;
}

export async function createTimetableOcrFilePayload(
  file: File,
): Promise<TimetableOcrFilePayload> {
  if (!getAiImageMimeType(file)) {
    throw new UserFacingError('画像読み取りは png / jpg / jpeg のみ対応しています。PDFは後で対応予定です。');
  }

  return createAiImageFilePayload(file);
}

export async function requestTimetableOcr(
  payload: TimetableOcrFilePayload,
): Promise<TimetableOcrResult> {
  const proxyUrl = getCloudflareAiProxyUrl();

  if (!proxyUrl) {
    throw new UserFacingError('画像読み取りを現在利用できません。時間割を手入力してください。');
  }

  const firebaseAuth = getFirebaseAuth();

  if (!firebaseAuth?.currentUser) {
    throw new UserFacingError('画像読み取りにはログインが必要です。ログインし直してください。');
  }

  try {
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
      throw new UserFacingError(
        response.status === 429 ? '画像読み取りの利用上限です。時間をおいてお試しください。' : '読み取りに失敗しました。画像を明るく撮り直すか、手入力してください。',
      );
    }

    return normalizeTimetableOcrResult(result.result);
  } catch (error) {
    throw error instanceof UserFacingError ? error : new UserFacingError('画像を読み取れませんでした。通信を確認するか、手入力してください。');
  }
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
