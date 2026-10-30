import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('./admin-mobile.css', import.meta.url), 'utf8');
describe('admin mobile affordances', () => {
  it('keeps return outside the hidden sidebar footer and provides a shared mobile drawer', () => {
    const app = readFileSync(new URL('../components/AdminApp.tsx', import.meta.url), 'utf8');
    expect(app).toContain('admin-return-header');
    expect(app).toContain('admin-navigation');
    expect(app).toContain('管理メニューを開く');
    expect(app).not.toContain('admin-mobile-navigation');
    expect(css).toContain('translateX(var(--admin-drawer-width))');
    expect(css).not.toMatch(/\.admin-return-header[^}]*display:\s*none/);
  });
  it('uses scoped readable controls and wrapping rather than clipping the page', () => {
    expect(css).toContain('font-size: max(1rem, 16px)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('flex-wrap: wrap');
    expect(css).not.toContain('overflow: hidden');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('min-inline-size: 0');
    expect(css).toContain(":root[data-motion='reduced']");
  });
  it('makes the opening drawer visible before shared layout-effect focus runs', () => {
    const opening = css.match(/\.admin-app-shell\.admin-menu-open \.admin-console-sidebar\s*\{([^}]+)\}/)?.[1];
    expect(opening).toContain('visibility: visible');
    expect(opening).toContain('transition: transform');
    expect(opening).not.toMatch(/transition:[^;]*visibility/);
  });
  it('wraps long timeline identifiers and AI cost values without clipping their content', () => {
    const phase5 = readFileSync(new URL('./admin-phase5.css', import.meta.url), 'utf8');
    const timeline = phase5.match(/\.admin-observability-timeline-item > div\s*\{([^}]+)\}/)?.[1];
    const metric = phase5.match(/\.admin-ai-shell \.admin-overview-metric-copy strong\s*\{([^}]+)\}/)?.[1];
    expect(timeline).toContain('overflow-wrap: anywhere');
    expect(metric).toContain('white-space: normal');
    expect(metric).toContain('overflow-wrap: anywhere');
    expect(`${timeline}${metric}`).not.toMatch(/overflow:\s*hidden|font-size|text-overflow/);
  });
});
