import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./study-streak.css', import.meta.url), 'utf8');

it('bounds the calendar by its week count instead of stretching into all spare height', () => {
  const calendar = css.match(/\.study-streak-calendar \{([^}]+)\}/)?.[1];
  expect(calendar).toContain('flex: 0 1 auto');
  expect(calendar).toContain('height: calc(7.5rem + var(--streak-week-count) * 2.75rem)');
  expect(calendar).toContain('min-height: calc(7.5rem + var(--streak-week-count) * 1.5rem)');
});

it('keeps the legend and live ticket progress readable with a scrolling large-text fallback', () => {
  expect(css.match(/\.study-streak-legend \{([^}]+)\}/)?.[1]).toContain('font-size: .875rem');
  expect(css.match(/\.study-streak-ticket-note \{([^}]+)\}/)?.[1]).toContain('font-size: 1rem');
  expect(css.match(/\.study-streak-page \{([^}]+)\}/)?.[1]).toContain('overflow: auto');
  expect(css).toContain('min-height: 44px');
});
