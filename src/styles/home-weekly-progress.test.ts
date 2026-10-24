import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = postcss.parse(readFileSync(new URL('./home-weekly-progress.css', import.meta.url), 'utf8'));

function declarations(selector: string, media?: string) {
  const values: Record<string, string> = {};
  css.walkRules(selector, rule => {
    const parent = rule.parent;
    if (media ? parent?.type !== 'atrule' || parent.params !== media : parent?.type !== 'root') return;
    rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
  });
  return values;
}

const pixelFloor = (value: string) => Number(value.match(/^(?:clamp\()?([\d.]+)px/)?.[1]);

describe('compact weekly progress percentage room', () => {
  // PR729 Chromium's loaded DotGothic16 at a 32px root produced a 41px label
  // and text range inside a 40px disc. Native containment remains the E2E gate;
  // this source contract prevents restoring the undersized compact geometry.
  it.each(['(max-height: 900px)', '(max-width: 390px)'])('%s reserves room for enlarged text in the ring and its column', media => {
    const ring = declarations('.weekly-progress-ring', media);
    const layout = declarations('.weekly-progress-layout', media);
    const inner = { ...declarations('.weekly-progress-ring > div'), ...declarations('.weekly-progress-ring > div', media) };
    const diameter = pixelFloor(ring.width);
    const inset = Number(inner.width.match(/- (\d+)px/)?.[1]);
    expect(diameter).toBeGreaterThanOrEqual(56);
    expect(pixelFloor(ring.height)).toBe(diameter);
    expect(diameter - inset).toBeGreaterThan(41);
    expect(pixelFloor(layout['grid-template-columns'].trim())).toBeGreaterThanOrEqual(diameter);
  });

  it('retains rem-based text enlargement rather than shrinking or clipping the percentage', () => {
    const label = declarations('.weekly-progress-ring strong');
    expect(label['font-size']).toBe('clamp(0.68rem, 2.1vw, 0.8rem)');
    expect(declarations('.weekly-progress-ring strong small')['font-size']).toBe('0.7em');
    for (const selector of ['.weekly-progress-ring', '.weekly-progress-ring > div', '.weekly-progress-ring strong']) {
      expect(declarations(selector)).not.toHaveProperty('overflow');
      expect(declarations(selector)).not.toHaveProperty('transform');
    }
  });
});
