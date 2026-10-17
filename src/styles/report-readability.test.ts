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

it('uses the readable body token for small emphasized text in dark reports only', () => {
  const root = postcss.parse(readFileSync(fileURLToPath(new URL('./report.css', import.meta.url)), 'utf8'));
  const targets = ['.learning-report-chart-value', '.learning-report-details > summary', '.learning-report-insight strong'];
  for (const target of targets) {
    let darkColor: string | undefined;
    let defaultColor: string | undefined;
    root.walkRules(rule => {
      if (rule.selectors.includes(`:root[data-theme='dark'] ${target}`)) {
        rule.walkDecls('color', declaration => { darkColor = declaration.value; });
      }
      if (rule.selectors.includes(target)) {
        rule.walkDecls('color', declaration => { defaultColor = declaration.value; });
      }
    });
    expect(darkColor, target).toBe('var(--text-primary)');
    expect(defaultColor, `${target} retains its light-theme accent`).toBe('var(--accent-strong)');
  }

  const base = postcss.parse(readFileSync(fileURLToPath(new URL('./base.css', import.meta.url)), 'utf8'));
  let foreground = '';
  base.walkRules(rule => {
    if (rule.selector !== ":root[data-theme='dark']") return;
    rule.walkDecls('--text-primary', declaration => { foreground = declaration.value; });
  });
  const luminance = (rgb: number[]) => rgb.map(channel => channel / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
  const ink = luminance(foreground.slice(1).match(/../g)!.map(channel => parseInt(channel, 16)));
  // Actual attempt-1 pixel chart background; this guards the observed failure,
  // while native assertions below independently inspect current computed colors.
  const paper = luminance([28, 45, 52]);
  expect((Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05)).toBeGreaterThanOrEqual(4.5);
});

it('keeps dark selected scope tabs readable using the existing selected-surface pair', () => {
  const root = postcss.parse(readFileSync(fileURLToPath(new URL('./report.css', import.meta.url)), 'utf8'));
  const declarations: Record<string, string> = {};
  root.walkRules(rule => {
    if (rule.selector !== ":root[data-theme='dark'] .learning-report-scope-tabs button.active") return;
    rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
  });
  expect(declarations).toEqual({ background: 'var(--surface-selected)', color: 'var(--text-primary)' });
  let lightRule = '';
  root.walkRules(rule => { if (rule.selector === '.learning-report-scope-tabs button.active') lightRule = rule.toString(); });
  expect(lightRule).toContain('background: var(--accent)');
  expect(lightRule).toContain('color: #fff');
});
