import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/day-timetable-occurrence-controls.spec.mjs', import.meta.url), 'utf8');
const spec = ts.createSourceFile('day-timetable-occurrence-controls.spec.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

describe('day occurrence functional budget', () => {
  it('extends only the actual 1280x900 WebKit mobile visibility and cancellation callback', async () => {
    let callback = '';
    const timeoutCalls: ts.CallExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        if (node.expression.getText(spec) === 'test'
          && ts.isTemplateExpression(node.arguments[0])
          && node.arguments[0].head.text === 'day visibility and single-occurrence cancellation preserve recorded history at ') {
          expect(callback).toBe('');
          callback = node.arguments[1].getText(spec);
        }
        if (node.expression.getText(spec).endsWith('setTimeout')) timeoutCalls.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(spec);
    expect(callback).not.toBe('');
    expect(timeoutCalls.map(call => call.getText(spec))).toEqual(['test.setTimeout(60_000)']);
    expect(callback).toContain(timeoutCalls[0].getText(spec));
    expect(source).toContain('test.use({ viewport: { width, height: 900 }, screen: { width, height: 900 } });');
    const stop = new Error('stop before browser preparation');
    const extended: string[] = [];
    for (const project of ['chromium', 'webkit-mobile', 'webkit-desktop', 'chromium-desktop', 'firefox-desktop', 'desktop-light', 'mobile-dark']) {
      for (const width of [390, 1280, 1440, 1920]) {
        const setTimeout = vi.fn();
        const run = runInNewContext(`(${callback})`, {
          width, test: { setTimeout }, timedPhase: () => { throw stop; },
        });
        await expect(run({ page: {} }, { project: { name: project } })).rejects.toBe(stop);
        if (setTimeout.mock.calls.length) {
          expect(setTimeout.mock.calls).toEqual([[60_000]]);
          extended.push(`${project}/${width}x900`);
        }
      }
    }
    expect(extended).toEqual(['webkit-mobile/1280x900']);
  });
});
