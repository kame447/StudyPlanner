import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = postcss.parse(readFileSync(new URL('../components/AiPlanningPreviewDialog.css', import.meta.url), 'utf8'));
const rules = css.nodes.filter((node): node is postcss.Rule => node.type === 'rule' && node.selector.startsWith(":root[data-theme='dark']"));

function value(selector: string, property: string) {
  let result: string | undefined;
  for (const rule of rules) {
    if (!rule.selector.includes(selector)) continue;
    rule.walkDecls(property, declaration => { result = declaration.value; });
  }
  return result;
}

describe('AI v2 preview dark theme', () => {
  it('targets the sibling dialog directly rather than assuming the legacy view is its ancestor', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.selector).toContain('.ai-planning-preview-dialog-v2');
      expect(rule.selector).not.toContain('.ai-planning-view ');
    }
  });

  it('pairs the overview and detail surfaces with theme text tokens', () => {
    for (const selector of ['.ai-planning-week-header', '.ai-planning-preview-overview-scroll', '.ai-planning-preview-day-detail', '.ai-planning-preview-day-scroll']) {
      expect(value(selector, 'background')).toBe('var(--surface-strong)');
    }
    for (const selector of ['.ai-planning-preview-header h2', '.ai-planning-week-header strong', '.ai-planning-preview-day-nav strong']) {
      expect(value(selector, 'color')).toBe('var(--text-primary)');
    }
    for (const selector of ['.ai-planning-preview-hint', '.ai-planning-time-axis span', '.ai-planning-preview-day-axis > span']) {
      expect(value(selector, 'color')).toBe('var(--text-muted)');
    }
  });

  it('keeps selected and primary controls on the paired selected surface', () => {
    for (const selector of ['.ai-planning-primary-action', '.ai-planning-preview-mode-tabs button.active']) {
      expect(value(selector, 'background')).toBe('var(--surface-selected)');
      expect(value(selector, 'color')).toBe('var(--text-primary)');
    }
  });

  it('preserves a distinct disabled day and period navigation treatment', () => {
    for (const selector of ['.ai-planning-preview-day-nav button:disabled', '.ai-planning-preview-period-nav button:disabled']) {
      expect(value(selector, 'color')).toBe('var(--text-muted)');
      expect(value(selector, 'border-color')).toBe('var(--border)');
    }
  });

  it('pairs the dark proposal card action and badge without changing light controls', () => {
    const pageCss = postcss.parse(readFileSync(new URL('./ai-planning-page.css', import.meta.url), 'utf8'));
    const selector = ":root[data-theme='dark'] .app-shell.home-app-shell .ai-planning-view .ai-planning-plan-card :is(\n  .ai-planning-preview-button,\n  .ai-planning-plan-card-head b\n)";
    const values: Record<string, string> = {};
    pageCss.walkRules(selector, rule => rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; }));
    expect(values).toEqual({ background: 'var(--surface-selected)', color: 'var(--text-primary)' });
  });

  it('changes paint only, preserving dimensions, motion, touch and scrolling', () => {
    for (const rule of rules) rule.walkDecls(declaration => {
      expect(['color', 'background', 'border-color']).toContain(declaration.prop);
    });
  });
});
