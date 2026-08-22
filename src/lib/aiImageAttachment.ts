export type AiImageMimeType = 'image/png' | 'image/jpeg';

export interface AiImageFilePayload {
  fileName: string;
  mimeType: AiImageMimeType;
  base64: string;
}

const MAX_AI_IMAGE_WIDTH = 1600;
const AI_IMAGE_JPEG_QUALITY = 0.82;
const MAX_AI_IMAGE_SOURCE_BYTES = 15 * 1024 * 1024;

export function getAiImageMimeType(file: Pick<File, 'type'>): AiImageMimeType | null {
  if (file.type === 'image/png') {
    return 'image/png';
  }

  if (file.type === 'image/jpeg') {
    return 'image/jpeg';
  }

  return null;
}

export function validateAiImageFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!getAiImageMimeType(file)) {
    return '画像は png / jpg / jpeg のみ対応しています。';
  }

  if (file.size > MAX_AI_IMAGE_SOURCE_BYTES) {
    return '画像サイズが大きすぎます。15MB以下の画像を選択してください。';
  }

  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('ファイルを読み込めませんでした。'));
    };
    reader.onerror = () => reject(new Error('ファイルを読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    image.src = dataUrl;
  });
}

function extractBase64FromDataUrl(dataUrl: string): string {
  const marker = ';base64,';
  const markerIndex = dataUrl.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error('画像データの形式が不正です。');
  }

  return dataUrl.slice(markerIndex + marker.length);
}

async function resizeImageDataUrl(
  file: File,
  mimeType: AiImageMimeType,
): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceDataUrl);
  const scale = Math.min(1, MAX_AI_IMAGE_WIDTH / image.naturalWidth);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  if (scale === 1 && mimeType === 'image/png') {
    return sourceDataUrl;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('画像の変換に失敗しました。');
  }

  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', AI_IMAGE_JPEG_QUALITY);
}

export async function createAiImageFilePayload(file: File): Promise<AiImageFilePayload> {
  const validationError = validateAiImageFile(file);

  if (validationError) {
    throw new Error(validationError);
  }

  const sourceMimeType = getAiImageMimeType(file);

  if (!sourceMimeType) {
    throw new Error('画像形式を確認してください。');
  }

  const dataUrl = await resizeImageDataUrl(file, sourceMimeType);
  const mimeType: AiImageMimeType = dataUrl.startsWith('data:image/png')
    ? 'image/png'
    : 'image/jpeg';

  return {
    fileName: file.name,
    mimeType,
    base64: extractBase64FromDataUrl(dataUrl),
  };
}
