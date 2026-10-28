import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { FONT_PRESET_OPTIONS } from '../lib/fontPreset';

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const css = read('./font-presets.css');

describe('font preset styles', () => {
  it('keeps every existing family stack as the unset-variable fallback', () => {
    expect(read('./base.css')).toContain('font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;');
    expect(css).toContain('font-family: var(--app-font-family, "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif);');
    const imports = read('../styles.css');
    expect(imports.indexOf("'./styles/font-presets.css'")).toBeGreaterThan(imports.indexOf("'./styles/base.css'"));
    for (const file of ['./home.css', './bookshelf.css']) {
      expect(read(file)).toContain('font-family: var(--app-font-family, "Hiragino Sans", "Yu Gothic UI", "Meiryo", system-ui, sans-serif);');
    }
  });

  it('changes the app family only behind an explicit preset attribute', () => {
    postcss.parse(css).walkRules(rule => {
      for (const selector of rule.selectors) {
        if (selector === ':root') {
          rule.walkDecls(declaration => expect(declaration.prop === 'font-family' || declaration.prop.startsWith('--font-preset-')).toBe(true));
        } else expect(selector.startsWith('html[data-font-preset') || selector.startsWith('.font-preset-sample')).toBe(true);
      }
    });
  });

  it('defines an app stack and a comparison sample for every preset, ending in the system fallback', () => {
    for (const { id } of FONT_PRESET_OPTIONS) {
      expect(css).toContain(`.font-preset-sample[data-font-sample='${id}']`);
      if (id !== 'system') expect(css).toContain(`html[data-font-preset='${id}'] { --app-font-family: var(--font-preset-${id}); }`);
    }
    expect(css).toContain('--font-preset-fallback: "Hiragino Sans", "Yu Gothic UI", "Meiryo", system-ui, sans-serif;');
    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('https://');
  });

  it('lets comparison samples escape the dot appearance family override', () => {
    expect(read('./appearance-pixel.css')).toContain("html[data-appearance='pixel'] :not(.font-preset-sample),");
  });
});
