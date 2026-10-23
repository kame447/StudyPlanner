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

describe('announcement delivery-failure surface source contract', () => {
  it('uses initial styles and greater specificity than shared modal geometry', () => {
    const initial = postcss.parse(readFileSync(new URL('./announcement-bell.css', import.meta.url), 'utf8'));
    const rules: postcss.Rule[] = [];
    initial.walkRules('dialog.announcement-load-failure', rule => { rules.push(rule); });
    expect(rules).toHaveLength(1);
    const declarations: Record<string, string> = {};
    rules[0].walkDecls(decl => { declarations[decl.prop] = decl.value; });
    expect(declarations).toMatchObject({ position: 'fixed', inset: '0', width: 'min(480px, calc(100vw - 32px))', 'max-height': 'calc(100dvh - 32px)', margin: 'auto' });
    // The explicit dialog type makes (0,1,1) stronger than shared (0,1,0),
    // including later responsive rules. This is a source guard, not browser QA.
    for (const file of ['./modals.css', './responsive.css']) {
      const shared = postcss.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
      shared.walkRules(rule => {
        if (!rule.selectors.includes('.modal-card')) return;
        rule.walkDecls(decl => {
          if (['position', 'inset', 'width', 'max-height', 'margin', 'margin-top', 'margin-inline'].includes(decl.prop)) expect(Boolean(decl.important)).toBe(false);
        });
      });
    }
    const source = readFileSync(new URL('../components/AnnouncementsButton.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import '../styles/announcement-bell.css'");
    expect(source).toContain('className="modal-card announcement-load-failure"');
    expect(source).not.toContain("import '../styles/announcements.css'");
  });
});
