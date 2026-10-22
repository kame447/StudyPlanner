import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./appearance-pixel.css', import.meta.url)), 'utf8');
const root = postcss.parse(css);

describe('pixel paint scope', () => {
  it('avoids grid rasterization on the canvas hidden by the opaque viewport-filling body', () => {
    const backgrounds = new Map<string, string>();
    root.walkRules(rule => {
      rule.walkDecls('background', declaration => {
        backgrounds.set(rule.selector, declaration.value);
      });
    });
    expect(backgrounds.get("html[data-appearance='pixel']")).toBe('var(--pixel-canvas)');
    expect(backgrounds.get("html[data-appearance='pixel'] :is(body, .app-shell, .app-settings-page, .app-settings-header, .app-settings-tabs)"))
      .toBe('var(--pixel-grid-paper), var(--pixel-canvas)');
    const base = postcss.parse(readFileSync(fileURLToPath(new URL('./base.css', import.meta.url)), 'utf8'));
    const body = base.nodes.find(node => node.type === 'rule' && node.selector === 'body');
    expect(body?.type).toBe('rule');
    if (body?.type !== 'rule') throw new Error('Missing body canvas owner');
    expect(body.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ prop: 'margin', value: '0' }),
      expect.objectContaining({ prop: 'min-height', value: '100vh' }),
    ]));
  });
  it('covers the actual secondary surfaces without repainting pinned task colors', () => {
    for (const selector of ['.panel:has(> .day-timeline-header)', '.panel.todo-view', '.learning-report-summary-card',
      '.learning-report-card', '.learning-report-empty', '.learning-report-insight',
      '.learning-report-scope-tabs', '.learning-report-material-filter', '.legal-page-card', '.auth-main-card', '.auth-stage-card']) {
      expect(css).toContain(selector);
    }
    expect(css).toContain('.todo-view-item:not(.todo-item-pinned)');
    root.walkRules(rule => {
      if (rule.selectors.includes("html[data-appearance='pixel'] .todo-item-pinned")) {
        rule.walkDecls(declaration => expect(declaration.prop).not.toMatch(/^(background|border-color|color)/));
      }
    });
  });
  it('keeps every selector behind the explicit appearance attribute', () => {
    root.walkRules(rule => {
      for (const selector of rule.selectors) {
        expect(selector.startsWith("html[data-appearance='pixel']")).toBe(true);
      }
    });
  });
  it('changes only typography family and paint, with one noninteractive hero paint layer', () => {
    const allowed = new Set(['font-family', 'background', 'background-color', 'border-color', 'border-radius', 'box-shadow',
      'color', 'shape-rendering', 'stroke-linecap', 'stroke-linejoin', 'accent-color', 'outline', 'outline-offset']);
    root.walkRules(rule => {
      rule.walkDecls(declaration => {
        if (declaration.prop.startsWith('--')) return;
        if (rule.selector === "html[data-appearance='pixel'] .home-next-card::after") {
          expect(['content', 'position', 'inset', 'pointer-events', 'z-index', 'background']).toContain(declaration.prop);
        } else expect(allowed.has(declaration.prop), declaration.prop).toBe(true);
      });
    });
    expect(css).toContain('pointer-events: none');
    expect(css).toContain('font-display: swap');
    expect(css).not.toContain('https://');
  });
});
