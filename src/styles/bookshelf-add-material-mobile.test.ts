import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const materialCss = postcss.parse(readFileSync(new URL('./bookshelf-add-material-mobile.css', import.meta.url), 'utf8'));
const scheduleCss = postcss.parse(readFileSync(new URL('./schedule-redesign.css', import.meta.url), 'utf8'));

function declarations(css: postcss.Root, selector: string) {
  const values: Record<string, string> = {};
  css.walkRules(selector, rule => {
    if (rule.parent?.type === 'root') rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  return values;
}

const creation = '.bookshelf-view > .modal-overlay > .bookshelf-modal.material-create-dialog';

describe('material creation sheet size source contract', () => {
  it('uses the Schedule width cap without a percentage-sized implicit grid track', () => {
    const schedule = declarations(scheduleCss, '.schedule-workspace-shell .quick-entry-modal');
    const material = declarations(materialCss, creation);
    // A percentage width inside the centered overlay's implicit grid track
    // shrinks to intrinsic content width in WebKit. Resolve against the
    // viewport explicitly while retaining Schedule's independent width cap.
    expect(material.width).toBe(`min(100vw, ${schedule['max-width']})`);
    expect(material['max-width']).toBe(schedule['max-width']);
  });

  it('fills the Schedule height limit while remaining inside the keyboard viewport', () => {
    const schedule = declarations(scheduleCss, '.schedule-workspace-shell .quick-entry-modal');
    const material = declarations(materialCss, creation);
    expect(material.height).toBe(`min(${schedule['max-height']}, calc(var(--material-create-viewport-height, 100dvh) - 12px))`);
    expect(material['max-height']).toBe(material.height);
    expect(material.overflow).toBe('hidden');
  });

  it('gives extra height to the scrollable body and keeps the footer unshrunk', () => {
    const layout = declarations(materialCss, '.bookshelf-modal.material-create-dialog .material-create-layout');
    const body = declarations(materialCss, '.bookshelf-modal.material-create-dialog .material-create-body');
    const footer = declarations(materialCss, '.bookshelf-modal.material-create-dialog .material-create-footer');
    expect(layout).toMatchObject({ display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0' });
    expect(body).toMatchObject({ flex: '1', 'align-content': 'start', 'min-height': '0', 'overflow-y': 'auto' });
    expect(footer.flex).toBe('0 0 auto');
  });
});
