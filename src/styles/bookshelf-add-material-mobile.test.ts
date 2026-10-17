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

const focusPolicyCss = postcss.parse(readFileSync(new URL('./input-focus-policy.css', import.meta.url), 'utf8'));
const textScaleMedia = '(max-width: 768px), (pointer: coarse)';

describe('material creation input text enlargement', () => {
  it('overrides the coarse-pointer minimum locally without losing its 16px floor', () => {
    const global = focusPolicyCss.nodes.find(node => node.type === 'atrule' && node.params === textScaleMedia) as postcss.AtRule;
    const globalRule = global.nodes?.find(node => node.type === 'rule') as postcss.Rule;
    const textInput = globalRule.selectors.find(selector => selector.startsWith('input:'));
    expect(textInput).toBeTruthy();
    // Reuse every global input exclusion plus a strictly more specific local
    // prefix. A plain local input selector would lose against the six :not().
    const expectedSelectors = [
      `.bookshelf-modal.material-create-dialog .field ${textInput}`,
      '.bookshelf-modal.material-create-dialog .field select',
    ];
    const matches: postcss.Rule[] = [];
    materialCss.walkAtRules('media', media => {
      if (media.params === textScaleMedia) media.walkRules(rule => {
        if (rule.selectors.some(selector => expectedSelectors.includes(selector))) matches.push(rule);
      });
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].selectors).toEqual(expectedSelectors);
    expect(matches[0].nodes.map(node => node.type === 'decl' ? [node.prop, node.value, node.important] : node.type))
      .toEqual([['font-size', 'max(1rem, 16px)', true]]);
  });

  it('retains the global focus threshold and the ordinary material field sizing', () => {
    const globalFont: postcss.Declaration[] = [];
    focusPolicyCss.walkDecls('font-size', declaration => { globalFont.push(declaration); });
    expect(globalFont).toHaveLength(1);
    expect(globalFont[0].value).toBe('16px');
    expect(globalFont[0].important).toBe(true);
    const ordinary = materialCss.nodes.filter(node => node.type === 'rule') as postcss.Rule[];
    const field = ordinary.find(rule => rule.selectors.includes('.bookshelf-modal.material-create-dialog .field input'));
    expect(field?.nodes.filter(node => node.type === 'decl' && node.prop === 'font-size')
      .map(node => node.type === 'decl' ? [node.value, Boolean(node.important)] : null)).toEqual([['1rem', false]]);
    // For the exact max(1rem,16px) contract above, reduced root text cannot
    // trigger sub-16px input focus zoom, while normal/enlarged text stays16/32.
    expect([8, 16, 32].map(rootPixels => Math.max(rootPixels, 16))).toEqual([16, 16, 32]);
  });
});
