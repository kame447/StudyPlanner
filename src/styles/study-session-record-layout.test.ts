import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import postcss from 'postcss';

it('bounds native time controls and their grid labels within separate tracks', () => {
  const css = postcss.parse(readFileSync(new URL('./study-session.css', import.meta.url), 'utf8'));
  function values(selector: string) {
    const values = new Map<string, string>();
    css.walkRules(rule => {
      if (rule.parent?.type === 'root' && rule.selectors.includes(selector)) rule.walkDecls(d => { values.set(d.prop, d.value); });
    });
    return values;
  }
  expect(values('.study-session-time-adjust > div').get('grid-template-columns')).toBe('repeat(2, minmax(0, 1fr))');
  expect(values('.study-session-time-adjust label').get('min-width')).toBe('0');
  expect(values('.study-session-time-adjust input').get('box-sizing')).toBe('border-box');
  expect(values('.study-session-time-adjust input').get('min-width')).toBe('0');
  expect(values('.study-session-time-adjust input[type="time"]').get('max-inline-size')).toBe('100%');
});

it('keeps a focus-scroll inset for the final settings action at enlarged text sizes', () => {
  const css = postcss.parse(readFileSync(new URL('./study-session.css', import.meta.url), 'utf8'));
  const declarations: string[] = [];
  css.walkRules('.study-session-page[data-phase="settings"]', rule => {
    rule.walkDecls('scroll-padding-bottom', declaration => { declarations.push(declaration.value); });
  });
  expect(declarations).toEqual(['16px']);
});
