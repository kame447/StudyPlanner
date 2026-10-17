import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule } from 'postcss';
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

it('uses the existing desktop shell without changing compact report layout or scroll ownership', () => {
  const root = postcss.parse(readFileSync(fileURLToPath(new URL('./report.css', import.meta.url)), 'utf8'));
  const desktop = root.nodes.find((node): node is AtRule => node.type === 'atrule' && node.params === '(min-width: 1100px)');
  expect(desktop).toBeDefined();
  const declarations: Record<string, Record<string, string>> = {};
  desktop!.walkRules(rule => {
    for (const selector of rule.selectors) {
      declarations[selector] = {};
      rule.walkDecls(declaration => { declarations[selector][declaration.prop] = declaration.value; });
    }
  });
  expect(declarations['.learning-report-view']).toEqual({ width: 'min(100%, 960px)' });
  expect(declarations['.learning-report-details-content']).toEqual({ 'max-width': '760px', 'margin-inline': 'auto' });
  expect(Object.keys(declarations).every(selector => selector.startsWith('.learning-report-'))).toBe(true);
  desktop!.walkDecls(declaration => {
    expect(declaration.prop).not.toMatch(/^(?:height|max-height|overflow(?:-[xy])?|position)$/);
  });
  const compact = root.nodes.find(node => node.type === 'rule' && node.selector === '.learning-report-view');
  expect(compact?.toString()).toContain('width: min(100%, 760px)');
});

it('gives desktop report helper text a scalable 14px default floor', () => {
  const root = postcss.parse(readFileSync(fileURLToPath(new URL('./report.css', import.meta.url)), 'utf8'));
  const desktop = root.nodes.find((node): node is AtRule => node.type === 'atrule' && node.params === '(min-width: 1100px)');
  expect(desktop).toBeDefined();
  const fonts = new Map<string, string>();
  desktop!.walkRules(rule => {
    rule.walkDecls('font-size', declaration => {
      for (const selector of rule.selectors) fonts.set(selector, declaration.value);
    });
  });
  for (const selector of [
    '.learning-report-summary-copy > span', '.learning-report-card-heading p',
    '.learning-report-period-total span', '.learning-report-chart-label strong',
    '.learning-report-chart-label span', '.learning-report-breakdown-copy strong',
    '.learning-report-breakdown-copy span', '.learning-report-breakdown-value strong',
    '.learning-report-breakdown-value span', '.learning-report-insight strong',
    '.learning-report-insight p',
    '.learning-report-chart:not(.scope-month) .learning-report-chart-bar-area',
  ]) {
    expect(fonts.get(selector), selector).toBe('0.875rem');
  }
});
