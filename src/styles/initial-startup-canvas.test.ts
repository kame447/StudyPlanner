import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const style = html.match(/<style id="initial-startup-canvas">([\s\S]*?)<\/style>/);
const css = postcss.parse(style?.[1] ?? '');
const splash = postcss.parse(readFileSync(new URL('./startup-splash.css', import.meta.url), 'utf8'));

describe('initial startup canvas source contract', () => {
  it('is inline before external resources and leaves an empty React root', () => {
    expect(style).not.toBeNull();
    expect(html.indexOf(style![0])).toBeLessThan(html.indexOf('<link'));
    expect(html.indexOf(style![0])).toBeLessThan(html.indexOf('<script'));
    expect(html).toContain('<div id="root"></div>');
  });

  it('covers missing/empty root and body only, without a persistent theme override', () => {
    const selectors: string[] = [];
    css.walkRules(rule => { selectors.push(...rule.selectors); });
    expect(selectors).toEqual([
      'html:not(:has(#root:not(:empty)))',
      'html:not(:has(#root:not(:empty))) body',
    ]);
    expect(css.nodes.filter(node => node.type === 'rule')).toHaveLength(1);
  });

  it('matches the actual video canvas without relying on the downloaded stylesheet', () => {
    let videoBackground: string | undefined;
    splash.walkRules('html:has(.startup-splash)', rule => {
      rule.walkDecls('--startup-bg', declaration => { videoBackground = declaration.value; });
    });
    expect(videoBackground).toBe('#060914');
    const declarations: Record<string, string> = {};
    css.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
    expect(declarations).toEqual({ background: videoBackground, 'color-scheme': 'dark', transition: 'none' });
    css.walkDecls('background', declaration => { expect(declaration.important).toBe(true); });
  });

  it('adds no request, overlay, script, timer or independent startup state', () => {
    expect(style![1]).not.toMatch(/@import|url\(|position:|z-index:|animation:|display:/);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
  });
});
