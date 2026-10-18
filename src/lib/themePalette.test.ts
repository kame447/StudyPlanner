import { describe, expect, it, vi } from 'vitest';
import { isThemePalette, THEME_PALETTE_OPTIONS } from './themePalette';

describe('theme palette registry', () => {
  it('preserves the five offered palettes in their existing order', () => {
    expect(THEME_PALETTE_OPTIONS).toEqual([
      { id: 'forest', label: 'フォレスト', swatches: ['#176d66', '#2f8f84', '#dceeea'] },
      { id: 'ocean', label: 'オーシャン', swatches: ['#2f6fc2', '#3a90e8', '#d7e8fb'] },
      { id: 'sakura', label: 'サクラ', swatches: ['#c75a86', '#e18db1', '#f7dce6'] },
      { id: 'amber', label: 'アンバー', swatches: ['#bf7c24', '#e2a44d', '#f7e3c6'] },
      { id: 'violet', label: 'バイオレット', swatches: ['#6a56b7', '#917be2', '#e3dcf7'] },
    ]);
  });

  it.each(THEME_PALETTE_OPTIONS)('recognizes the offered $id palette', ({ id }) => {
    expect(isThemePalette(id)).toBe(true);
  });

  it.each([
    '', 'blue', 'sepia', 'FOREST', ' ocean ', '{"id":"ocean"}',
    '__proto__', 'prototype', 'constructor', 'toString', 'hasOwnProperty',
    'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__',
  ])('rejects unsupported and inherited names: %j', value => {
    expect(isThemePalette(value)).toBe(false);
  });

  it.each([
    null, undefined, 0, 1, true, false, [], ['forest'], {}, { id: 'ocean' },
    new String('forest'), Symbol('forest'), () => 'forest',
  ])('rejects non-string values: %j', value => {
    expect(isThemePalette(value)).toBe(false);
  });

  it('does not coerce an input to a palette key', () => {
    const toString = vi.fn(() => 'forest');
    expect(isThemePalette({ toString })).toBe(false);
    expect(toString).not.toHaveBeenCalled();
  });
});
