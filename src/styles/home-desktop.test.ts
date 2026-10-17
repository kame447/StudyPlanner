import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

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
    css.walkRules(rule => { expect(rule.selector.startsWith(home)).toBe(true); });
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
});
