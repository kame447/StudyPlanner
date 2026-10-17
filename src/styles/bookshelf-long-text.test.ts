import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = postcss.parse(readFileSync(new URL('./bookshelf.css', import.meta.url), 'utf8'));
function declarations(selector: string) {
  const values: Record<string, string> = {};
  css.walkRules(rule => {
    if (rule.parent?.type === 'root' && rule.selectors.includes(selector)) {
      rule.walkDecls(decl => { values[decl.prop] = decl.value; });
    }
  });
  return values;
}

describe('material long text source contract', () => {
  it.each([
    '.bookshelf-detail-hero-copy h2',
    '.bookshelf-detail-hero-copy p',
    '.bookshelf-detail-section-head p',
    '.bookshelf-activity-list small',
    '.bookshelf-structure-editor .bookshelf-modal-title-row p',
  ])('allows a complete unbroken user value to wrap in %s', selector => {
    expect(declarations(selector)['overflow-wrap']).toBe('anywhere');
    expect(declarations(selector)['white-space']).not.toBe('nowrap');
    expect(declarations(selector)['text-overflow']).not.toBe('ellipsis');
  });

  it('retains deliberate compact structure-row ellipsis and scrollable editor ownership', () => {
    expect(declarations('.bookshelf-structure-copy strong')).toMatchObject({
      'white-space': 'nowrap', 'text-overflow': 'ellipsis',
    });
    expect(declarations('.bookshelf-structure-editor')).toMatchObject({
      width: 'min(760px, calc(100vw - 24px))',
      'max-height': 'min(82vh, 760px)', 'overflow-y': 'auto',
    });
  });
});
