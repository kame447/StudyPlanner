import { describe, expect, it } from 'vitest';
import {
  getAiImageMimeType,
  validateAiImageFile,
} from './aiImageAttachment';

describe('AI image attachment validation', () => {
  it('accepts PNG and JPEG images', () => {
    expect(getAiImageMimeType({ type: 'image/png' })).toBe('image/png');
    expect(getAiImageMimeType({ type: 'image/jpeg' })).toBe('image/jpeg');
    expect(validateAiImageFile({ type: 'image/jpeg', size: 1024 })).toBeNull();
  });

  it('rejects unsupported formats', () => {
    expect(getAiImageMimeType({ type: 'image/heic' })).toBeNull();
    expect(validateAiImageFile({ type: 'image/heic', size: 1024 })).toContain('png / jpg / jpeg');
  });

  it('rejects source files larger than 15MB', () => {
    expect(
      validateAiImageFile({
        type: 'image/png',
        size: 15 * 1024 * 1024 + 1,
      }),
    ).toContain('15MB以下');
  });
});
