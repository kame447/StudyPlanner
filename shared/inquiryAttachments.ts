export const INQUIRY_ATTACHMENT_LIMIT = 3;
export const INQUIRY_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const INQUIRY_ATTACHMENT_MAX_DIMENSION = 8192;
export const INQUIRY_ATTACHMENT_MAX_PIXELS = 24_000_000;
export const INQUIRY_ATTACHMENT_PATH = '/support-inquiries/attachments';

export interface InquiryAttachment {
  sha256: string;
  contentType: 'image/jpeg' | 'image/png';
  byteLength: number;
  width: number;
  height: number;
}

function validDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0
    && width <= INQUIRY_ATTACHMENT_MAX_DIMENSION && height <= INQUIRY_ATTACHMENT_MAX_DIMENSION
    && width * height <= INQUIRY_ATTACHMENT_MAX_PIXELS;
}

export function isInquiryAttachment(value: unknown): value is InquiryAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as InquiryAttachment;
  return Object.keys(item).sort().join(',') === 'byteLength,contentType,height,sha256,width'
    && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)
    && (item.contentType === 'image/jpeg' || item.contentType === 'image/png')
    && Number.isInteger(item.byteLength) && item.byteLength > 0 && item.byteLength <= INQUIRY_ATTACHMENT_MAX_BYTES
    && validDimensions(item.width, item.height);
}

export function isInquiryAttachmentList(value: unknown): value is InquiryAttachment[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= INQUIRY_ATTACHMENT_LIMIT
    && value.every(isInquiryAttachment);
}

export function sameInquiryAttachments(left: InquiryAttachment[] = [], right: InquiryAttachment[] = []): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.sha256 === other.sha256 && item.contentType === other.contentType
      && item.byteLength === other.byteLength && item.width === other.width && item.height === other.height;
  });
}

/** Structural/header validation only, not a full pixel decode or malware scan. */
export function inspectInquiryImage(bytes: Uint8Array, declaredType: string): Omit<InquiryAttachment, 'sha256'> {
  if (!bytes.length || bytes.length > INQUIRY_ATTACHMENT_MAX_BYTES) throw new Error('写真は1枚5MB以内にしてください。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  if (declaredType === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) throw new Error('PNGの形式を確認できませんでした。');
    let position = 8;
    let hasData = false;
    let ended = false;
    while (position + 12 <= bytes.length) {
      const length = view.getUint32(position);
      const end = position + 12 + length;
      if (end > bytes.length) throw new Error('PNGのデータが途中で切れています。');
      const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
      if (position === 8) {
        if (type !== 'IHDR' || length !== 13) throw new Error('PNGのヘッダーが無効です。');
        width = view.getUint32(position + 8);
        height = view.getUint32(position + 12);
        const depth = bytes[position + 16];
        const color = bytes[position + 17];
        const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!validDepths[color]?.includes(depth) || bytes[position + 18] !== 0 || bytes[position + 19] !== 0 || bytes[position + 20] > 1) throw new Error('PNGのヘッダーが無効です。');
      } else if (type === 'IHDR' || type === 'acTL') {
        throw new Error('静止画のPNGを選んでください。');
      }
      if (type === 'IDAT' && length > 0) hasData = true;
      if (type === 'IEND') {
        if (length !== 0 || !hasData || end !== bytes.length) throw new Error('PNGの終端が無効です。');
        ended = true;
        break;
      }
      position = end;
    }
    if (!ended) throw new Error('PNGのデータが途中で切れています。');
  } else if (declaredType === 'image/jpeg') {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('JPEGの形式を確認できませんでした。');
    let position = 2;
    let hasScan = false;
    while (position + 3 < bytes.length) {
      if (bytes[position++] !== 0xff) throw new Error('JPEGのヘッダーが無効です。');
      while (bytes[position] === 0xff) position += 1;
      const marker = bytes[position++];
      if (position + 2 > bytes.length) break;
      const length = view.getUint16(position);
      if (length < 2 || position + length > bytes.length - 2) throw new Error('JPEGのデータが途中で切れています。');
      if (marker === 0xc0 || marker === 0xc2) {
        if (width || length < 11 || bytes[position + 2] !== 8) throw new Error('JPEGのヘッダーが無効です。');
        height = view.getUint16(position + 3);
        width = view.getUint16(position + 5);
        const components = bytes[position + 7];
        if (![1, 3].includes(components) || length !== 8 + components * 3) throw new Error('JPEGの色形式に対応していません。');
      } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        throw new Error('このJPEG形式には対応していません。');
      }
      if (marker === 0xda) {
        if (!width || length < 6 || position + length >= bytes.length - 2) throw new Error('JPEGの画像データがありません。');
        hasScan = true;
        break;
      }
      position += length;
    }
    if (!hasScan) throw new Error('JPEGの画像データがありません。');
  } else {
    throw new Error('写真はJPEGまたはPNGを選んでください。');
  }
  if (!validDimensions(width, height)) throw new Error('写真は一辺8192px・2400万画素以内にしてください。');
  return { contentType: declaredType, byteLength: bytes.length, width, height };
}

export async function inquiryImageDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
