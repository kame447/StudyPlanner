import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { searchMaterialMetadata } from './materialMetadataService';
import { requestTimetableOcr } from '../lib/timetableOcrImport';
import { extractMaterialContentsPhoto } from '../lib/materialContentsPhoto';
import { readInquiryAttachment } from './inquiryAttachmentService';
import { UserFacingError } from '../lib/userFacingError';
const mocks = vi.hoisted(() => ({ token: vi.fn(), user: null as null | { getIdToken: () => Promise<string> } }));
vi.mock('../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({ currentUser: mocks.user }) }));
vi.mock('../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: () => 'https://worker.example/chat' }));
vi.mock('./builtInMaterialCatalog', () => ({ searchBuiltInMaterialCatalog: () => [] }));
vi.mock('../lib/aiImageAttachment', () => ({ createAiImageFilePayload: async () => ({ mimeType: 'image/png', base64: 'fixture' }), getAiImageMimeType: () => 'image/png' }));
beforeEach(() => { mocks.token.mockReset().mockResolvedValue('fixture-token'); mocks.user = { getIdToken: mocks.token }; });
afterEach(() => vi.unstubAllGlobals());
const calls = [
  ['metadata', () => searchMaterialMetadata('unknown title')],
  ['timetable', () => requestTimetableOcr({ mimeType: 'image/png', base64: 'fixture' } as never)],
  ['contents', () => extractMaterialContentsPhoto(new File(['x'], 'photo.png'), new AbortController().signal)],
  ['inquiry photo', () => readInquiryAttachment('12345678-1234-1234-1234-123456789abc', 0, { contentType: 'image/png', byteLength: 1 } as never)],
] as const;
for (const [name, request] of calls) {
  it.each(['token', 'network', 'body', 'http'])(`${name} maps %s failures without exposing provider text`, async failure => {
    const raw = 'Firebase private-project / upstream token=secret';
    if (failure === 'token') mocks.token.mockRejectedValueOnce(new Error(raw));
    const fetcher = vi.fn(async () => {
      if (failure === 'network') throw new Error(raw);
      if (failure === 'http') return Response.json({ error: raw }, { status: 503 });
      const response = new Response('fixture', { headers: { 'Content-Type': 'image/png' } });
      vi.spyOn(response, 'json').mockRejectedValue(new Error(raw));
      vi.spyOn(response, 'blob').mockRejectedValue(new Error(raw));
      return response;
    });
    vi.stubGlobal('fetch', fetcher);
    const error = await request().then(() => null, value => value);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).not.toContain(raw);
    expect(error.message).toMatch(/手入力|写真/);
    expect(mocks.token).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(failure === 'token' ? 0 : 1);
  });
}
it.each(['timetable', 'contents'] as const)('preserves %s quota guidance instead of provider prose', async name => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'raw provider message' }, { status: 429 })));
  const call = calls.find(([key]) => key === name)!;
  await expect(call[1]()).rejects.toThrow('利用上限');
});

it('rejects a null metadata body at the response boundary', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(null)));
  await expect(searchMaterialMetadata('unknown title')).rejects.toBeInstanceOf(UserFacingError);
});
