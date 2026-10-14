import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = postcss.parse(readFileSync(new URL('./announcements.css', import.meta.url), 'utf8'));

describe('announcement full-screen scrolling source contract', () => {
  it('removes the underlying reserved scrollbar only while the native dialog is open', () => {
    const rootRules = css.nodes.filter(node => node.type === 'rule' && node.selectors.some(selector => /^(html|body)(:|$)/.test(selector)));
    expect(rootRules).toHaveLength(1);
    const rule = rootRules[0];
    if (rule.type !== 'rule') throw new Error('Expected root rule');
    expect(rule.selectors).toEqual(['html:has(.announcements-page[open])', 'body:has(.announcements-page[open])']);
    const declarations: Record<string, string> = {};
    rule.walkDecls(decl => { declarations[decl.prop] = decl.value; });
    expect(declarations).toEqual({ overflow: 'hidden', 'scrollbar-gutter': 'auto' });
  });

  it('keeps the full-screen dialog as the scroll owner', () => {
    const values: Record<string, string> = {};
    css.walkRules('.announcements-page', rule => {
      if (rule.parent?.type === 'root') rule.walkDecls(decl => { values[decl.prop] = decl.value; });
    });
    expect(values).toMatchObject({ position: 'fixed', inset: '0', width: '100%', height: '100%', 'box-sizing': 'border-box', 'overflow-y': 'auto', 'overscroll-behavior': 'contain' });
  });
});
