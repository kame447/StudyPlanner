import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { getThemePaletteCssVariables, THEME_PALETTE_OPTIONS } from '../lib/themePalette';

const css = postcss.parse(readFileSync(new URL('./home-desktop.css', import.meta.url), 'utf8'));
const imports = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const values = (selector: string) => {
  const result: Record<string, string> = {};
  css.walkRules(selector, rule => rule.walkDecls(decl => { result[decl.prop] = decl.value; }));
  return result;
};
const home = '.home-main > .home-dashboard-default';

describe('desktop Home source layout contract', () => {
  it('is limited to desktop Home and follows compact/reflow styles', () => {
    const media = css.nodes.filter(node => node.type === 'atrule');
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ name: 'media', params: '(min-width: 1200px)' });
    css.walkRules(rule => { expect(rule.selector.replace(":root[data-theme='dark'] ", '').startsWith(home)).toBe(true); });
    expect(imports.indexOf('home-desktop.css')).toBeGreaterThan(imports.indexOf('home-content-reflow.css'));
  });
  it('uses meaningful columns and leaves overflow with the Home body', () => {
    expect(values(home)).toMatchObject({ 'overflow-y': 'auto', 'overscroll-behavior': 'contain' });
    expect(values(`${home} .home-core-sections`)).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr) minmax(0, 1fr)',
      'grid-template-areas': "'next today' 'attention progress'",
      flex: '0 0 auto',
      'grid-template-rows': 'minmax(17rem, auto) minmax(9rem, auto)',
    });
    expect(values(`${home}[data-content-scroll='true'] .home-core-sections`)).toMatchObject({ 'min-block-size': 'min-content', 'grid-template-rows': 'auto auto' });
  });
  it('preserves in-flow inspection actions and enlarged-text focus clearance', () => {
    expect(values(`${home} .home-next-card:has(.home-plan-inspect) .home-actions`).inset).toBe('auto');
    expect(values(`${home}[data-content-scroll='true']`)).toMatchObject({ padding: '5px', 'scroll-padding': '5px' });
  });
  it('sets text floors without viewport-based shrinking or transforms', () => {
    expect(values(`${home} .home-next-copy h1`)['font-size']).toBe('1.5rem');
    expect(values(`${home} .home-next-meta`)['font-size']).toBe('0.875rem');
    css.walkDecls('font-size', decl => { expect(decl.value).toMatch(/^[\d.]+rem$/); expect(parseFloat(decl.value)).toBeGreaterThanOrEqual(0.75); });
    css.walkDecls(decl => { expect(['transform', 'zoom']).not.toContain(decl.prop); });
  });
  it('uses the accessible theme-muted color for normal-size material progress text', () => {
    expect(values(`${home} .home-material-copy small`).color).toBe('var(--text-muted)');
    const base = postcss.parse(readFileSync(new URL('./base.css', import.meta.url), 'utf8'));
    let foreground = '';
    base.walkRules(':root', rule => rule.walkDecls('--text-muted', declaration => { foreground = declaration.value; }));
    expect(foreground).toMatch(/^#[\da-f]{6}$/i);
    const channels = foreground.slice(1).match(/.{2}/g)!.map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    // Native axe measured this existing white material-list background.
    expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it('pairs the dark desktop start label with a readable surface without changing control geometry', () => {
    const selector = `:root[data-theme='dark'] ${home} .home-start-button`;
    expect(values(selector)).toEqual({ color: 'var(--text-primary)', background: 'var(--surface-selected)' });
    // The runtime palette replaces base.css's high-opacity fallback. Contrast
    // must include the rendered ancestor images, tested by the native pixel check.
    for (const palette of THEME_PALETTE_OPTIONS) {
      const selected = getThemePaletteCssVariables(palette.id, 'dark')['--surface-selected'];
      expect(selected).toMatch(/^rgba\(\d+, \d+, \d+, 0\.24\)$/);
    }
  });
  it('uses smaller vertical gaps on short desktops without shrinking type or cards', () => {
    const compact: string[] = [];
    css.walkAtRules('media', rule => {
      if (rule.params !== '(max-height: 850px)') return;
      expect(rule.parent).toMatchObject({ type: 'atrule', name: 'media', params: '(min-width: 1200px)' });
      rule.walkDecls(declaration => {
        expect(declaration.prop).toBe('row-gap');
        expect(declaration.value).toBe('8px');
      });
      rule.walkRules(child => { compact.push(...child.selectors); });
    });
    expect(compact).toEqual([home, `${home} .home-core-sections`]);
  });
  it('gives progress labels readable type and room that grows with text', () => {
    for (const selector of ['.weekly-progress-summary', '.weekly-progress-legend', '.weekly-progress-axis', '.weekly-progress-day small']) {
      expect(values(`${home} ${selector}`)).toMatchObject({ 'font-size': '0.75rem', 'line-height': '1.25' });
    }
    expect(values(`${home} .weekly-progress-plot`)).toMatchObject({
      '--weekly-progress-plot-height': '4.5rem',
      'grid-template-columns': 'max-content minmax(0, 1fr)',
    });
    expect(values(`${home} .weekly-progress-bars`).height).toBe('auto');
    expect(values(`${home} .weekly-progress-day`)).toMatchObject({ height: 'auto', 'grid-template-rows': 'var(--weekly-progress-plot-height) auto' });
  });
  it('gives the enlarged progress chart its own row without overriding bar motion or hiding text', () => {
    expect(values(`${home}[data-content-scroll='true'] .weekly-progress-layout`)['grid-template-columns']).toBe('max-content minmax(0, 1fr)');
    expect(values(`${home}[data-content-scroll='true'] .weekly-progress-chart`)['grid-column']).toBe('1 / -1');
    css.walkRules(rule => {
      if (rule.selector.includes('weekly-progress')) {
        expect(rule.selector).not.toMatch(/weekly-progress-(plan|actual|columns|ring)(?:\b|\s)/);
        rule.walkDecls(decl => { expect(['transform', 'overflow', 'text-overflow']).not.toContain(decl.prop); });
      }
    });
  });
});
