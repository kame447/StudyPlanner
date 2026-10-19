import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const root = postcss.parse(readFileSync(fileURLToPath(new URL('./day-timeline.css', import.meta.url)), 'utf8'));
const editableSelector = '.timeline-shell :is(input, textarea, [contenteditable]:not([contenteditable="false"]))';
function declarations(selector: string) {
  const values: Record<string, string> = {};
  root.walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
  });
  return values;
}

describe('Day grid native selection policy', () => {
  it('disables native selection and callouts on the grid without taking over scrolling or pointer input', () => {
    expect(declarations('.timeline-shell')).toMatchObject({
      'user-select': 'none', '-webkit-user-select': 'none', '-webkit-touch-callout': 'none',
    });
    expect(declarations('.timeline-shell')['touch-action']).toBeUndefined();
    expect(declarations('.timeline-shell')['pointer-events']).toBeUndefined();
  });
  it('explicitly preserves text selection and callouts in every editable descendant', () => {
    expect(declarations(editableSelector)).toEqual({
      'user-select': 'text', '-webkit-user-select': 'text', '-webkit-touch-callout': 'default',
    });
  });
  it('never expands the selection policy to the whole day page, dialogs or document', () => {
    root.walkRules(rule => {
      rule.walkDecls(declaration => {
        if (['user-select', '-webkit-user-select', '-webkit-touch-callout'].includes(declaration.prop)) {
          expect(['.timeline-shell', editableSelector]).toContain(rule.selector);
        }
      });
    });
  });
});
