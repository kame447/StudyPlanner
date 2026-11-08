import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = postcss.parse(source('./timetable-cell-readability.css'));
function declarations(selector: string) {
  const result: Record<string, string> = {};
  css.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}

describe('timetable remaining-viewport contract', () => {
  it('reserves shared footer once and allows only the grid to scroll when space is insufficient', () => {
    expect(declarations('.app-shell.timetable-workspace-shell')).toMatchObject({
      height: '100dvh', display: 'flex', 'flex-direction': 'column', overflow: 'hidden',
      'padding-bottom': 'calc(var(--primary-nav-height) + env(safe-area-inset-bottom, 0px) + 6px)',
    });
    expect(declarations('.timetable-workspace-shell .timetable-grid-shell')).toMatchObject({
      flex: '1', 'min-height': '0', overflow: 'auto',
    });
    expect(declarations('.timetable-workspace-shell .timetable-grid')['grid-template-rows'])
      .toBe('var(--timetable-grid-rows)');
    expect(source('../App.tsx')).toContain("viewMode === 'timetable' ? ' timetable-workspace-shell'");
  });
  it('keeps clamped lesson titles inside their allocated track rather than overlapping metadata', () => {
    expect(declarations('.timetable-workspace-shell .timetable-class-card strong')).toMatchObject({
      'min-height': '0', 'max-height': '100%',
    });
    // Existing full accessible names and detail entry remain the overflow path.
    expect(source('../components/TimetableView.tsx')).toContain('${primaryTemplate.title}の詳細');
    expect(source('./timetable-cell-readability.css')).toContain('-webkit-line-clamp: 4');
  });
  it('uses the same data-derived count for loading and loaded grids, not a hardcoded six-row crop', () => {
    for (const file of ['TimetableView.tsx', 'TimetableSkeleton.tsx']) {
      expect(source(`../components/${file}`)).toContain("'--timetable-grid-rows': gridRows");
    }
    expect(declarations('.timetable-workspace-shell > main > .route-skeleton--timetable'))
      .toMatchObject({ display: 'flex', flex: '1', 'min-height': '0' });
  });
  it('keeps two native time editors alongside the period number without shrinking their height', () => {
    expect(declarations('.timetable-workspace-shell .timetable-grid-cell')['min-height']).toBe('4rem');
    expect(declarations('.timetable-workspace-shell .timetable-view')['--timetable-grid-gap']).toBe('2px');
    expect(declarations('.timetable-workspace-shell .timetable-period-cell'))
      .toMatchObject({ 'grid-template-columns': 'minmax(16px, auto) minmax(0, 1fr)', 'grid-template-rows': 'auto auto' });
    expect(declarations('.timetable-workspace-shell .timetable-period-cell > strong')['grid-row']).toBe('1 / 3');
    expect(declarations('.timetable-workspace-shell .timetable-period-time-field')['grid-column']).toBe('2');
    expect(source('./timetable-time-input-fix.css')).toContain('min-height: 28px');
    const trigger = postcss.parse(source('./timetable-period-config.css'));
    const properties: Record<string, string> = {};
    trigger.walkRules('.timetable-period-trigger', rule => {
      rule.walkDecls(decl => { properties[decl.prop] = decl.value; });
    });
    expect(properties).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'baseline' });
  });

  it('shows the stored 24h time label over a transparent 16px input on narrow or touch screens', () => {
    // input-focus-policy.css forces 16px; a 12-hour native field cannot fit the period column there.
    const fix = postcss.parse(source('./timetable-time-input-fix.css'));
    const media = fix.nodes.filter((node): node is postcss.AtRule => node.type === 'atrule' && node.params === '(max-width: 768px), (pointer: coarse)');
    expect(media).toHaveLength(1);
    const rules = (selector: string) => {
      const result: Record<string, string> = {};
      media[0].walkRules(rule => {
        if (rule.selectors.includes(selector)) rule.walkDecls(decl => { result[decl.prop] = decl.value; });
      });
      return result;
    };
    expect(rules('.timetable-period-cell .timetable-period-time-text').display).toBe('block');
    expect(rules(".timetable-period-cell .timetable-period-time-field input[type='time']"))
      .toMatchObject({ position: 'absolute', inset: '0', color: 'transparent' });
    expect(rules(".timetable-period-cell .timetable-period-time-field input[type='time']::-webkit-calendar-picker-indicator").opacity).toBe('0');
    expect(rules(".timetable-period-cell .timetable-period-time-field:has(input[type='time']:focus-visible) .timetable-period-time-text").visibility)
      .toBe('hidden');
    // The 16px iOS zoom policy is not weakened.
    expect(source('./input-focus-policy.css')).toContain('font-size: 16px !important');
  });
});
