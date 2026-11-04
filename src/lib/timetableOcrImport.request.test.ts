import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as publicApi from './timetableOcrImport';
import type { TimetableOcrFilePayload, TimetableOcrItemCandidate, TimetableOcrPeriodCandidate, TimetableOcrResult } from './timetableOcrImport';

const mocks = vi.hoisted(() => ({
  proxyUrl: 'https://worker.example/chat/completions',
  token: vi.fn(),
  user: null as null | { getIdToken: () => Promise<string> },
}));
vi.mock('./firebaseClient', () => ({ getFirebaseAuth: () => ({ currentUser: mocks.user }) }));
vi.mock('./aiConfig', () => ({ getCloudflareAiProxyUrl: () => mocks.proxyUrl }));
beforeEach(() => {
  mocks.proxyUrl = 'https://worker.example/chat/completions';
  mocks.token.mockReset().mockResolvedValue('fixture-token');
  mocks.user = { getIdToken: mocks.token };
});
afterEach(() => vi.unstubAllGlobals());

const payload: TimetableOcrFilePayload = { mimeType: 'image/png', base64: 'fixture', fileName: 'timetable.png' };

it('preserves the original public function exports and candidate type imports', () => {
  expect(Object.keys(publicApi).sort()).toEqual([
    'buildMockTimetableOcrResult', 'createTimetableOcrFilePayload', 'inferSubjectFromTitle',
    'isClassroomOnlyTitle', 'normalizeTimetableOcrResult', 'requestTimetableOcr',
  ]);
  const period: TimetableOcrPeriodCandidate = { periodNumber: 1, startTime: null, endTime: null };
  const item: TimetableOcrItemCandidate = { weekday: '', periodNumber: null, startTime: null, endTime: null, title: '', subject: '', classroom: '', memo: '' };
  const result: TimetableOcrResult = { periods: [period], items: [item] };
  expect(publicApi.normalizeTimetableOcrResult(result)).toEqual(result);
});

it.each([
  'https://worker.example', 'https://worker.example/',
  'https://worker.example/chat/completions', 'https://worker.example/timetable-ocr/',
])('authenticates once and normalizes the result from %s', async proxyUrl => {
  mocks.proxyUrl = proxyUrl;
  const fetcher = vi.fn(async () => Response.json({ result: {
    periods: [{ periodNumber: '1', startTime: '09:00', endTime: '10:00' }],
    items: [{ weekday: '月曜', periodNumber: 1, title: ' 数学Ⅰ ', memo: ' memo ', note: ' note ' }],
  } }));
  vi.stubGlobal('fetch', fetcher);
  const result = await publicApi.requestTimetableOcr(payload);
  expect(mocks.token).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://worker.example/timetable-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-token' },
    body: JSON.stringify({ mimeType: 'image/png', base64: 'fixture' }),
  });
  expect(result.items).toEqual([{
    weekday: 'mon', periodNumber: 1, startTime: '09:00', endTime: '10:00',
    title: '数学Ⅰ', subject: '数学', classroom: '', memo: 'memo / note',
  }]);
});

it.each(['configuration', 'login'] as const)('does not request a token or send HTTP without %s', async missing => {
  if (missing === 'configuration') mocks.proxyUrl = '';
  else mocks.user = null;
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(publicApi.requestTimetableOcr(payload)).rejects.toThrow(
    missing === 'configuration' ? '時間割を手入力' : 'ログインし直してください',
  );
  expect(mocks.token).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
