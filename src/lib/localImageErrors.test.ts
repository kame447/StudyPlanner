import { afterEach, expect, it, vi } from 'vitest';
import { createAvatarDataUrl } from './avatarImage';
import { createMaterialCoverDataUrl } from './materialImage';
import { UserFacingError } from './userFacingError';
afterEach(() => vi.unstubAllGlobals());
for (const [name, convert] of [['avatar', createAvatarDataUrl], ['material', createMaterialCoverDataUrl]] as const) {
  it.each(['reader', 'canvas'])(`${name} hides unknown %s exceptions`, async failure => {
    class Reader {
      result = 'data:image/png;base64,fixture'; onload: (() => void) | null = null;
      readAsDataURL() { if (failure === 'reader') throw new DOMException('private raw DOM detail'); this.onload?.(); }
    }
    class Picture {
      width = 100; height = 100; onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal('FileReader', Reader); vi.stubGlobal('Image', Picture);
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => { throw new DOMException('private canvas detail'); } }) });
    const error = await convert(new File(['fixture'], 'photo.png', { type: 'image/png' })).catch(value => value);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(error.message).toBe('写真を読み込めませんでした。別の画像を選んでください。');
  });
}
it('preserves local photo type and size instructions', async () => {
  await expect(createAvatarDataUrl(new File(['x'], 'x.txt', { type: 'text/plain' }))).rejects.toThrow('画像ファイルを選択');
  await expect(createAvatarDataUrl(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' }))).rejects.toThrow('5MB');
  await expect(createMaterialCoverDataUrl(new File(['x'], 'x.svg', { type: 'image/svg+xml' }))).rejects.toThrow('svg');
  await expect(createMaterialCoverDataUrl(new File(['x'], 'x.txt', { type: 'text/plain' }))).rejects.toThrow('jpeg / png / webp');
  await expect(createMaterialCoverDataUrl(new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' }))).rejects.toThrow('3MB');
});
