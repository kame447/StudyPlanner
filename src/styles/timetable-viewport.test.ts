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
});
