import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const globalStyles = source('../styles.css');
const adminEntry = source('../components/AdminApp.tsx');

function stylesheet(url: URL): postcss.Root {
  const root = postcss.parse(readFileSync(url, 'utf8'));
  root.walkAtRules('import', rule => {
    const imported = rule.params.match(/^['"]([^'"]+)['"]$/);
    if (!imported) throw new Error(`Unsupported stylesheet import: ${rule.params}`);
    rule.replaceWith(stylesheet(new URL(imported[1], url)).nodes);
  });
  return root;
}

// Evaluate only the equal-specificity panel/class padding rules at this boundary.
// This is a source cascade guard, not a substitute for browser/computed-style QA.
function panelPaddingAtWidth(className: string, width: number) {
  const initial = stylesheet(new URL('../styles.css', import.meta.url));
  const deferred = stylesheet(new URL('./admin-console.css', import.meta.url));
  let padding: string | undefined;
  let important = false;
  for (const root of [initial, deferred]) root.walkRules(rule => {
    if (!rule.selectors.some(selector => selector === '.panel' || selector === `.${className}`)) return;
    for (let parent: postcss.Node | undefined = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule') continue;
      const media = parent as postcss.AtRule;
      if (media.name !== 'media') throw new Error(`Unexpected panel ancestor: ${media.name}`);
      if (/print/.test(media.params)) return;
      for (const match of media.params.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)) {
        if (match[1] === 'max' && width > Number(match[2])) return;
        if (match[1] === 'min' && width < Number(match[2])) return;
      }
    }
    rule.walkDecls('padding', decl => {
      if (important && !decl.important) return;
      padding = decl.value;
      important = !!decl.important;
    });
  });
  return padding;
}

describe('administrator console style loading boundary', () => {
  it.each([
    [320, '10px'], [390, '12px'], [600, '12px'], [900, '14px'], [1280, '14px'],
  ] as const)('preserves shared panel padding at %i pixels', (width, expected) => {
    for (const className of ['admin-overview-metric', 'admin-overview-card', 'admin-overview-alerts']) {
      expect(panelPaddingAtWidth(className, width), className).toBe(expected);
    }
  });
  it('loads administrator-only rules with the existing lazy administrator entry', () => {
    const imports: string[] = [];
    postcss.parse(globalStyles).walkAtRules('import', rule => { imports.push(rule.params); });
    expect(imports).not.toContain("'./styles/admin-console.css'");
    expect(imports).not.toContain("'./styles/admin-overview-range-safety.css'");
    for (const file of ['admin-console.css', 'admin-overview-range-safety.css']) {
      expect(adminEntry).toContain(`import '../styles/${file}';`);
      expect(adminEntry.indexOf(`import '../styles/${file}';`)).toBeLessThan(adminEntry.indexOf("import '../styles/admin-phase5.css';"));
      postcss.parse(source(`./${file}`)).walkRules(rule => {
        for (const selector of rule.selectors) expect(selector).toMatch(/^\.admin-/);
      });
    }
  });

  it('keeps shared shell layout before responsive overrides and out of lazy CSS', () => {
    const imports: string[] = [];
    postcss.parse(globalStyles).walkAtRules('import', rule => { imports.push(rule.params); });
    expect(imports.indexOf("'./styles/admin-shell.css'")).toBeGreaterThan(imports.indexOf("'./styles/admin.css'"));
    expect(imports.indexOf("'./styles/admin-shell.css'")).toBeLessThan(imports.indexOf("'./styles/responsive.css'"));
    const shell = postcss.parse(source('./admin-shell.css'));
    const selectors: string[] = [];
    shell.walkRules(rule => { selectors.push(...rule.selectors); });
    expect(selectors.filter(selector => selector.startsWith('.admin-app-shell'))).toEqual(['.admin-app-shell', '.admin-app-shell-state']);
    const declarations: Record<string, Record<string, string>> = {};
    shell.walkRules(rule => {
      declarations[rule.selector] = {};
      rule.walkDecls(decl => { declarations[rule.selector][decl.prop] = decl.value; });
    });
    expect(declarations['.admin-app-shell']).toMatchObject({
      width: '100%', 'max-width': 'none', 'min-height': '100dvh', margin: '0', padding: '0', display: 'block',
    });
    expect(declarations['.admin-app-shell-state']).toEqual({ padding: '28px' });
    postcss.parse(source('./admin-console.css')).walkRules(rule => {
      expect(rule.selectors).not.toContain('.admin-app-shell');
      expect(rule.selectors).not.toContain('.admin-app-shell-state');
    });
  });
});
