import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { expect, it } from 'vitest';

it('reserves a numeric line box that encloses the bundled pixel font metrics', () => {
  const css = readFileSync(fileURLToPath(new URL('./report.css', import.meta.url)), 'utf8');
  const root = postcss.parse(css);
  let lineHeight: string | undefined;
  root.walkRules(rule => {
    if (rule.selector !== '.learning-report-chart:not(.scope-month) .learning-report-chart-bar-area') return;
    rule.walkDecls('line-height', declaration => { lineHeight = declaration.value; });
  });

  // DotGothic16 hhea/Win ascent+descent is 1.448em. Use a unitless 1.5
  // minimum so rounded glyph bounds also fit when the user enlarges text.
  // Actual containment remains covered by the native Range-based assertions.
  expect(lineHeight).toMatch(/^\d+(?:\.\d+)?$/);
  expect(Number(lineHeight)).toBeGreaterThanOrEqual(1.5);
});
