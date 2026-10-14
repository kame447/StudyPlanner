import {
  INQUIRY_ATTACHMENT_PATH, inspectInquiryImage, inquiryImageDigest,
  isInquiryAttachmentList, sameInquiryAttachments, type InquiryAttachment,
} from '../../../shared/inquiryAttachments';

export interface InquiryAttachmentEnv {
  INQUIRY_ATTACHMENTS?: R2Bucket;
  FIREBASE_WEB_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  ALLOWED_ORIGIN?: string;
}

class AttachmentError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function isInquiryAttachmentPath(path: string): boolean {
  return path === `${INQUIRY_ATTACHMENT_PATH}/capabilities` || path.startsWith(`${INQUIRY_ATTACHMENT_PATH}/`);
}

function configured(env: InquiryAttachmentEnv): boolean {
  return Boolean(env.INQUIRY_ATTACHMENTS && env.FIREBASE_WEB_API_KEY && env.FIREBASE_PROJECT_ID);
}

function headersFor(request: Request, env: InquiryAttachmentEnv): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  });
  const origin = request.headers.get('Origin');
  if (origin && (env.ALLOWED_ORIGIN ?? '').split(',').map((value) => value.trim()).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  }
  return headers;
}

function json(request: Request, env: InquiryAttachmentEnv, status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: headersFor(request, env) });
}

interface Caller { uid: string; token: string }
async function authenticate(request: Request, env: InquiryAttachmentEnv): Promise<Caller> {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) throw new AttachmentError(401, 'ログインし直してください。');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY!)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new AttachmentError(401, 'ログインし直してください。');
  const result = await response.json() as { users?: Array<{ localId?: string; disabled?: boolean; validSince?: string }> };
  const user = result.users?.[0];
  // Identity Toolkit validates the token. Its current account state additionally
  // fences disabled accounts and sessions revoked after the last sign-in.
  let claims: { sub?: string; aud?: string; iss?: string; auth_time?: number; exp?: number };
  try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { throw new AttachmentError(401, 'ログインし直してください。'); }
  const validSince = user?.validSince === undefined ? 0 : Number(user.validSince);
  if (!user?.localId || user.disabled === true || claims.sub !== user.localId
    || claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
    || !Number.isInteger(claims.auth_time) || claims.auth_time! <= 0 || !Number.isFinite(validSince)
    || claims.auth_time! < validSince || !Number.isFinite(claims.exp) || claims.exp! <= Date.now() / 1000) {
    throw new AttachmentError(401, 'ログインし直してください。');
  }
  return { uid: user.localId, token };
}

type Field = { stringValue?: string; integerValue?: string; booleanValue?: boolean; timestampValue?: string; arrayValue?: { values?: Field[] }; mapValue?: { fields?: Record<string, Field> } };
async function readDocument(env: InquiryAttachmentEnv, caller: Caller, collection: string, id: string): Promise<Record<string, Field>> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID!)}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${caller.token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) throw new AttachmentError(404, '受付または写真が見つかりません。');
  if (response.status === 401 || response.status === 403) throw new AttachmentError(403, 'この写真を操作する権限がありません。');
  if (!response.ok) throw new AttachmentError(503, '受付を確認できませんでした。再試行してください。');
  const document = await response.json() as { fields?: Record<string, Field> };
  if (!document.fields) throw new AttachmentError(404, '受付が見つかりません。');
  return document.fields;
}

async function acceptedSlot(env: InquiryAttachmentEnv, caller: Caller, id: string, slot: number, uploading: boolean): Promise<InquiryAttachment> {
  if (!uploading) {
    const admin = await readDocument(env, caller, 'admins', caller.uid);
    if (admin.enabled?.booleanValue !== true) throw new AttachmentError(403, '管理者権限が無効です。');
  }
  // Firebase ID token REST requests are governed by Firestore Rules, not IAM.
  const receipt = await readDocument(env, caller, 'support_inquiries', id);
  if (uploading && receipt.userId?.stringValue !== caller.uid) throw new AttachmentError(403, '送信者だけが写真を追加できます。');
  const attachments = receipt.attachments?.arrayValue?.values?.map((value) => {
    const fields = value.mapValue?.fields ?? {};
    return {
      sha256: fields.sha256?.stringValue, contentType: fields.contentType?.stringValue,
      byteLength: Number(fields.byteLength?.integerValue), width: Number(fields.width?.integerValue), height: Number(fields.height?.integerValue),
    };
  });
  if (receipt.schemaVersion?.integerValue !== '2' || !receipt.createdAt?.timestampValue
    || !isInquiryAttachmentList(attachments) || !attachments[slot]) throw new AttachmentError(404, 'この受付に写真の送信枠はありません。');
  return attachments[slot];
}

async function readImageBody(request: Request, expectedBytes: number): Promise<Uint8Array> {
  const announced = request.headers.get('Content-Length');
  if (announced !== null && Number(announced) !== expectedBytes) throw new AttachmentError(400, '写真のサイズが受付と一致しません。');
  if (!request.body) throw new AttachmentError(400, '写真のデータがありません。');
  const reader = request.body.getReader();
  const bytes = new Uint8Array(expectedBytes);
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (length + part.value.length > expectedBytes) throw new AttachmentError(413, '写真のサイズが上限を超えています。');
      bytes.set(part.value, length); length += part.value.length;
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (length !== expectedBytes) throw new AttachmentError(400, '写真のデータが途中で切れています。');
  return bytes;
}

export async function handleInquiryAttachmentApi(request: Request, env: InquiryAttachmentEnv): Promise<Response> {
  const headers = headersFor(request, env);
  const origin = request.headers.get('Origin');
  if (origin && !headers.has('Access-Control-Allow-Origin')) return json(request, env, 403, { error: 'この送信元は許可されていません。' });
  const path = new URL(request.url).pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (path === `${INQUIRY_ATTACHMENT_PATH}/capabilities` && request.method === 'GET') {
    return json(request, env, 200, { available: configured(env) });
  }
  const match = path.match(/^\/support-inquiries\/attachments\/([a-zA-Z0-9_-]{20,80})\/([0-2])$/);
  if (!match) return json(request, env, 404, { error: '写真が見つかりません。' });
  if (!['GET', 'PUT'].includes(request.method)) return json(request, env, 405, { error: 'この操作には対応していません。' });
  if (!configured(env)) return json(request, env, 503, { error: '写真の添付は準備中です。本文のみ送信できます。' });
  try {
    const caller = await authenticate(request, env);
    const descriptor = await acceptedSlot(env, caller, match[1], Number(match[2]), request.method === 'PUT');
    const key = `inquiries/${match[1]}/${match[2]}`;
    if (request.method === 'PUT') {
      if (request.headers.get('Content-Type') !== descriptor.contentType) throw new AttachmentError(400, '写真の形式が受付と一致しません。');
      const bytes = await readImageBody(request, descriptor.byteLength);
      let inspected: Omit<InquiryAttachment, 'sha256'>;
      try { inspected = inspectInquiryImage(bytes, descriptor.contentType); }
      catch { throw new AttachmentError(400, '写真の形式または寸法が無効です。'); }
      const actual = { ...inspected, sha256: await inquiryImageDigest(bytes) };
      if (!sameInquiryAttachments([descriptor], [actual])) throw new AttachmentError(400, '写真が受付内容と一致しません。');
      const existing = await env.INQUIRY_ATTACHMENTS!.head(key);
      if (!existing) {
        const stored = await env.INQUIRY_ATTACHMENTS!.put(key, bytes, {
          httpMetadata: { contentType: descriptor.contentType, cacheControl: 'private, no-store' },
          customMetadata: { sha256: descriptor.sha256 },
          onlyIf: { etagDoesNotMatch: '*' },
        });
        if (!stored) {
          const concurrent = await env.INQUIRY_ATTACHMENTS!.head(key);
          if (!concurrent || concurrent.customMetadata?.sha256 !== descriptor.sha256 || concurrent.size !== descriptor.byteLength) {
            throw new AttachmentError(409, '保存済みの写真を確認できませんでした。');
          }
        }
      } else if (existing.customMetadata?.sha256 !== descriptor.sha256 || existing.size !== descriptor.byteLength) {
        throw new AttachmentError(409, '保存済みの写真を確認できませんでした。');
      }
      return json(request, env, 200, { uploaded: true });
    }
    const object = await env.INQUIRY_ATTACHMENTS!.get(key);
    if (!object) throw new AttachmentError(404, '写真の送信がまだ完了していません。');
    if (object.customMetadata?.sha256 !== descriptor.sha256 || object.size !== descriptor.byteLength) throw new AttachmentError(409, '保存済みの写真を確認できませんでした。');
    headers.set('Content-Type', descriptor.contentType);
    headers.set('Content-Length', String(descriptor.byteLength));
    headers.set('Content-Disposition', `inline; filename="inquiry-photo-${Number(match[2]) + 1}.${descriptor.contentType === 'image/png' ? 'png' : 'jpg'}"`);
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    return json(request, env, error instanceof AttachmentError ? error.status : 503, {
      error: error instanceof AttachmentError ? error.message : '写真を送受信できませんでした。接続を確認して再試行してください。',
    });
  }
}
