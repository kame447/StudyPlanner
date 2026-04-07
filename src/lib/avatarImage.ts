const MAX_AVATAR_EDGE = 256;
const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024;

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

function cropImageToSquare(image: HTMLImageElement): string {
  const size = Math.min(image.width, image.height);
  const offsetX = Math.floor((image.width - size) / 2);
  const offsetY = Math.floor((image.height - size) / 2);
  const canvas = document.createElement('canvas');

  canvas.width = MAX_AVATAR_EDGE;
  canvas.height = MAX_AVATAR_EDGE;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('画像変換の準備に失敗しました。');
  }

  // 小さめの正方形に揃えて、localStorage を圧迫しにくくする。
  context.drawImage(
    image,
    offsetX,
    offsetY,
    size,
    size,
    0,
    0,
    MAX_AVATAR_EDGE,
    MAX_AVATAR_EDGE,
  );

  return canvas.toDataURL('image/jpeg', 0.82);
}

export function isImageAvatar(avatar: string): boolean {
  return avatar.trim().startsWith('data:image/');
}

export async function createAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('画像ファイルを選択してください。');
  }

  if (file.size > MAX_AVATAR_FILE_SIZE) {
    throw new Error('画像サイズは 5MB 以下にしてください。');
  }

  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  return cropImageToSquare(image);
}
