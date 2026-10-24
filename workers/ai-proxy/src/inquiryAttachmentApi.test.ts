import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import traceWorker from './traceWorker';
import { handleInquiryAttachmentApi, type InquiryAttachmentEnv } from './inquiryAttachmentApi';
import { inspectInquiryImage, inquiryImageDigest } from '../../../shared/inquiryAttachments';
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const receipt = '12345678-1234-1234-1234-123456789abc';
const origin = 'https://laplance.example';
const now = Math.floor(Date.now() / 1000);
const baseClaims = { sub: 'owner', aud: 'project', iss: 'https://securetoken.google.com/project', auth_time: now - 100, exp: now + 3600 };
const token = (patch = {}) => `header.${btoa(JSON.stringify({ ...baseClaims, ...patch }))}.signature`;
let fields: Record<string, unknown>;
let descriptor: Awaited<ReturnType<typeof inspectInquiryImage>> & { sha256: string };
let env: InquiryAttachmentEnv;
let head: ReturnType<typeof vi.fn>;
let put: ReturnType<typeof vi.fn>;
let get: ReturnType<typeof vi.fn>;
let account: { localId: string; disabled?: boolean; validSince?: string };
let adminEnabled: boolean;
let databaseStatus: number;
function request(method = 'PUT', data: Uint8Array = png, options: { token?: string | null; path?: string; headers?: Record<string, string> } = {}) {
  return new Request(`https://worker.example/support-inquiries/attachments/${options.path ?? `${receipt}/0`}`, {
    method, headers: { Origin: origin, ...(options.token === null ? {} : { Authorization: `Bearer ${options.token ?? token()}` }), 'Content-Type': 'image/png', ...options.headers },
    ...(method === 'PUT' ? { body: data.slice() } : {}),
  });
}
beforeEach(async () => {
  descriptor = { ...inspectInquiryImage(png, 'image/png'), sha256: await inquiryImageDigest(png) };
  fields = { schemaVersion: { integerValue: '2' }, userId: { stringValue: 'owner' }, createdAt: { timestampValue: '2026-10-13T00:00:00Z' }, attachments: { arrayValue: { values: [{ mapValue: { fields: {
    sha256: { stringValue: descriptor.sha256 }, contentType: { stringValue: 'image/png' }, byteLength: { integerValue: String(png.length) }, width: { integerValue: '1' }, height: { integerValue: '1' },
  } } }] } } };
  head = vi.fn(async () => null); put = vi.fn(async () => ({ size: png.length })); get = vi.fn(async () => ({ size: png.length, customMetadata: { sha256: descriptor.sha256 }, body: png.slice() }));
  env = { INQUIRY_ATTACHMENTS: { head, put, get } as unknown as R2Bucket, FIREBASE_PROJECT_ID: 'project', FIREBASE_WEB_API_KEY: 'public-key', ALLOWED_ORIGIN: origin };
  account = { localId: 'owner', validSince: '1' }; adminEnabled = true; databaseStatus = 200;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.startsWith('https://identitytoolkit.googleapis.com/')) return Response.json({ users: [account] });
    if (input.includes('/documents/admins/')) return Response.json({ fields: { enabled: { booleanValue: adminEnabled } } });
    if (input.includes('/documents/support_inquiries/')) return Response.json({ fields }, { status: databaseStatus });
    throw new Error('Unexpected outbound call');
  }));
});
afterEach(() => vi.unstubAllGlobals());
describe('private inquiry image boundary', () => {
  it('advertises disabled configuration without authenticating or touching storage', async () => {
    const result = await handleInquiryAttachmentApi(request('GET', png, { path: 'capabilities' }), {});
    // Configured allowed origins are still required for cross-origin capability reads.
    expect(result.status).toBe(403);
    const allowed = await handleInquiryAttachmentApi(request('GET', png, { path: 'capabilities' }), { ALLOWED_ORIGIN: origin });
    expect(await allowed.json()).toEqual({ available: false }); expect(fetch).not.toHaveBeenCalled();
  });
  it('routes photo requests before AI providers, quotas and observation', async () => {
    const quota = vi.fn();
    const result = await traceWorker.fetch(request(), { ...env, AI_QUOTA: { getByName: quota } });
    expect(result.status).toBe(200); expect(quota).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('identitytoolkit.googleapis.com'), expect.stringContaining('firestore.googleapis.com'),
    ]);
  });
  it('authenticates, checks immutable receipt ownership, and stores full-resolution bytes privately', async () => {
    const result = await handleInquiryAttachmentApi(request(), env);
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ uploaded: true });
    expect(put).toHaveBeenCalledWith(`inquiries/${receipt}/0`, png, expect.objectContaining({ onlyIf: { etagDoesNotMatch: '*' }, customMetadata: { sha256: descriptor.sha256 }, httpMetadata: { contentType: 'image/png', cacheControl: 'private, no-store' } }));
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls[1][1]).toEqual(expect.objectContaining({ headers: { Authorization: `Bearer ${token()}` }, redirect: 'error' }));
  });
  it('uses the same fixed slot on replay without overwriting bytes', async () => {
    head.mockResolvedValue({ size: png.length, customMetadata: { sha256: descriptor.sha256 } });
    expect((await handleInquiryAttachmentApi(request(), env)).status).toBe(200); expect(put).not.toHaveBeenCalled();
  });
  it('verifies the winning immutable object after a conditional-write race', async () => {
    put.mockResolvedValue(null); head.mockResolvedValueOnce(null).mockResolvedValueOnce({ size: png.length, customMetadata: { sha256: descriptor.sha256 } });
    expect((await handleInquiryAttachmentApi(request(), env)).status).toBe(200); expect(head).toHaveBeenCalledTimes(2);
    head.mockResolvedValue(null);
    expect((await handleInquiryAttachmentApi(request(), env)).status).toBe(409);
  });
  it.each([null, token({ aud: 'other' }), token({ iss: 'https://evil.example' }), token({ exp: 1 }), token({ auth_time: 0 }), 'malformed'])('rejects invalid or absent credentials', async (auth) => {
    expect((await handleInquiryAttachmentApi(request('PUT', png, { token: auth }), env)).status).toBe(401); expect(put).not.toHaveBeenCalled();
  });
  it('rejects disabled and revoked accounts before reading a receipt', async () => {
    account.disabled = true; expect((await handleInquiryAttachmentApi(request(), env)).status).toBe(401);
    account.disabled = false; account.validSince = String(now); expect((await handleInquiryAttachmentApi(request(), env)).status).toBe(401);
    expect(head).not.toHaveBeenCalled();
  });
  it('rejects another receipt owner and legacy receipts without fixed slots', async () => {
    fields.userId = { stringValue: 'other' }; expect((await handleInquiryAttachmentApi(request(), env)).status).toBe(403);
    fields.userId = { stringValue: 'owner' }; fields.schemaVersion = { integerValue: '1' };
    expect((await handleInquiryAttachmentApi(request(), env)).status).toBe(404); expect(put).not.toHaveBeenCalled();
  });
  it('requires a live enabled admin for every image read, even for its original owner', async () => {
    adminEnabled = false; expect((await handleInquiryAttachmentApi(request('GET'), env)).status).toBe(403); expect(get).not.toHaveBeenCalled();
    adminEnabled = true; const result = await handleInquiryAttachmentApi(request('GET'), env);
    expect(result.status).toBe(200); expect(new Uint8Array(await result.arrayBuffer())).toEqual(png);
    expect(result.headers.get('Content-Type')).toBe('image/png'); expect(result.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('distinguishes accepted-but-not-uploaded images from nonexistent receipts', async () => {
    get.mockResolvedValue(null); const missing = await handleInquiryAttachmentApi(request('GET'), env);
    expect(missing.status).toBe(404); expect(await missing.text()).toContain('送信がまだ完了');
    databaseStatus = 404; expect((await handleInquiryAttachmentApi(request(), env)).status).toBe(404);
  });
  it('rejects MIME spoofing, excess bytes, changed hashes and changed dimensions without writing', async () => {
    expect((await handleInquiryAttachmentApi(request('PUT', png, { headers: { 'Content-Type': 'image/svg+xml' } }), env)).status).toBe(400);
    expect((await handleInquiryAttachmentApi(request('PUT', new Uint8Array(png.length + 1)), env)).status).toBe(413);
    const changed = png.slice(); changed[changed.length - 1] ^= 1;
    expect((await handleInquiryAttachmentApi(request('PUT', changed), env)).status).toBe(400);
    const dimensions = png.slice(); new DataView(dimensions.buffer).setUint32(16, 9000);
    expect((await handleInquiryAttachmentApi(request('PUT', dimensions), env)).status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });
  it('rejects disallowed origins, arbitrary IDs/URLs and unreserved slots', async () => {
    expect((await handleInquiryAttachmentApi(request('PUT', png, { headers: { Origin: 'https://evil.example' } }), env)).status).toBe(403);
    expect((await handleInquiryAttachmentApi(request('PUT', png, { path: 'https://evil.example/0' }), env)).status).toBe(404);
    expect((await handleInquiryAttachmentApi(request('PUT', png, { path: `${receipt}/3` }), env)).status).toBe(404);
    expect((await handleInquiryAttachmentApi(request('PUT', png, { path: `${receipt}/1` }), env)).status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });
});
