import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = postcss.parse(readFileSync(new URL('./study-session.css', import.meta.url), 'utf8'));
const desktopQuery = '(min-width: 1024px) and (min-height: 801px)';
const normalRing = '.study-session-timer-ring[data-study-mode="normal"]';

function declarations(selector: string, media?: string) {
  const values = new Map<string, string>();
  css.walkRules(rule => {
    const parent = rule.parent;
    const matchesScope = media
      ? parent?.type === 'atrule' && parent.name === 'media' && parent.params === media
      : parent?.type === 'root';
    if (matchesScope && rule.selectors.includes(selector)) {
      rule.walkDecls(declaration => { values.set(declaration.prop, declaration.value); });
    }
  });
  return Object.fromEntries(values);
}

describe('ordinary timer desktop face', () => {
  it('lets the face grow with its clock instead of letting the inner grid escape a fixed ring', () => {
    expect(declarations(normalRing, desktopQuery)).toEqual({
      width: 'max-content',
      'min-width': 'min(260px, 30dvh, 100%)',
      'max-width': '100%',
    });
    expect(declarations(`${normalRing} .study-session-timer-inner strong`, desktopQuery)).toEqual({
      'white-space': 'nowrap',
    });
  });

  it('preserves font enlargement and the existing circular face contract', () => {
    expect(declarations('.study-session-timer-inner strong')).toMatchObject({
      'font-size': 'clamp(1.8rem, 8vw, 3.5rem)',
      'line-height': '1',
    });
    expect(declarations('.study-session-timer-ring')).toMatchObject({
      'aspect-ratio': '1',
      padding: '8px',
      'border-radius': '50%',
    });
    expect(declarations('.study-session-timer-inner')).toMatchObject({
      display: 'grid',
      gap: '6px',
      padding: '10px',
    });
  });

  it('leaves the compact and Pomodoro rules outside the new ordinary-clock scope', () => {
    expect(declarations('.study-session-timer-ring', '(max-height: 800px)')).toMatchObject({
      width: '100%',
      'aspect-ratio': 'auto',
    });
    expect(declarations('.study-session-timer-inner strong', '(max-height: 800px)')).toMatchObject({
      'font-size': '2rem',
    });
    expect(declarations('.study-session-timer-ring[data-study-mode="pomodoro"]', desktopQuery)).toEqual({});
  });
});
