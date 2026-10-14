import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('./admin-mobile.css', import.meta.url), 'utf8');
describe('admin mobile affordances', () => {
  it('keeps return outside the hidden sidebar footer and provides native navigation', () => {
    const app = readFileSync(new URL('../components/AdminApp.tsx', import.meta.url), 'utf8');
    expect(app).toContain('admin-return-header');
    expect(app).toContain('admin-mobile-navigation');
    expect(css).toContain('.admin-mobile-navigation { display: grid');
    expect(css).not.toMatch(/\.admin-return-header[^}]*display:\s*none/);
  });
  it('uses scoped readable controls and wrapping rather than clipping the page', () => {
    expect(css).toContain('font-size: max(1rem, 16px)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('flex-wrap: wrap');
    expect(css).not.toContain('overflow: hidden');
  });
});
