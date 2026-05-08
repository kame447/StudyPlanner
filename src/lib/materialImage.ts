const MAX_MATERIAL_IMAGE_EDGE = 640;
const MAX_MATERIAL_IMAGE_FILE_SIZE = 3 * 1024 * 1024;
const MAX_MATERIAL_IMAGE_DATA_URL_LENGTH = 700 * 1024;
const ALLOWED_MATERIAL_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;

      if (typeof result === 'string') {
        resolve(result);
        return;
      }

      reject(new Error('画像を読み込めませんでした。'));
    };

    reader.onerror = () => {
      reject(new Error('画像の読み込みに失敗しました。'));
    };

    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を表示できませんでした。'));
    image.src = src;
  });
}

function resizeImage(image: HTMLImageElement): string {
  const longerEdge = Math.max(image.width, image.height);
  const scale = longerEdge > MAX_MATERIAL_IMAGE_EDGE
    ? MAX_MATERIAL_IMAGE_EDGE / longerEdge
    : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('画像変換の準備に失敗しました。');
  }

  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', 0.78);
}

export async function createMaterialCoverDataUrl(file: File): Promise<string> {
  if (file.name.trim().toLowerCase().endsWith('.svg')) {
    throw new Error('svg 画像は登録できません。');
  }

  if (!ALLOWED_MATERIAL_IMAGE_TYPES.has(file.type)) {
    throw new Error('jpeg / png / webp の画像を選択してください。');
  }

  if (file.size > MAX_MATERIAL_IMAGE_FILE_SIZE) {
    throw new Error('教材写真は 3MB 以下にしてください。');
  }

  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const dataUrl = resizeImage(image);

  if (dataUrl.length > MAX_MATERIAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error('変換後の画像が大きすぎます。小さめの画像を選んでください。');
  }

  return dataUrl;
}
