import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const pageCss = postcss.parse(readFileSync(new URL('./ai-planning-page.css', import.meta.url), 'utf8'));
const previewCss = postcss.parse(readFileSync(new URL('../components/AiPlanningPreviewDialogLayout.css', import.meta.url), 'utf8'));
const desktop = '(min-width: 1100px)';
const surface = '.app-shell.home-app-shell .ai-planning-view.home-dashboard';

function declarations(css: postcss.Root, selector: string, media?: string) {
  const values: Record<string, string> = {};
  css.walkRules(selector, rule => {
    const parent = rule.parent;
    if (media ? parent?.type !== 'atrule' || parent.params !== media : parent?.type !== 'root') return;
    rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
  });
  return values;
}

describe('AI planning desktop presentation boundary', () => {
  it('uses the available parent width for starters and proposal cards only on desktop', () => {
    expect(declarations(pageCss, `${surface} .ai-planning-starters`, desktop)).toMatchObject({
      width: '100%', 'max-width': '100%', 'box-sizing': 'border-box',
    });
    expect(declarations(pageCss, `${surface} .ai-planning-plan-card`, desktop).width).toBe('100%');
    expect(declarations(pageCss, `${surface} .ai-planning-starter-list`, desktop)['grid-template-columns'])
      .toBe('repeat(3, minmax(0, 1fr))');
    // Existing mobile and small-tablet rules remain the fallback.
    expect(declarations(pageCss, `${surface} .ai-planning-plan-card`).width).toBe('min(620px, 100%)');
    expect(declarations(pageCss, `${surface} .ai-planning-plan-card`, '(max-width: 520px)').width).toBe('100%');
  });

  it('gives the desktop preview explicit viewport dimensions and a safe gutter', () => {
    expect(declarations(previewCss, '.ai-planning-preview-overlay-v2', desktop).padding).toBe('24px');
    expect(declarations(previewCss, '.ai-planning-preview-dialog-v2', desktop)).toMatchObject({
      width: 'calc(100vw - 48px)', 'max-width': 'calc(100vw - 48px)',
      height: 'calc(100dvh - 48px)', 'max-height': 'calc(100dvh - 48px)',
    });
    // A percentage width in the overlay's implicit grid track can shrink to its
    // contents. Keep the desktop width viewport-based, with no new fixed cap.
    expect(declarations(previewCss, '.ai-planning-preview-dialog-v2')).toEqual({ display: 'flex', 'flex-direction': 'column' });
  });

  it('does not replace keyboard, scrolling, motion or prose sizing in desktop overrides', () => {
    for (const css of [pageCss, previewCss]) {
      css.walkAtRules('media', media => {
        if (media.params !== desktop) return;
        media.walkRules(rule => {
          expect(rule.selector).not.toMatch(/message-body|composer|chat-drawer|bottom-nav/);
          rule.walkDecls(declaration => {
            expect(declaration.prop).not.toMatch(/^(overflow|position|transform|transition|animation|touch-action|pointer-events)/);
          });
        });
      });
    }
    expect(declarations(previewCss, '.ai-planning-preview-dialog-v2 > .ai-planning-preview-overview-scroll').height).toBe('auto');
  });

  it('raises ordinary desktop controls/detail labels without forcing prose across the calendar', () => {
    const fonts: Record<string, string> = {};
    previewCss.walkAtRules('media', media => {
      if (media.params !== desktop) return;
      media.walkRules(rule => {
        rule.walkDecls('font-size', declaration => { fonts[rule.selector] = declaration.value; });
      });
    });
    for (const selector of ['.ai-planning-primary-action', '.ai-planning-week-header strong', '.ai-planning-preview-detail-block strong']) {
      expect(Object.entries(fonts).find(([rule]) => rule.includes(selector))?.[1]).toBe('0.875rem');
    }
    expect(declarations(previewCss, '.ai-planning-preview-dialog-v2 .ai-planning-preview-hint', desktop)['max-width']).toBe('80ch');
    expect(declarations(previewCss, '.ai-planning-preview-dialog-v2 .ai-planning-preview-detail-block strong', desktop)['max-width']).toBe('70ch');
    expect(Object.keys(fonts).join(' ')).not.toContain('.ai-planning-preview-overview-block');
  });
});
