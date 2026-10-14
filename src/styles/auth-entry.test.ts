import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./auth-entry.css', import.meta.url), 'utf8');
const root = postcss.parse(css);
function declarations(selector: string) {
  const result: Record<string, string> = {};
  root.walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}
function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('auth entry paint and motion contract', () => {
  it('contains valid scoped styles and keeps the two modes on one row without changing shared auth cards', () => {
    expect(declarations('.auth-entry-modes')['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    expect(css).not.toContain('.auth-main-card'); expect(css).not.toContain('.auth-stage-card');
    root.walkRules(rule => {
      if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes') return;
      for (const selector of rule.selectors) expect(selector).toContain('auth-');
    });
  });

  it('keeps normal text, placeholders, errors, links and action labels above AA contrast on their actual backgrounds', () => {
    const canvas = declarations('.auth-shell.auth-entry-shell').background;
    const input = declarations('.auth-entry .field input');
    const submit = declarations('.auth-entry-submit');
    for (const [foreground, background] of [
      [input.color, input.background],
      [declarations('.auth-entry .field input::placeholder').color, input.background],
      [declarations('.auth-entry .field span').color, canvas],
      [declarations('.auth-entry-mode').color, canvas],
      [declarations('.auth-entry-legal a').color, canvas],
      [declarations('.auth-entry-error').color, canvas],
      [submit.color, submit.background],
    ]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('animates only transform on two layers, pauses while hidden, and disables animation for reduced motion', () => {
    const frames: string[] = [];
    root.walkAtRules('keyframes', rule => { rule.walkDecls(declaration => { frames.push(declaration.prop); }); });
    expect(frames).toEqual(['transform', 'transform']);
    expect(declarations(".auth-stars[data-paused='true'] .auth-stars__layer")['animation-play-state']).toBe('paused');
    const reducedRules: string[] = [];
    root.walkAtRules('media', rule => {
      if (rule.params === '(prefers-reduced-motion: reduce)') rule.walkDecls(declaration => { reducedRules.push(`${declaration.prop}: ${declaration.value}`); });
    });
    expect(reducedRules).toContain('animation: none');
    expect(css).not.toMatch(/url\(|filter:\s*blur|backdrop-filter|will-change/);
    expect(declarations('.auth-stars')['pointer-events']).toBe('none');
  });

  it('feathers the existing navy bitmap without global logo changes or extra assets', () => {
    expect(declarations('.auth-entry .brand-mark')['mask-image']).toContain('radial-gradient');
    expect(declarations('.auth-entry .brand-mark').filter).toBe('none');
    expect(declarations('.auth-shell.auth-entry-shell').background).toBe('#060914');
  });
});
