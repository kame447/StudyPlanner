import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import postcss from 'postcss';

it('top-aligns native Todo controls without stretching their label tracks', () => {
  const css = postcss.parse(readFileSync(new URL('./compact-record-forms.css', import.meta.url), 'utf8'));
  const declarations = new Map<string, string>();
  css.walkRules('.todo-edit-modal .todo-edit-field-pair', rule => {
    rule.walkDecls(declaration => { declarations.set(declaration.prop, declaration.value); });
  });
  expect(declarations.get('align-items')).toBe('start');
  expect(declarations.get('grid-template-columns')).toBe('repeat(auto-fit, minmax(min(100%, 7rem), 1fr))');
});
