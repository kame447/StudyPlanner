import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./schedule-day-sheet-motion.css', import.meta.url), 'utf8');
const keyframes = (name: string) => css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

it('keeps the settled day-sheet blur under reduced motion and fades only the tint', () => {
  const reduced = css.match(/:root\[data-motion='reduced'\] \.month-day-sheet-overlay\.is-open \{([^}]+)\}/)?.[1];
  expect(reduced).toContain('animation-name: month-day-sheet-backdrop-fade');
  const fade = keyframes('month-day-sheet-backdrop-fade');
  expect(fade).toContain('background: rgba(18, 24, 36, 0)');
  expect(fade).not.toContain('backdrop-filter');
  // The settled overlay supplies the end values; standard motion keeps its blur interpolation.
  expect(css.match(/\.month-day-sheet-overlay \{([^}]+)\}/)?.[1]).toContain('backdrop-filter: blur(3px)');
  expect(keyframes('month-day-sheet-backdrop-in')).toContain('backdrop-filter: blur(0)');
});
